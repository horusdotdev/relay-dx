import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { isObjectType } from "graphql";
import { loadRelaySchema, RelaySchemaError } from "./index.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "relay-mcp-schema-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "schema.graphql"),
    "type Query { viewer: User } type User { id: ID! name: String }",
  );
  await writeFile(join(root, "extension.graphql"), "extend type User { localGreeting: String }");
  await writeFile(
    join(root, "src", "resolver.ts"),
    '/**\n * @relayField User.greeting(prefix: String!): String\n */\nexport function greeting() { return "hi"; }',
  );
  await writeFile(
    join(root, "relay.config.json"),
    JSON.stringify({
      src: "./src",
      schema: "./schema.graphql",
      schemaExtensions: ["./extension.graphql"],
      language: "typescript",
    }),
  );
  return root;
}

describe("loadRelaySchema", () => {
  it("loads server SDL, schema extensions, and resolver fields", async () => {
    const root = await fixture();
    const loaded = await loadRelaySchema({ cwd: root });
    expect(loaded.projectName).toBe("default");
    const user = loaded.schema.getType("User");
    expect(user).toBeTruthy();
    if (!isObjectType(user)) throw new Error("Expected User object");
    expect(user.getFields().localGreeting).toBeTruthy();
    expect(user.getFields().greeting?.type.toString()).toBe("String");
    expect(loaded.schemaPaths).toHaveLength(1);
    expect(loaded.schemaExtensionPaths).toHaveLength(1);
  });

  it("selects a named project and reports missing selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-mcp-multi-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    await writeFile(join(root, "a", "empty.ts"), "export const a = 1;");
    await writeFile(join(root, "b", "empty.ts"), "export const b = 1;");
    await writeFile(join(root, "a.graphql"), '"Web API" type Query { a: String }');
    await writeFile(join(root, "b.graphql"), '"Mobile API" type Query { b: String }');
    await writeFile(
      join(root, "relay.config.json"),
      JSON.stringify({
        root: ".",
        name: "web",
        sources: { a: "web", b: "mobile" },
        projects: {
          web: { schema: "a.graphql", language: "typescript" },
          mobile: { schema: "b.graphql", language: "typescript" },
        },
      }),
    );
    await expect(loadRelaySchema({ cwd: root })).rejects.toBeInstanceOf(RelaySchemaError);
    const loaded = await loadRelaySchema({ cwd: root, project: "mobile" });
    expect(loaded.projectName).toBe("mobile");
    expect(loaded.schema.getQueryType()?.getFields().b).toBeTruthy();
    expect(loaded.schema.getQueryType()?.description).toBe("Mobile API");
  });

  it("preserves descriptions across schemaDir files and client extensions", async () => {
    const root = await fixture();
    await mkdir(join(root, "schema"));
    await writeFile(
      join(root, "schema", "query.graphql"),
      '"The API" schema { query: Query } "Query docs" type Query { viewer: User }',
    );
    await writeFile(
      join(root, "schema", "user.graphql"),
      '"User\t\\"docs\\"" type User { id: ID! "Name docs" name: String }',
    );
    await writeFile(
      join(root, "extension.graphql"),
      'extend type User { "Client docs" localGreeting: String }',
    );
    await writeFile(
      join(root, "relay.config.json"),
      JSON.stringify({
        root: ".",
        sources: { src: "app" },
        projects: {
          app: {
            schemaDir: "schema",
            schemaExtensions: ["extension.graphql"],
            language: "typescript",
          },
        },
      }),
    );
    const { schema } = await loadRelaySchema({ cwd: root });
    expect(schema.description).toBe("The API");
    expect(schema.getQueryType()?.description).toBe("Query docs");
    const user = schema.getType("User");
    if (!isObjectType(user)) throw new Error("Missing User");
    expect(user.description).toBe('User\t"docs"');
    expect(user.getFields().name.description).toBe("Name docs");
    expect(user.getFields().localGreeting.description).toBe("Client docs");
  });

  it("discovers from a project directory and leaves its files unchanged", async () => {
    const root = await fixture();
    const before = await readdir(root, { recursive: true });
    const result = await loadRelaySchema({ configPath: root });
    expect(result.schema.getQueryType()?.getFields().viewer).toBeDefined();
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });

  it("uses the package.json relay key before relay.config.json during discovery", async () => {
    const root = await fixture();
    const relay = JSON.parse(await readFile(join(root, "relay.config.json"), "utf8"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", relay }));
    await writeFile(join(root, "relay.config.json"), "{}");
    const result = await loadRelaySchema({ cwd: join(root, "src") });
    expect(result.configPath).toBe(await realpath(join(root, "package.json")));
    expect(result.schema.getQueryType()?.getFields().viewer).toBeDefined();
  });

  it("rejects a missing explicitly selected helper", async () => {
    const root = await fixture();
    await expect(
      loadRelaySchema({ cwd: root, nativeHelperPath: "missing-helper" }),
    ).rejects.toThrow(/nativeHelperPath/);
  });

  it("rejects a different installed compiler version in the target project", async () => {
    const root = await fixture();
    const compilerDirectory = join(root, "node_modules", "relay-compiler");
    await mkdir(compilerDirectory, { recursive: true });
    await writeFile(
      join(compilerDirectory, "package.json"),
      JSON.stringify({ name: "relay-compiler", version: "20.1.0" }),
    );
    await expect(loadRelaySchema({ configPath: root })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: "COMPILER_VERSION_MISMATCH" })],
    });
  });

  it("reports malformed JSON and invalid schema diagnostics", async () => {
    const root = await fixture();
    await writeFile(join(root, "schema.graphql"), "type Query { broken: MissingType }");
    await expect(loadRelaySchema({ cwd: root })).rejects.toThrow(/MissingType/);
    await writeFile(join(root, "relay.config.json"), "{");
    await expect(loadRelaySchema({ cwd: root })).rejects.toThrow(/parse Relay config/);
  });
});
