import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vite-plus/test";
import { loadRelaySchema } from "@relay-dx/schema";
import { generateStore } from "./generate.js";

describe("schema-generated record types", () => {
  it("reproduces the fixture artifact deterministically", async () => {
    const schema = await loadRelaySchema({
      configPath: fileURLToPath(new URL("../fixtures/relay.config.json", import.meta.url)),
    });
    const generated = await readFile(
      new URL("../fixtures/__generated__/store.ts", import.meta.url),
      "utf8",
    );
    expect(generateStore(schema.schema, { scalarTypes: { URL: "string" } })).toBe(generated);
  });

  it("excludes resolvers, internal fields and resolver model objects", () => {
    const schema = buildSchema(
      `
      directive @relay_resolver on FIELD_DEFINITION
      directive @__RelayResolverModel on OBJECT
      type Model @__RelayResolverModel { id: ID! }
      type Query {
        stored: String!
        computed: String @relay_resolver
        __internal: String
        model: Model @relay_resolver
      }
    `,
      { assumeValid: true },
    );
    const generated = generateStore(schema);
    expect(generated).toContain('"stored": ScalarField<string | null | undefined, string');
    expect(generated).not.toContain('"computed"');
    expect(generated).not.toContain('"__internal"');
    expect(generated).not.toContain('"Model"');
  });

  it("uses primitive scalar mappings while keeping unsupported scalars read-only and unknown", () => {
    const schema = buildSchema("scalar URL scalar JSON type Query { url: URL! json: JSON }");
    const generated = generateStore(schema, {
      scalarTypes: { URL: "string", JSON: { name: "JsonValue", path: "./json" } },
    });
    expect(generated).toContain('"url": ScalarField<string | null | undefined, string');
    expect(generated).toContain('"json": ScalarField<unknown | null | undefined, never');
    expect(generated).not.toContain("any");
  });

  it("retains default and empty deprecation reasons as JSDoc tags", () => {
    const generated = generateStore(
      buildSchema(`
      type Query {
        old: String @deprecated
        emptyReason: String @deprecated(reason: "")
      }
    `),
    );
    expect(generated).toContain(" * @deprecated No longer supported\n");
    expect(generated).toContain(" * @deprecated\n");
  });
});
