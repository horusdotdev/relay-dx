import {
  getNamedType,
  isCompositeType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  type GraphQLInputType,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema,
} from "graphql";
import type { FieldDefinition, SchemaDefinition, TypeDefinition, TypeReference } from "./types.js";

export interface GenerateStoreOptions {
  /** Primitive TypeScript mappings from the selected Relay project. */
  scalarTypes?: Readonly<Record<string, unknown>>;
  runtimeImport?: string;
}
const q = JSON.stringify;
const primitives: Record<string, string> = {
  ID: "string",
  String: "string",
  Int: "number",
  Float: "number",
  Boolean: "boolean",
};
function hasDirective(
  type: { astNode?: { directives?: readonly { name: { value: string } }[] } | null },
  name: string,
): boolean {
  return Boolean(type.astNode?.directives?.some((directive) => directive.name.value === name));
}
function reference(type: GraphQLInputType | GraphQLOutputType): TypeReference {
  const nullable = !isNonNullType(type);
  const inner = isNonNullType(type) ? type.ofType : type;
  return isListType(inner)
    ? { nullable, element: reference(inner.ofType) }
    : { nullable, name: inner.name };
}

/** Schema text is untrusted comment content, not TypeScript/JSDoc syntax. */
function jsdoc(
  source: { description?: string | null; deprecationReason?: string | null },
  indent = "",
): string {
  const escape = (text: string) => text.replaceAll("*/", "*\\/").replace(/^(\s*)@/, "$1\\@");
  const lines = source.description?.split(/\r\n?|\n|\u2028|\u2029/).map(escape) ?? [];
  if (source.deprecationReason != null) {
    if (lines.length) lines.push("");
    const [first, ...rest] = source.deprecationReason.split(/\r\n?|\n|\u2028|\u2029/).map(escape);
    lines.push(`@deprecated${first ? ` ${first}` : ""}`, ...rest);
  }
  return lines.length
    ? `${indent}/**\n${lines.map((line) => `${indent} *${line ? ` ${line}` : ""}`).join("\n")}\n${indent} */\n`
    : "";
}

