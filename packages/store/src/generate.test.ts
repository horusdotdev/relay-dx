import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vite-plus/test";
import { loadRelaySchema } from "@relay-dx/schema";
import { generateStore } from "./generate.js";

describe("schema-generated record types", () => {
  it("includes base-project keys without leaking keys from other projects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-connection-keys-"));
    try {
      await writeFile(
        join(directory, "schema.graphql"),
        "type Query { viewer: User } type User { posts(first: Int): PostConnection! } type PostConnection { edges: [PostEdge!]!, pageInfo: PageInfo! } type PostEdge { node: Post, cursor: String } type Post { id: ID! } type PageInfo { endCursor: String }",
      );
      for (const [name, prefix] of [
        ["base", "Base"],
        ["app", "App"],
        ["other", "Other"],
      ]) {
        await mkdir(join(directory, name));
        await writeFile(
          join(directory, name, `${prefix}.ts`),
          `const fragment = graphql\`fragment ${prefix}_user on User { posts(first: 5) @connection(key: "${prefix}_posts") { edges { node { id } } } }\`;`,
        );
      }
      const configPath = join(directory, "relay.config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          root: ".",
          sources: { base: "base", app: "app", other: "other" },
          projects: {
            base: { schema: "schema.graphql", language: "typescript" },
            app: { base: "base", schema: "schema.graphql", language: "typescript" },
            other: { schema: "schema.graphql", language: "typescript" },
          },
        }),
      );
      const app = await loadRelaySchema({ configPath, project: "app" });
      expect(app.connectionKeys).toEqual({ User: { posts: ["App_posts", "Base_posts"] } });
      const base = await loadRelaySchema({ configPath, project: "base" });
      expect(base.connectionKeys).toEqual({ User: { posts: ["Base_posts"] } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("extracts source keys by schema field, retaining aliases and interface declarations", async () => {
    const loaded = await loadRelaySchema({
      configPath: fileURLToPath(new URL("../fixtures/relay.config.json", import.meta.url)),
    });
    expect(loaded.connectionKeys).toEqual({
      Group: { items: ["StoreFixture_feed"] },
      HasPosts: { posts: ["ConnectionKeysFixture_posts"] },
      User: {
        posts: ["ConnectionKeysFixture_other", "StoreFixture_posts"],
        archivedPosts: ["StoreFixture_archivedPosts"],
      },
    });
    const source = generateStore(loaded.schema);
    expect(source).toContain(
      '"ConnectionKeysFixture_other" | "ConnectionKeysFixture_posts" | "StoreFixture_posts"',
    );
  });
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
