import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildSchema } from "graphql";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vite-plus/test";
import { loadRelaySchema } from "@relay-dx/schema";
import manifest from "./package.json" with { type: "json" };
import { parseCliArgs, runCli } from "./src/cli.js";
import { createRelayMcpServer, RelayMcpState, type LoadedRelaySchema } from "./src/index.js";

const fixtureSdl = /* GraphQL */ `
  directive @relay(plural: Boolean) on FIELD_DEFINITION | FIELD
  type Query {
    viewer: User
    users(search: String): [User!]!
  }
  type User implements Node {
    id: ID!
    name: String! @deprecated(reason: "Use displayName")
    friends: [User!]! @relay(plural: true)
  }
  interface Node {
    id: ID!
  }
  enum Role {
    ADMIN
    MEMBER
  }
`;

function fixture(): LoadedRelaySchema {
  return {
    schema: buildSchema(fixtureSdl),
    sdl: fixtureSdl,
    projectName: "fixture",
    configPath: "relay.config.json",
  };
}

async function connectedFixture() {
  const server = await createRelayMcpServer({ loadSchema: () => fixture() });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "relay-mcp-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

function textPayload(result: unknown) {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const block = content?.find((item) => item.type === "text");
  if (!block?.text) throw new Error("Expected a text tool result");
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe("Relay MCP server", () => {
  it.each(["schema", "schemaDir"])(
    "starts without a %s and follows creation, edits, and atomic replacement",
    async (schemaOption) => {
      const directory = await mkdtemp(join(tmpdir(), "relay-mcp-watch-"));
      const configPath = join(directory, "relay.config.json");
      const schemaDirectory =
        schemaOption === "schemaDir" ? join(directory, "generated", "schema") : directory;
      const schemaPath = join(schemaDirectory, "schema.graphql");
      await mkdir(join(directory, "src"));
      await writeFile(
        join(directory, "src", "query.ts"),
        "const query = graphql`query WatchQuery { __typename }`;",
      );
      await writeFile(
        configPath,
        JSON.stringify({
          root: ".",
          sources: { src: "app" },
          projects: {
            app: {
              [schemaOption]: schemaOption === "schemaDir" ? "generated/schema" : "schema.graphql",
              language: "typescript",
            },
          },
        }),
      );
      let server: Awaited<ReturnType<typeof createRelayMcpServer>> | undefined;
      const client = new Client({ name: "relay-mcp-watch-test", version: "1.0.0" });
      try {
        const loader = vi.fn(loadRelaySchema);
        server = await createRelayMcpServer({ configPath, loadSchema: loader, watch: true });
        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        expect((await client.callTool({ name: "get_sdl", arguments: {} })).isError).toBe(true);

        const expectSdl = async (field: string) => {
          await expect
            .poll(
              async () => textPayload(await client.callTool({ name: "get_sdl", arguments: {} })),
              { timeout: 5000 },
            )
            .toMatchObject({ sdl: expect.stringContaining(field) });
          const resource = await client.readResource({ uri: "relay://schema/effective" });
          expect(resource.contents[0]).toMatchObject({ text: expect.stringContaining(field) });
        };

        await mkdir(schemaDirectory, { recursive: true });
        await writeFile(schemaPath, "type Query { created: String }");
        await expectSdl("created: String");
        await writeFile(schemaPath, "type Query { edited: String }");
        await expectSdl("edited: String");
        await writeFile(join(directory, "replacement.graphql"), "type Query { replaced: String }");
        await rename(join(directory, "replacement.graphql"), schemaPath);
        await expectSdl("replaced: String");

        const previousLoads = loader.mock.calls.length;
        await writeFile(schemaPath, "type Query {");
        await expect.poll(() => loader.mock.calls.length).toBeGreaterThan(previousLoads);
        await expect(loader.mock.results.at(-1)?.value).rejects.toThrow();
        await expectSdl("replaced: String");
        await rm(schemaPath);
        await writeFile(schemaPath, "type Query { recovered: String }");
        await expectSdl("recovered: String");

        const loadsBeforeConfig = loader.mock.calls.length;
        const newSchemaPath = join(directory, "next", "schema.graphql");
        await writeFile(
          configPath,
          JSON.stringify({ src: "src", schema: "next/schema.graphql", language: "typescript" }),
        );
        // Wait until the changed config has been read before creating its missing directory.
        await expect.poll(() => loader.mock.calls.length).toBeGreaterThan(loadsBeforeConfig);
        await expect(loader.mock.results.at(-1)?.value).rejects.toThrow();
        await mkdir(join(directory, "next"));
        await writeFile(
          newSchemaPath,
          "type Query { reconfigured: String viewer: User } type User { id: ID! }",
        );
        await expectSdl("reconfigured: String");

        await writeFile(
          configPath,
          JSON.stringify({
            src: "src",
            schema: "next/schema.graphql",
            schemaExtensions: ["client.graphql"],
            language: "typescript",
          }),
        );
        await writeFile(join(directory, "client.graphql"), "extend type User { local: String }");
        await expectSdl("local: String");
        await writeFile(
          join(directory, "client.graphql"),
          "extend type User { updatedLocal: String }",
        );
        await expectSdl("updatedLocal: String");
        const loadsBeforeResolver = loader.mock.calls.length;
        await writeFile(
          join(directory, "src", "resolver.ts"),
          '/**\n * @relayField User.greeting: String\n */\nexport function greeting() { return "hi"; }',
        );
        await expect.poll(() => loader.mock.calls.length).toBeGreaterThan(loadsBeforeResolver);
        await expect(loader.mock.results.at(-1)?.value).resolves.toMatchObject({
          sdl: expect.stringContaining("greeting: String"),
        });
        await expectSdl("greeting: String");
      } finally {
        await client.close();
        await server?.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("serializes concurrent reloads so an older load cannot overwrite a newer request", async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let loads = 0;
    const state = new RelayMcpState(async () => {
      const sequence = ++loads;
      if (sequence === 2) {
        started();
        await blocked;
      }
      return { ...fixture(), metadata: { sequence } };
    }, {});
    await state.load();
    const first = state.load();
    const second = state.load();
    await loading;
    try {
      expect(loads).toBe(2);
    } finally {
      release();
      await Promise.all([first, second]);
      await state.close();
    }
    expect(state.effective.loaded.metadata?.sequence).toBe(3);
  });

  it("exposes useful schema tools and the effective schema resource", async () => {
    const { client, server } = await connectedFixture();
    try {
      const tools = await client.listTools();
      expect(client.getServerVersion()).toEqual({ name: "relay-dx", version: manifest.version });
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "schema_overview",
        "search_schema",
        "inspect_type",
        "get_sdl",
        "validate_document",
        "refresh_schema",
      ]);

      const overview = textPayload(
        await client.callTool({ name: "schema_overview", arguments: {} }),
      );
      expect(overview.roots).toEqual({
        query: "Query",
        mutation: undefined,
        subscription: undefined,
      });
      expect(overview.types).toContain("User");

      const search = textPayload(
        await client.callTool({ name: "search_schema", arguments: { query: "friend", limit: 10 } }),
      );
      expect(search.count).toBe(1);
      expect((search.matches as Array<Record<string, unknown>>)[0].parentType).toBe("User");

      const inspected = textPayload(
        await client.callTool({ name: "inspect_type", arguments: { name: "User" } }),
      );
      expect(inspected.kind).toBe("OBJECT");
      const fields = inspected.fields as Array<Record<string, unknown>>;
      expect(fields.map((field) => field.name)).toContain("friends");
      expect(fields.find((field) => field.name === "name")?.deprecationReason).toBe(
        "Use displayName",
      );

      const friends = fields.find((field) => field.name === "friends");
      expect((friends?.directives as Array<Record<string, unknown>> | undefined)?.[0]).toEqual({
        name: "relay",
        arguments: { plural: true },
      });

      const interfaceType = textPayload(
        await client.callTool({ name: "inspect_type", arguments: { name: "Node" } }),
      );
      expect(interfaceType.possibleTypes).toEqual(["User"]);

      const resourceList = await client.listResources();
      expect(resourceList.resources.map((resource) => resource.uri)).toContain(
        "relay://schema/effective",
      );
      const resource = await client.readResource({ uri: "relay://schema/effective" });
      const resourceText = (resource.contents[0] as { text?: string }).text;
      expect(resourceText).toContain("type User");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("validates standard GraphQL documents and reports parse errors as tool errors", async () => {
    const { client, server } = await connectedFixture();
    try {
      const valid = await client.callTool({
        name: "validate_document",
        arguments: { document: "query Viewer { viewer { id name } }" },
      });
      expect(textPayload(valid).valid).toBe(true);
      expect(valid.isError).toBeUndefined();

      const invalid = await client.callTool({
        name: "validate_document",
        arguments: { document: "query Viewer { viewer { missing } }" },
      });
      expect(invalid.isError).toBe(true);
      expect(textPayload(invalid).valid).toBe(false);

      const malformed = await client.callTool({
        name: "validate_document",
        arguments: { document: "query {" },
      });
      expect(malformed.isError).toBe(true);
      expect(textPayload(malformed).phase).toBe("parse");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns structured errors and reloads the configured schema", async () => {
    let loads = 0;
    const { client, server } = await (async () => {
      const relayServer = await createRelayMcpServer({
        loadSchema: () => {
          loads += 1;
          return fixture();
        },
      });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const relayClient = new Client({ name: "relay-mcp-test", version: "1.0.0" });
      await relayServer.connect(serverTransport);
      await relayClient.connect(clientTransport);
      return { client: relayClient, server: relayServer };
    })();
    try {
      const missing = await client.callTool({
        name: "inspect_type",
        arguments: { name: "NoSuchType" },
      });
      expect(missing.isError).toBe(true);
      expect((textPayload(missing).error as Record<string, unknown>).code).toBe("TYPE_NOT_FOUND");

      const refreshed = await client.callTool({ name: "refresh_schema", arguments: {} });
      expect(textPayload(refreshed).refreshed).toBe(true);
      expect(loads).toBe(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps the last good schema when refresh fails", async () => {
    let loads = 0;
    const server = await createRelayMcpServer({
      loadSchema: () => {
        loads += 1;
        if (loads > 1) throw new Error("native helper failed");
        return fixture();
      },
    });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "relay-mcp-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const before = textPayload(await client.callTool({ name: "schema_overview", arguments: {} }));
      const refresh = await client.callTool({ name: "refresh_schema", arguments: {} });
      expect(refresh.isError).toBe(true);
      const after = textPayload(await client.callTool({ name: "schema_overview", arguments: {} }));
      expect(after.types).toEqual(before.types);
      expect((textPayload(refresh).error as Record<string, unknown>).code).toBe(
        "SCHEMA_REFRESH_FAILED",
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects ambiguous and unknown CLI arguments", () => {
    expect(parseCliArgs(["--native-helper", "/tmp/relay-helper", "--project", "app"])).toEqual({
      nativeHelperPath: "/tmp/relay-helper",
      project: "app",
    });
    expect(() => parseCliArgs(["--compiler", "/tmp/old-helper"])).toThrow("Unknown option");
    expect(() => parseCliArgs(["relay.config.json", "--config", "other.json"])).toThrow(
      "either positionally",
    );
  });

  it("prints the package version without starting the server", async () => {
    for (const flag of ["--version", "-v"]) {
      const stdout = new PassThrough(),
        stderr = new PassThrough();
      await runCli([flag], { stdout, stderr });
      expect(stdout.read()?.toString()).toBe(`${manifest.version}\n`);
      expect(stderr.read()).toBeNull();
    }
  });
});
