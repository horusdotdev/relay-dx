import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  buildSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  parse,
  validate,
  type GraphQLSchema,
} from "graphql";
import { loadRelaySchema } from "@relay-dx/schema";

const fixtureDirectory = new URL("../examples/kitchen-sink/", import.meta.url);

function descriptionAt(schema: GraphQLSchema, coordinate: string): string | null | undefined {
  if (coordinate === "$schema") return schema.description;
  const match = /^(@?\w+)(?:\.(\w+))?(?:\((\w+):\))?$/.exec(coordinate);
  if (!match) throw new Error(`Invalid schema coordinate: ${coordinate}`);
  const [, name, member, argument] = match;
  if (name.startsWith("@")) {
    const directive = schema.getDirective(name.slice(1));
    return argument
      ? directive?.args.find((arg) => arg.name === argument)?.description
      : directive?.description;
  }
  const type = schema.getType(name);
  if (!member) return type?.description;
  if (isEnumType(type)) return type.getValue(member)?.description;
  if (isInputObjectType(type)) return type.getFields()[member]?.description;
  if (isObjectType(type) || isInterfaceType(type)) {
    const field = type.getFields()[member];
    return argument
      ? field?.args.find((arg) => arg.name === argument)?.description
      : field?.description;
  }
  throw new Error(`Unknown schema coordinate: ${coordinate}`);
}

async function expectDescriptions(schema: GraphQLSchema, manifest: URL) {
  const descriptions = JSON.parse(await readFile(manifest, "utf8")) as Record<string, string>;
  for (const [coordinate, description] of Object.entries(descriptions)) {
    expect(descriptionAt(schema, coordinate), coordinate).toBe(description);
  }
}

describe("effective schema from the real Relay kitchen sink", () => {
  let schema: GraphQLSchema;
  let sdl: string;

  beforeAll(async () => {
    ({ schema, sdl } = await loadRelaySchema({
      configPath: fileURLToPath(new URL("relay.config.json", fixtureDirectory)),
    }));
  });

  it("contains server fields, client extensions, and every documented resolver", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("expected-schema.json", fixtureDirectory), "utf8"),
    ) as {
      queryFields: string[];
      resolverFields: string[];
      excludedResolverFields: string[];
      largeObjectFieldCount: number;
    };
    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual(
      expect.arrayContaining(manifest.queryFields),
    );
    for (const coordinate of [...manifest.resolverFields, "User.clientLabel"]) {
      const [typeName, fieldName] = coordinate.split(".");
      const type = schema.getType(typeName);
      expect(isObjectType(type), typeName).toBe(true);
      if (isObjectType(type)) expect(type.getFields()[fieldName], coordinate).toBeDefined();
    }
    for (const coordinate of manifest.excludedResolverFields) {
      const [typeName, fieldName] = coordinate.split(".");
      const type = schema.getType(typeName);
      if (isObjectType(type)) expect(type.getFields()[fieldName], coordinate).toBeUndefined();
    }
    const large = schema.getType("LargeObject");
    expect(isObjectType(large)).toBe(true);
    if (isObjectType(large))
      expect(Object.keys(large.getFields())).toHaveLength(manifest.largeObjectFieldCount);
  });

  it("retains resolver directives and server deprecations", () => {
    const user = schema.getType("User");
    if (!isObjectType(user)) throw new Error("Missing User");
    expect(user.getFields().email.deprecationReason).toBe(
      "Use the private contact endpoint instead.",
    );
    expect(
      user
        .getFields()
        .greeting.args.find((argument) => argument.name === "prefix")
        ?.type.toString(),
    ).toBe("String!");
    expect(
      user
        .getFields()
        .displayName.astNode?.directives?.some(
          (directive) => directive.name.value === "relay_resolver",
        ),
    ).toBe(true);
    expect(sdl).toContain("@relay_resolver");
  });

  it("preserves server, extension, and resolver descriptions in the schema and exported SDL", async () => {
    const manifest = new URL("expected-descriptions.json", fixtureDirectory);
    await expectDescriptions(schema, manifest);
    await expectDescriptions(buildSchema(sdl, { assumeValidSDL: true }), manifest);
  });

  it("validates selections spanning all three schema layers", () => {
    const document = parse(`query EffectiveSchemaTest {
      viewer { name clientLabel greeting(prefix: "Hello") displayName profileCard { headline imageUrl } }
      dashboard { title }
      tick
      modernGreeting
      largeObject { field120 }
    }`);
    expect(validate(schema, document).map((error) => error.message)).toEqual([]);
  });
});

describe("multi-project Relay configuration", () => {
  const configPath = fileURLToPath(
    new URL("./fixtures/multi-project/relay.config.json", import.meta.url),
  );

  it("requires explicit selection and includes base-project extensions", async () => {
    await expect(loadRelaySchema({ configPath })).rejects.toThrow(/project/i);
    const app = await loadRelaySchema({ configPath, project: "app" });
    expect(app.projectName).toBe("app");
    expect(app.schema.getQueryType()?.getFields().sharedClientValue).toBeDefined();
    const manifest = new URL(
      "./fixtures/multi-project/expected-descriptions.json",
      import.meta.url,
    );
    await expectDescriptions(app.schema, manifest);
    await expectDescriptions(buildSchema(app.sdl, { assumeValidSDL: true }), manifest);
    expect(app.schema.getQueryType()?.getFields().sharedValue.description).toBeUndefined();
    const base = await loadRelaySchema({ configPath, project: "base" });
    expect(base.schema.getQueryType()?.description).toBe("Shared schema used by every project.");
    expect(base.schema.getQueryType()?.getFields().sharedValue.description).toBe(
      "A value supplied by the shared base project.",
    );
    await expect(loadRelaySchema({ configPath, project: "missing" })).rejects.toThrow(/project/i);
  });
});
