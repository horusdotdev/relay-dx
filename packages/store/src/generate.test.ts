import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vite-plus/test";
import { loadRelaySchema } from "@relay-dx/schema";
import { generateStore, type GenerateStoreOptions } from "./generate.js";

describe("schema-generated record types", () => {
  it("emits schema-named operation roots and excludes roots outside generation scope", () => {
    const schema = buildSchema(`
      schema { query: ReadRoot mutation: WriteRoot subscription: WatchRoot }
      type ReadRoot { value: String }
      type WriteRoot { update: Result }
      type WatchRoot { changed: Result }
      type Result { value: String }
    `);
    const generated = generateStore(schema);
    expect(generated).toContain(
      'createStoreAPI<StoreSchema, "ReadRoot", "WriteRoot" | "WatchRoot">',
    );
    expect(generated).toContain('"operationRoots": [\n    "WriteRoot",\n    "WatchRoot"\n  ]');
    const selected = generateStore(schema, {
      selectedFields: { WriteRoot: { update: true }, Result: { value: true } },
    });
    expect(selected).toContain('createStoreAPI<StoreSchema, "ReadRoot", "WriteRoot">');
    expect(selected).not.toContain('"WatchRoot"');
    const scoped = generateStore(schema, { types: ["Result"] });
    expect(scoped).toContain('createStoreAPI<StoreSchema, "ReadRoot", never>');
  });

  it("skips nested record lists with a diagnostic while preserving usable fields", () => {
    const warnings: string[] = [];
    const generated = generateStore(
      buildSchema(
        "type Query { grid: Grid } type Grid { cells: [[Cell!]]! label: String! } type Cell { value: Int! }",
      ),
      { onWarning: (warning: string) => warnings.push(warning) },
    );
    expect(warnings).toEqual(["Skipping unsupported nested linked list: Grid.cells"]);
    expect(generated).not.toContain('"cells"');
    expect(generated).toContain('"label": ScalarField<string | null | undefined, string');
  });

  it("accepts Relay's future enum sentinel in scalar reads, writes and initializers", () => {
    const generated = generateStore(
      buildSchema("enum Priority { LOW HIGH } type Query { priority: Priority! }"),
    );
    expect(generated).toContain('"LOW" | "HIGH" | "%future added value"');
  });

  it("limits generation to explicit roots and their linked concrete types", () => {
    const schema = buildSchema(`
      interface Asset { id: ID! }
      type Audio implements Asset { id: ID! artist: Artist }
      type Video implements Asset { id: ID! }
      type Artist { name: String! }
      type Invoice { amount: Int! }
      type Query { asset: Asset invoice: Invoice }
    `);
    const full = generateStore(schema);
    const subset = generateStore(schema, { types: ["Asset"] });
    expect(subset).toContain('"Audio"');
    expect(subset).toContain('"Video"');
    expect(subset).toContain('"Artist"');
    expect(subset).toContain('"Query"');
    expect(subset).not.toContain('"Invoice"');
    expect(subset).not.toContain('"invoice"');
    expect(subset.length).toBeLessThan(full.length);
    expect(() => generateStore(schema, { types: ["Typo"] })).toThrow("Unknown stored type");
    expect(() => generateStore(schema, { types: "selected" })).toThrow("requires document");
    expect(
      generateStore(schema, {
        types: "selected",
        selectedFields: { Query: { asset: false }, Asset: { id: false } },
      }),
    ).toBe(
      generateStore(schema, {
        types: ["Asset"],
        selectedFields: { Query: { asset: false }, Asset: { id: false } },
      }),
    );
  });

  it("defaults to document-selected roots with explicit full-schema and plain-schema fallbacks", () => {
    const schema = buildSchema(`
      type Query { studio: Studio invoice: Invoice }
      type Studio { name: String! }
      type Invoice { amount: Int! }
    `);
    const selectedFields = { Query: { studio: false }, Studio: { name: false } };
    const scoped = generateStore(schema, { selectedFields });
    expect(scoped).toBe(generateStore(schema, { selectedFields, types: "selected" }));
    expect(scoped).toContain('"Studio"');
    expect(scoped).not.toContain('"Invoice"');
    expect(generateStore(schema, { selectedFields, types: "all" })).toContain('"Invoice"');
    expect(generateStore(schema)).toBe(generateStore(schema, { types: "all" }));
    expect(generateStore(schema, { selectedFields: {} })).not.toContain('"Studio"');
    schema.extensions = { relay: { selectedFields } };
    expect(generateStore(schema)).toBe(scoped);
  });

  it("includes selected linked types without own field selections and scopes mutation results", () => {
    const schema = buildSchema(`
      type Query { preview: Preview }
      type Mutation { publish: Preview charge: Receipt }
      type Preview { title: String! }
      type Receipt { amount: Int! }
    `);
    const selections: NonNullable<GenerateStoreOptions["selectedFields"]>[] = [
      { Query: { preview: false } },
      { Mutation: { publish: false } },
    ];
    for (const selectedFields of selections) {
      const generated = generateStore(schema, { selectedFields });
      expect(generated).toContain('"Preview"');
      expect(generated).not.toContain('"Receipt"');
    }
  });

  it("tightens initializer requirements when another document starts selecting a non-null field", () => {
    const schema = buildSchema(
      "type Query { post: Post } type Post { id: ID! title: String! body: String! }",
    );
    const before = generateStore(schema, { selectedFields: { Post: { id: false, title: false } } });
    expect(before).toContain('readonly "body"?: string;');
    const after = generateStore(schema, {
      selectedFields: { Post: { id: false, title: false, body: false } },
    });
    expect(after).toContain('readonly "body": string;');
    expect(after).not.toContain('readonly "body"?: string;');
  });

  it("inherits selected semantic non-null requirements from interfaces", () => {
    const schema = buildSchema(`directive @semanticNonNull(levels: [Int] = [0]) on FIELD_DEFINITION
      interface Named { name: String @semanticNonNull }
      type User implements Named { id: ID! name: String }
      type Query { user: User }`);
    expect(generateStore(schema, { selectedFields: { Named: { name: false } } })).toContain(
      'readonly "name": string;',
    );
  });

  it("collects selected fields and fragment-local required annotations", async () => {
    const loaded = await loadRelaySchema({
      configPath: fileURLToPath(new URL("../fixtures/relay.config.json", import.meta.url)),
    });
    expect(loaded.selectedFields.CreationFixture.requiredLabel).toBe(true);
    expect(loaded.selectedFields.CreationFixture.conditional).toBe(false);
    expect(loaded.selectedFields.CreationFixture).not.toHaveProperty("unselected");
    expect(loaded.selectedFields.Post).not.toHaveProperty("body");
  });
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
    expect(generateStore(schema.schema, { scalarTypes: { URL: "string" }, types: "all" })).toBe(
      generated,
    );
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
    const scoped = generateStore(schema, {
      types: "selected",
      selectedFields: { Query: { stored: false }, Model: { id: false } },
    });
    expect(scoped).toContain('"stored": ScalarField<string | null | undefined, string');
    expect(scoped).not.toContain('"Model"');
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
