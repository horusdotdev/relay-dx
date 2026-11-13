# @relay-dx/mcp

Explore a Relay application's effective GraphQL schema over MCP stdio.
Requires Node.js 22.18+ and Relay compiler 21.0.1.

## Connect

Replace the absolute config path in your client's MCP configuration:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["--yes", "@relay-dx/mcp", "--config", "/absolute/path/to/relay.config.json"]
    }
  }
}
```

Append `"--project", "web"` for multi-project configs. Or install
`@relay-dx/mcp` locally and launch `relay-mcp` directly. Avoid task runners that
write logging to stdout; stdout carries JSON-RPC, stderr carries diagnostics.

## Tools

| Tool                | Input                                      | Result                                             |
| ------------------- | ------------------------------------------ | -------------------------------------------------- |
| `schema_overview`   | `{}`                                       | Types, roots and directives                        |
| `search_schema`     | `{ "query": "User", "limit": 50 }`         | Matching types/fields; optional `kind`             |
| `inspect_type`      | `{ "name": "User" }`                       | Fields, arguments, docs, defaults and deprecations |
| `get_sdl`           | `{}`                                       | Effective SDL                                      |
| `validate_document` | `{ "document": "query Q { __typename }" }` | GraphQL validation                                 |
| `refresh_schema`    | `{}`                                       | Reload from disk                                   |

Search limit: 1–200, default 50. Kinds: `SCALAR`, `OBJECT`, `INTERFACE`, `UNION`,
`ENUM`, `INPUT_OBJECT`. Resource: `relay://schema/effective` (`text/plain`).

The server watches project inputs, tolerates schemas created after startup, and
retains the last valid snapshot on reload failure. It never executes resolvers or
fetches data. Validation uses GraphQL.js; run Relay's compiler for Relay transforms.

## Options

```text
relay-mcp [config-path] [options]
```

| Option                   | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `-c, --config <path>`    | JSON config or directory; alternative to positional path      |
| `-p, --project <name>`   | Select a project                                              |
| `--cwd <path>`           | Base directory for discovery and relative schema/helper paths |
| `--native-helper <path>` | Override the bundled helper                                   |
| `-h, --help`             | Usage                                                         |
| `-v, --version`          | Package version                                               |

Without a path, discovery walks upward from `cwd`, checking `package.json`'s
`relay` object before `relay.config.json`. JS/TS configs are unsupported. Choose
positional input or `--config`. `RELAY_MCP_NATIVE_HELPER` also selects a helper.

## Embed

Install `@relay-dx/mcp` and `@modelcontextprotocol/sdk` as direct dependencies:

```ts
import { createRelayMcpServer } from "@relay-dx/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = await createRelayMcpServer({ configPath: "./relay.config.json" });
await server.connect(new StdioServerTransport());
```

Options: `configPath`, `project`, `cwd`, `nativeHelperPath`, `watch`, `loadSchema`.
Call `server.close()` to stop watchers. A custom loader returns `{ schema, sdl }`
and disables watching by default. `watch: false` rejects initial load failures.

[Platform requirements](https://github.com/horusdotdev/relay-dx#requirements) · MIT