/** Produces a standalone TypeScript artifact with phantom types and runtime metadata. */
export function generateStore(schema: GraphQLSchema, options: GenerateStoreOptions = {}): string {
  const query = schema.getQueryType();
  if (!query) throw new Error("Store generation requires a query root.");
  const all = Object.values(schema.getTypeMap()).sort((a, b) => a.name.localeCompare(b.name));
  const types = all
    .filter(isCompositeType)
    .filter((type) => !type.name.startsWith("__") && !hasDirective(type, "__RelayResolverModel"));
  const included = new Set(types.map((type) => type.name));
  function scalar(type: GraphQLNamedType): { text: string; writable: boolean } {
    if (isEnumType(type))
      return {
        text:
          type
            .getValues()
            .map((value) => q(value.name))
            .join(" | ") || "never",
        writable: true,
      };
    const mapped = primitives[type.name] ?? options.scalarTypes?.[type.name];
    // Imported/object scalar codecs need a separate design. Never emit `any`.
    if (typeof mapped === "string" && /^(string|number|boolean)$/.test(mapped))
      return { text: mapped, writable: true };
    return { text: "unknown", writable: false };
  }
  function valueType(type: GraphQLInputType | GraphQLOutputType, read: boolean): string {
    const inner = isNonNullType(type) ? type.ofType : type;
    const value = isListType(inner)
      ? `ReadonlyArray<${valueType(inner.ofType, read)}>`
      : isInputObjectType(inner)
        ? `Input_${inner.name}`
        : scalar(inner).text;
    return `${value}${read || !isNonNullType(type) ? " | null" : ""}${read ? " | undefined" : ""}`;
  }
  function connection(type: GraphQLNamedType): TypeDefinition["connection"] {
    if (!isObjectType(type)) return undefined;
    const fields = type.getFields();
    const edges = fields.edges && reference(fields.edges.type);
    if (!edges?.element || !fields.pageInfo) return undefined;
    const edge = schema.getType(edges.element.name ?? "");
    if (!isObjectType(edge)) return undefined;
    const node = edge.getFields().node;
    if (!node || !edge.getFields().cursor || !isCompositeType(getNamedType(node.type)))
      return undefined;
    if (!included.has(edge.name) || !included.has(getNamedType(node.type).name)) return undefined;
    return { edge: edge.name, node: getNamedType(node.type).name };
  }
  const definitions: Record<string, TypeDefinition> = {};
  const declarations: string[] = [];
  for (const type of all.filter(isInputObjectType)) {
    const fields = Object.values(type.getFields())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (field) =>
          `${jsdoc(field, "  ")}  readonly ${q(field.name)}${!isNonNullType(field.type) || field.defaultValue !== undefined ? "?" : ""}: ${valueType(field.type, false)};`,
      );
    declarations.push(`${jsdoc(type)}export type Input_${type.name} = {\n${fields.join("\n")}\n};`);
  }
  const shapes: string[] = [];
  for (const type of types) {
    const possibleTypes = isObjectType(type)
      ? [type.name]
      : schema
          .getPossibleTypes(type)
          .map((item) => item.name)
          .filter((name) => included.has(name));
    const fields: Record<string, FieldDefinition> = {};
    const scalars: string[] = [];
    const links: string[] = [];
    if (isObjectType(type) || isInterfaceType(type)) {
      for (const field of Object.values(type.getFields()).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (
          field.name.startsWith("__") ||
          hasDirective(field, "relay_resolver") ||
          hasDirective(field, "unselectable")
        )
          continue;
        const target = getNamedType(field.type);
        const composite = isCompositeType(target);
        if (composite && !included.has(target.name)) continue;
        const ref = reference(field.type);
        if (composite && ref.element?.element)
          throw new Error(`Nested linked lists are unsupported: ${type.name}.${field.name}`);
        const args = Object.fromEntries(
          field.args.map((arg) => [
            arg.name,
            { required: isNonNullType(arg.type) && arg.defaultValue === undefined },
          ]),
        );
        const argsText = field.args.length
          ? `Args_${type.name}_${field.name}`
          : "Record<string, never>";
        if (field.args.length) {
          declarations.push(
            `export type ${argsText} = {\n${field.args.map((arg) => `${jsdoc(arg, "  ")}  readonly ${q(arg.name)}${args[arg.name].required ? "" : "?"}: ${valueType(arg.type, false)};`).join("\n")}\n};`,
          );
        }
        const writable = composite || scalar(target).writable;
        fields[field.name] = { kind: composite ? "link" : "scalar", type: ref, args, writable };
        if (composite) {
          links.push(
            `${jsdoc(field, "      ")}      ${q(field.name)}: LinkedField<${q(target.name)}, ${Boolean(ref.element)}, ${ref.nullable}, ${ref.element?.nullable ?? false}, ${argsText}>;`,
          );
        } else {
          scalars.push(
            `${jsdoc(field, "      ")}      ${q(field.name)}: ScalarField<${valueType(field.type, true)}, ${writable ? valueType(field.type, false) : "never"}, ${argsText}>;`,
          );
        }
      }
    }
    const shape = connection(type);
    definitions[type.name] = {
      concrete: isObjectType(type),
      possibleTypes,
      fields,
      ...(shape ? { connection: shape } : {}),
    };
    shapes.push(
      `${jsdoc(type, "  ")}  ${q(type.name)}: {\n    concrete: ${isObjectType(type)};\n    possibleTypes: ${possibleTypes.map((name) => q(name)).join(" | ") || "never"};\n    scalars: {\n${scalars.join("\n")}\n    };\n    links: {\n${links.join("\n")}\n    };\n    connection: ${shape ? `{ edge: ${q(shape.edge)}; node: ${q(shape.node)} }` : "null"};\n  };`,
    );
  }
  const definition: SchemaDefinition = { query: query.name, types: definitions };
  return `// Generated by the experimental @relay-dx/store generator. Do not edit.\nimport { createStoreAPI, type ScalarField, type LinkedField } from ${q(options.runtimeImport ?? "@relay-dx/store")};\n\n${declarations.join("\n\n")}\n\nexport type StoreSchema = {\n${shapes.join("\n")}\n};\n\nexport const store = createStoreAPI<StoreSchema, ${q(query.name)}>(${JSON.stringify(definition, null, 2)} as const);\n`;
}
