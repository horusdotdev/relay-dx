import {
  buildASTSchema,
  Kind,
  OperationTypeNode,
  parseValue,
  print,
  type DocumentNode,
  type InputValueDefinitionNode,
  type StringValueNode,
} from "graphql";

/** Restore metadata omitted by Relay's printer without losing applied directives. */
export function restoreDescriptions(
  document: DocumentNode,
  descriptions: Readonly<Record<string, string>>,
): DocumentNode {
  function describe<T extends { readonly description?: StringValueNode }>(
    node: T,
    coordinate: string,
  ): T {
    if (!Object.hasOwn(descriptions, coordinate)) return node;
    const value = descriptions[coordinate];
    let description: StringValueNode = { kind: Kind.STRING, value, block: true };
    // Block strings normalize some whitespace. Use an escaped string when needed
    // so descriptions containing blank lines, tabs, or control characters survive.
    try {
      const roundTrip = parseValue(print(description));
      if (roundTrip.kind !== Kind.STRING || roundTrip.value !== value)
        description = { ...description, block: false };
    } catch {
      description = { ...description, block: false };
    }
    return { ...node, description };
  }

  const describeArguments = (
    args: readonly InputValueDefinitionNode[] | undefined,
    coordinate: string,
  ) => args?.map((arg) => describe(arg, `${coordinate}(${arg.name.value}:)`));

  let definitions = document.definitions;
  if (
    Object.hasOwn(descriptions, "$schema") &&
    !definitions.some((definition) => definition.kind === Kind.SCHEMA_DEFINITION)
  ) {
    // Relay omits a schema block when roots have conventional names. Materialize
    // those same roots to give a schema-level description somewhere to live.
    const schema = buildASTSchema(document, { assumeValidSDL: true, assumeValid: true });
    const roots = [
      [OperationTypeNode.QUERY, schema.getQueryType()],
      [OperationTypeNode.MUTATION, schema.getMutationType()],
      [OperationTypeNode.SUBSCRIPTION, schema.getSubscriptionType()],
    ] as const;
    definitions = [
      {
        kind: Kind.SCHEMA_DEFINITION,
        operationTypes: roots.flatMap(([operation, type]) =>
          type
            ? [
                {
                  kind: Kind.OPERATION_TYPE_DEFINITION as const,
                  operation,
                  type: {
                    kind: Kind.NAMED_TYPE as const,
                    name: { kind: Kind.NAME as const, value: type.name },
                  },
                },
              ]
            : [],
        ),
      },
      ...definitions,
    ];
  }

  return {
    ...document,
    definitions: definitions.map((definition) => {
      switch (definition.kind) {
        case Kind.SCHEMA_DEFINITION:
          return describe(definition, "$schema");
        case Kind.OBJECT_TYPE_DEFINITION:
        case Kind.INTERFACE_TYPE_DEFINITION:
          return {
            ...describe(definition, definition.name.value),
            fields: definition.fields?.map((field) => {
              const coordinate = `${definition.name.value}.${field.name.value}`;
              return {
                ...describe(field, coordinate),
                arguments: describeArguments(field.arguments, coordinate),
              };
            }),
          };
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          return {
            ...describe(definition, definition.name.value),
            fields: definition.fields?.map((field) =>
              describe(field, `${definition.name.value}.${field.name.value}`),
            ),
          };
        case Kind.ENUM_TYPE_DEFINITION:
          return {
            ...describe(definition, definition.name.value),
            values: definition.values?.map((value) =>
              describe(value, `${definition.name.value}.${value.name.value}`),
            ),
          };
        case Kind.DIRECTIVE_DEFINITION:
          return {
            ...describe(definition, `@${definition.name.value}`),
            arguments: describeArguments(definition.arguments, `@${definition.name.value}`),
          };
        case Kind.SCALAR_TYPE_DEFINITION:
        case Kind.UNION_TYPE_DEFINITION:
          return describe(definition, definition.name.value);
        default:
          return definition;
      }
    }),
  };
}
