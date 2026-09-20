import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { buildSchema, isObjectType } from "graphql";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const binary = fileURLToPath(new URL("../packages/mcp/dist/cli.js", import.meta.url));
const config = fileURLToPath(
  new URL("../examples/kitchen-sink/relay.config.json", import.meta.url),
);
const expectedDescriptions = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../examples/kitchen-sink/expected-descriptions.json", import.meta.url)),
    "utf8",
  ),
) as Record<string, string>;

describe("built MCP executable", () => {
  it.each(["direct", "symlink"])(
    "serves the real kitchen-sink schema over stdio through a %s entry point",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "relay mcp stdio "));
      const linkedBinary = join(directory, "relay-mcp.js");
      if (mode === "symlink") await symlink(binary, linkedBinary);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [mode === "symlink" ? linkedBinary : binary, "--config", config],
        stderr: "pipe",
      });
      const client = new Client({ name: "relay-mcp-integration", version: "0.1.0" });
      let stderr = "";
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["inspect_type", "get_sdl", "search_schema"]),
        );
        const result = CallToolResultSchema.parse(
          await client.callTool({ name: "inspect_type", arguments: { name: "User" } }),
        );
        expect(result.isError, stderr).not.toBe(true);
        const text = result.content
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("");
        const user = JSON.parse(text) as {
          description?: string;
          fields: Array<{ name: string; description?: string }>;
        };
        expect(user.fields.map((field) => field.name)).toEqual(
          expect.arrayContaining(["name", "clientLabel", "greeting", "displayName", "profileCard"]),
        );
        expect(user.description).toBe(expectedDescriptions.User);
        expect(user.fields.find((field) => field.name === "name")?.description).toBe(
          expectedDescriptions["User.name"],
        );
        expect(user.fields.find((field) => field.name === "clientLabel")?.description).toBe(
          expectedDescriptions["User.clientLabel"],
        );
        expect(user.fields.find((field) => field.name === "displayName")?.description).toBe(
          expectedDescriptions["User.displayName"],
        );
        const schema = CallToolResultSchema.parse(
          await client.callTool({ name: "get_sdl", arguments: {} }),
        );
        expect(schema.isError).not.toBe(true);
        const schemaText = schema.content
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("");
        const fullSdl = (JSON.parse(schemaText) as { sdl: string }).sdl;
        expect(fullSdl).toContain("ClientDashboard");
        expect(fullSdl).toContain("ProfileCard");
        expect(fullSdl).toContain("tick");
        const exported = buildSchema(fullSdl, { assumeValidSDL: true });
        expect(exported.getType("User")?.description).toBe(expectedDescriptions.User);
        expect(exported.getType("ClientDashboard")?.description).toBe(
          expectedDescriptions.ClientDashboard,
        );

        const resource = await client.readResource({ uri: "relay://schema/effective" });
        const resourceSdl = resource.contents
          .map((content) => ("text" in content ? content.text : ""))
          .join("");
        const resourceUser = buildSchema(resourceSdl, { assumeValidSDL: true }).getType("User");
        if (!isObjectType(resourceUser)) throw new Error("Missing User in SDL resource");
        expect(resourceUser.description).toBe(expectedDescriptions.User);
        expect(resourceUser.getFields().displayName.description).toBe(
          expectedDescriptions["User.displayName"],
        );
      } finally {
        await client.close();
        await transport.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
