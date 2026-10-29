# @relay-dx/mcp

An MCP server for exploring the effective GraphQL schema of a Relay application.
It exposes the server schema, client extensions, and Relay Resolvers to MCP
clients over stdio, using the official Relay compiler through `@relay-dx/schema`.

## Connect an MCP client

Add the following to a client that accepts `mcpServers` configuration, replacing
the config path with your project's absolute path:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["--yes", "@relay-dx/mcp", "--config", "/absolute/path/to/app/relay.config.json"]
    }
  }
}
```

For a multi-project config, append `"--project", "web"` to `args`, using your
project name. Client-specific configuration locations and formats may differ.

Requires Node.js **22.18.0 or newer** on the client's command PATH. The bundled
native helper uses Relay **21.0.1**, and any installed `relay-compiler` in the
target project must match. Release packages support macOS arm64/x64, Linux
arm64/x64, and Windows x64. Linux requires glibc 2.35 or newer and OpenSSL 3.
Rust and Watchman are not required for supported release packages.

You can also install locally with `npm install --save-dev @relay-dx/mcp` and
configure your client to launch the installed `relay-mcp` executable. Stdout
carries MCP JSON-RPC; diagnostics use stderr. Launch the executable directly
or through `npx`, avoiding task runners that add logging to stdout.

## Tools and resource

| Tool                | Input                                            | Result                                                                                                          |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `schema_overview`   | `{}`                                             | Root operation types, type names/counts, directives, and schema metadata.                                       |
| `search_schema`     | `{ "query": "User", "limit": 50 }`               | Matching type and field names. Optional `kind` filters the type kind; `limit` defaults to 50 and accepts 1–200. |
| `inspect_type`      | `{ "name": "User" }`                             | Fields, arguments, defaults, deprecations, directives, and type relationships.                                  |
| `get_sdl`           | `{}`                                             | The effective schema as SDL with metadata.                                                                      |
| `validate_document` | `{ "document": "query Example { __typename }" }` | Parse/validation results and errors.                                                                            |
| `refresh_schema`    | `{}`                                             | Reload the configured project from disk and return its new overview.                                            |

Search kinds are `SCALAR`, `OBJECT`, `INTERFACE`, `UNION`, `ENUM`, and
`INPUT_OBJECT`. Tool results include JSON text and structured content; failures
are marked with `isError`.

The resource **`relay://schema/effective`** returns the current SDL as
`text/plain`. The server loads one project at startup and keeps a snapshot.
Call `refresh_schema` after editing schema, resolver source, or configuration
files. A failed refresh leaves the previous snapshot available.

The server reads local schema information. It does not execute application
resolvers or send operations to a GraphQL endpoint. Descriptions from server
SDL, client extensions, and resolver docblocks are preserved, as are directives,
defaults, and deprecations. Original formatting and `#` comments are not retained;
compiler-internal fields and directives are included. Compact-schema inputs
must already contain any descriptions you want to inspect.

`validate_document` performs standard GraphQL.js validation. It does not run
Relay transforms, check all Relay naming or fragment conventions, or generate
artifacts. Continue to run the Relay compiler to validate Relay operations.

## Command reference

```text
relay-mcp [config-path] [options]
```

| Option                   | Meaning                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `-c, --config <path>`    | JSON config file, `package.json` with a `relay` object, or project directory; alternative to the positional path. |
| `-p, --project <name>`   | Select a project when the config contains multiple projects.                                                      |
| `--cwd <path>`           | Directory for schema loading and relative paths; defaults to the process working directory.                       |
| `--native-helper <path>` | Override the bundled native helper executable.                                                                    |
| `-h, --help`             | Print usage.                                                                                                      |

Without a config path, discovery walks up from `--cwd` (or the process working
directory), checking a `relay` object in `package.json` before
`relay.config.json` in each directory. A supplied directory starts discovery
there. Executable JavaScript and TypeScript configuration files are unsupported.
Absolute config paths are useful because MCP clients may launch servers from
an unexpected working directory.

## Embed the server

The ESM API includes TypeScript declarations. Install `@modelcontextprotocol/sdk`
as a direct dependency if your application imports its transports:

```sh
npm install @relay-dx/mcp @modelcontextprotocol/sdk
```

```ts
import { createRelayMcpServer } from "@relay-dx/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = await createRelayMcpServer({
  configPath: "/absolute/path/to/app/relay.config.json",
  // project: "web",
});
await server.connect(new StdioServerTransport());
```

`createRelayMcpServer(options?)` loads the schema before resolving to an SDK
`McpServer`; the caller connects a transport and closes the server when done.
Options are `configPath`, `project`, `cwd`, and `nativeHelperPath`, plus an
optional `loadSchema` function for embedding or tests. A custom loader returns
`{ schema, sdl }` synchronously or asynchronously, with optional project,
compiler, diagnostic, and metadata fields. See the exported
`RelayMcpServerOptions`, `RelaySchemaLoader`, and `LoadedRelaySchema` types.

## Troubleshooting

Check the client's stderr logs for startup failures. Pass an explicit JSON
config path for discovery errors and `--project` for ambiguous multi-project
configs. Compiler mismatches require matching Relay 21.0.1 or building a
compatible helper. If a native helper is missing or cannot run, check the
platform requirements above; `--native-helper` or `RELAY_MCP_NATIVE_HELPER`
can select a custom compatible executable. Relative helper paths resolve
against `--cwd` or the process working directory.

See the [repository](https://github.com/horusdotdev/relay-dx#readme) for source
builds, [@relay-dx/schema](https://www.npmjs.com/package/@relay-dx/schema) for
schema loading, and [@relay-dx/cli](https://www.npmjs.com/package/@relay-dx/cli)
for standalone SDL export.

Licensed under MIT.
