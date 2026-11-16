import {
  getNamedType,
  isCompositeType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  valueFromASTUntyped,
  type GraphQLField,
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
  /** Keys from Relay source documents. loadRelaySchema supplies these through schema extensions. */
  connectionKeys?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** Selected fields by type; true additionally requires the field via @required. */
  selectedFields?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  /** Defaults to document-selected roots when available, otherwise all types. */
  types?: readonly string[] | "selected" | "all";
  /** Receives diagnostics for omitted unsupported fields; defaults to console.warn. */
  onWarning?: (message: string) => void;
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
  let types = all
    .filter(isCompositeType)
    .filter((type) => !type.name.startsWith("__") && !hasDirective(type, "__RelayResolverModel"));
  const relay = schema.extensions.relay as
    | {
        connectionKeys?: GenerateStoreOptions["connectionKeys"];
        selectedFields?: GenerateStoreOptions["selectedFields"];
      }
    | undefined;
  const connectionKeys = options.connectionKeys ?? relay?.connectionKeys ?? {};
  const selectedFields = options.selectedFields ?? relay?.selectedFields;
  const scope = options.types ?? (selectedFields === undefined ? "all" : "selected");
  if (scope !== "all") {
    if (scope === "selected" && selectedFields === undefined)
      throw new Error('types: "selected" requires document field selections.');
    const available = new Map(types.map((type) => [type.name, type]));
    const selectedRoots = new Set(Object.keys(selectedFields ?? {}));
    if (scope === "selected") {
      // A selection of only __typename need not produce fields on the linked type.
      for (const [name, fields] of Object.entries(selectedFields!)) {
        const owner = available.get(name);
        if (!owner || (!isObjectType(owner) && !isInterfaceType(owner))) continue;
        for (const name of Object.keys(fields)) {
          const field = owner.getFields()[name];
          if (
            !field ||
            hasDirective(field, "relay_resolver") ||
            hasDirective(field, "unselectable")
          )
            continue;
          const target = getNamedType(field.type);
          if (isCompositeType(target)) selectedRoots.add(target.name);
        }
      }
    }
    const roots =
      scope === "selected" ? [...selectedRoots].filter((name) => available.has(name)) : scope;
    const reachable = new Set<string>();
    const visit = (name: string) => {
      if (reachable.has(name)) return;
      const type = available.get(name);
      if (!type) throw new Error(`Unknown stored type in generation roots: ${name}.`);
      reachable.add(name);
      if (!isObjectType(type))
        for (const member of schema.getPossibleTypes(type)) visit(member.name);
      if (isObjectType(type) || isInterfaceType(type)) {
        for (const field of Object.values(type.getFields())) {
          if (hasDirective(field, "relay_resolver") || hasDirective(field, "unselectable"))
            continue;
          const target = getNamedType(field.type);
          if (isCompositeType(target) && available.has(target.name)) visit(target.name);
        }
      }
    };
    // Operation roots must not pull unselected operations' result types back in.
    const operationRoots = new Set([
      query.name,
      schema.getMutationType()?.name,
      schema.getSubscriptionType()?.name,
    ]);
    for (const root of roots.filter((name) => name !== query.name)) {
      if (scope === "selected" && operationRoots.has(root)) reachable.add(root);
      else visit(root);
    }
    if (scope !== "selected" && roots.includes(query.name)) visit(query.name);
    reachable.add(query.name);
    types = types.filter((type) => reachable.has(type.name));
  }
  const included = new Set(types.map((type) => type.name));
  const possible = (value: (typeof types)[number]) =>
    isObjectType(value) ? [value.name] : schema.getPossibleTypes(value).map((item) => item.name);
  function semanticLevels(field: GraphQLField<unknown, unknown>): Set<number> {
    const directive = field.astNode?.directives?.find(
      (item) => item.name.value === "semanticNonNull",
    );
    if (!directive) return new Set();
    const argument = directive.arguments?.find((item) => item.name.value === "levels");
    const levels: unknown = argument ? valueFromASTUntyped(argument.value) : [0];
    if (!Array.isArray(levels) || levels.some((level) => !Number.isInteger(level) || level < 0))
      throw new Error(`Invalid semanticNonNull levels for ${field.name}.`);
    return new Set(levels as number[]);
  }
  function selection(type: (typeof types)[number], field: GraphQLField<unknown, unknown>) {
    const levels = semanticLevels(field);
    let selected = selectedFields === undefined;
    const current = possible(type);
    for (const [ownerName, fields] of Object.entries(selectedFields ?? {})) {
      if (!Object.hasOwn(fields, field.name)) continue;
      const owner = schema.getType(ownerName);
      if (!owner || (!isObjectType(owner) && !isInterfaceType(owner))) continue;
      if (!current.some((name) => possible(owner).includes(name))) continue;
      const inherited = owner.getFields()[field.name];
      if (!inherited) continue;
      selected = true;
      for (const level of semanticLevels(inherited)) levels.add(level);
      if (fields[field.name]) levels.add(0);
    }
    return { levels, required: selected && (isNonNullType(field.type) || levels.has(0)) };
  }
  function fieldKeys(type: (typeof types)[number], name: string, target: string): string[] {
    const current = possible(type);
    const keys = new Set<string>();
    for (const [ownerName, fields] of Object.entries(connectionKeys)) {
      const owner = schema.getType(ownerName);
      if (!owner || (!isObjectType(owner) && !isInterfaceType(owner))) continue;
      if (!current.some((name) => possible(owner).includes(name))) continue;
      const field = owner.getFields()[name];
      if (!field || getNamedType(field.type).name !== target) continue;
      for (const key of fields[name] ?? []) keys.add(key);
    }
    return [...keys].sort();
  }
  function scalar(type: GraphQLNamedType): { text: string; writable: boolean } {
    if (isEnumType(type))
      return {
        text: type
          .getValues()
          .map((value) => q(value.name))
          .concat(q("%future added value"))
          .join(" | "),
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
  function creationValue(type: GraphQLOutputType, levels: Set<number>, depth = 0): string {
    const inner = isNonNullType(type) ? type.ofType : type;
    const value = isListType(inner)
      ? `ReadonlyArray<${creationValue(inner.ofType, levels, depth + 1)}>`
      : isCompositeType(inner)
        ? `LinkedRecordInput<StoreSchema, ${q(inner.name)}>`
        : scalar(inner).writable
          ? scalar(inner).text
          : "never";
    return `${value}${!isNonNullType(type) && !levels.has(depth) ? " | null" : ""}`;
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
    const creation: string[] = [];
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
        if (composite && ref.element?.element) {
          (options.onWarning ?? console.warn)(
            `Skipping unsupported nested linked list: ${type.name}.${field.name}`,
          );
          continue;
        }
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
        const selected = selection(type, field);
        const creationType = writable ? creationValue(field.type, selected.levels) : "never";
        const initializer = field.args.length
          ? `FieldInitializer<${creationType}, ${argsText}> | ReadonlyArray<FieldInitializer<${creationType}, ${argsText}>>`
          : creationType;
        creation.push(
          `${jsdoc(field, "      ")}      readonly ${q(field.name)}${selected.required && field.args.length === 0 ? "" : "?"}: ${initializer};`,
        );
        const keys =
          composite && !ref.element && connection(target)
            ? fieldKeys(type, field.name, target.name)
            : undefined;
        fields[field.name] = {
          kind: composite ? "link" : "scalar",
          type: ref,
          args,
          writable,
          ...(keys ? { connectionKeys: keys } : {}),
        };
        if (composite) {
          links.push(
            `${jsdoc(field, "      ")}      ${q(field.name)}: LinkedField<${q(target.name)}, ${Boolean(ref.element)}, ${ref.nullable}, ${ref.element?.nullable ?? false}, ${argsText}, ${keys?.map((key) => q(key)).join(" | ") || "never"}>;`,
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
      `${jsdoc(type, "  ")}  ${q(type.name)}: {\n    concrete: ${isObjectType(type)};\n    possibleTypes: ${possibleTypes.map((name) => q(name)).join(" | ") || "never"};\n    creation: {\n${creation.join("\n")}\n    };\n    scalars: {\n${scalars.join("\n")}\n    };\n    links: {\n${links.join("\n")}\n    };\n    connection: ${shape ? `{ edge: ${q(shape.edge)}; node: ${q(shape.node)} }` : "null"};\n  };`,
    );
  }
  const definition: SchemaDefinition = { query: query.name, types: definitions };
  return `// Generated by the experimental @relay-dx/store generator. Do not edit.\nimport { createStoreAPI, type ScalarField, type LinkedField, type LinkedRecordInput, type FieldInitializer } from ${q(options.runtimeImport ?? "@relay-dx/store")};\n\n${declarations.join("\n\n")}\n\nexport type StoreSchema = {\n${shapes.join("\n")}\n};\n\nexport const store = createStoreAPI<StoreSchema, ${q(query.name)}>(${JSON.stringify(definition, null, 2)} as const);\n`;
}
