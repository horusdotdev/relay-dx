import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vite-plus/test";
import { parseCliArgs } from "./src/cli.js";
import { createRelayMcpServer, type LoadedRelaySchema } from "./src/index.js";

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
  it("exposes useful schema tools and the effective schema resource", async () => {
    const { client, server } = await connectedFixture();
    try {
      const tools = await client.listTools();
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
});
