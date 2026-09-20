import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  type ValueNode,
} from "graphql";
import { valueFromASTUntyped } from "graphql";

export type SchemaKind = "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT";

export function typeRef(type: GraphQLType): unknown {
  if (isNonNullType(type)) {
    return { kind: "NON_NULL", ofType: typeRef(type.ofType) };
  }
  if (isListType(type)) {
    return { kind: "LIST", ofType: typeRef(type.ofType) };
  }
  return { kind: kindOf(type), name: type.name };
}

export function kindOf(type: GraphQLNamedType | GraphQLType): SchemaKind {
  if (isScalarType(type)) return "SCALAR";
  if (isObjectType(type)) return "OBJECT";
  if (isInterfaceType(type)) return "INTERFACE";
  if (isUnionType(type)) return "UNION";
  if (isEnumType(type)) return "ENUM";
  if (isInputObjectType(type)) return "INPUT_OBJECT";
  throw new Error(`Unsupported GraphQL type: ${String(type)}`);
}

export function namedType(type: GraphQLType): GraphQLNamedType {
  return getNamedType(type);
}

export function descriptionOf(value: { description?: string | null }): string | undefined {
  return value.description ?? undefined;
}

function directivesFromAstNode(
  node:
    | {
        directives?: readonly {
          name: { value: string };
          arguments?: readonly { name: { value: string }; value: ValueNode }[];
        }[];
      }
    | null
    | undefined,
) {
  return node?.directives?.map((directive) => ({
    name: directive.name.value,
    arguments:
      directive.arguments?.reduce<Record<string, unknown>>((result, argument) => {
        result[argument.name.value] = valueFromASTUntyped(argument.value);
        return result;
      }, {}) ?? {},
  }));
}

function argumentInfo(argument: GraphQLArgument) {
  return {
    name: argument.name,
    description: descriptionOf(argument),
    type: typeRef(argument.type),
    defaultValue: argument.defaultValue,
    deprecationReason: argument.deprecationReason ?? undefined,
    directives: directivesFromAstNode(argument.astNode),
  };
}

function fieldInfo(field: GraphQLField<unknown, unknown>) {
  return {
    name: field.name,
    description: descriptionOf(field),
    type: typeRef(field.type),
    args: field.args.map(argumentInfo),
    deprecationReason: field.deprecationReason ?? undefined,
    directives: directivesFromAstNode(field.astNode),
  };
}

export function typeInfo(
  schema: GraphQLSchema,
  typeName: string,
): Record<string, unknown> | undefined {
  const type = schema.getType(typeName);
  if (!type) return undefined;

  const info: Record<string, unknown> = {
    name: type.name,
    kind: kindOf(type),
    description: descriptionOf(type),
    directives: directivesFromAstNode(type.astNode),
    specifiedByURL: isScalarType(type) ? (type.specifiedByURL ?? undefined) : undefined,
  };

  if (isObjectType(type) || isInterfaceType(type)) {
    info.fields = Object.values(type.getFields()).map(fieldInfo);
    info.interfaces = type.getInterfaces().map((item) => item.name);
    if (isInterfaceType(type))
      info.possibleTypes = schema.getPossibleTypes(type).map((item) => item.name);
  }
  if (isInputObjectType(type)) {
    info.inputFields = Object.values(type.getFields()).map((field) => ({
      name: field.name,
      description: descriptionOf(field),
      type: typeRef(field.type),
      defaultValue: field.defaultValue,
      deprecationReason: field.deprecationReason ?? undefined,
      directives: directivesFromAstNode(field.astNode),
    }));
  }
  if (isUnionType(type)) {
    info.possibleTypes = type.getTypes().map((item) => item.name);
  }
  if (isEnumType(type)) {
    info.values = type.getValues().map((value) => ({
      name: value.name,
      description: descriptionOf(value),
      deprecationReason: value.deprecationReason ?? undefined,
      directives: directivesFromAstNode(value.astNode),
    }));
  }

  return info;
}

export function schemaTypeNames(schema: GraphQLSchema): string[] {
  return Object.keys(schema.getTypeMap())
    .filter((name) => !name.startsWith("__"))
    .sort((a, b) => a.localeCompare(b));
}

export function schemaOverview(schema: GraphQLSchema, metadata: Record<string, unknown> = {}) {
  const names = schemaTypeNames(schema);
  const counts = names.reduce<Record<string, number>>((result, name) => {
    const kind = kindOf(schema.getType(name)!);
    result[kind] = (result[kind] ?? 0) + 1;
    return result;
  }, {});
  const root = {
    query: schema.getQueryType()?.name,
    mutation: schema.getMutationType()?.name,
    subscription: schema.getSubscriptionType()?.name,
  };

  return {
    ...metadata,
    roots: root,
    typeCount: names.length,
    typeCounts: counts,
    types: names,
    directives: schema.getDirectives().map((directive) => ({
      name: directive.name,
      description: directive.description ?? undefined,
      locations: directive.locations,
      args: directive.args.map(argumentInfo),
    })),
  };
}

export function searchSchema(
  schema: GraphQLSchema,
  query: string,
  kind: SchemaKind | undefined,
  limit: number,
) {
  const needle = query.trim().toLocaleLowerCase();
  const matches: Array<Record<string, unknown>> = [];

  for (const name of schemaTypeNames(schema)) {
    const type = schema.getType(name)!;
    const typeKind = kindOf(type);
    if (kind && typeKind !== kind) continue;

    if (name.toLocaleLowerCase().includes(needle)) {
      matches.push({ name, kind: typeKind, match: "type", description: descriptionOf(type) });
    }

    if (isObjectType(type) || isInterfaceType(type)) {
      for (const field of Object.values(type.getFields())) {
        if (field.name.toLocaleLowerCase().includes(needle)) {
          matches.push({
            name: field.name,
            parentType: name,
            kind: typeKind,
            match: "field",
            type: typeRef(field.type),
            args: field.args.map(argumentInfo),
          });
        }
      }
    }
  }

  return {
    query,
    ...(kind ? { kind } : {}),
    limit,
    count: matches.length,
    truncated: matches.length > limit,
    matches: matches.slice(0, limit),
  };
}
