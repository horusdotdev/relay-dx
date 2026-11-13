# Relay DX

Schema tools and typed store access for Relay: server SDL, client extensions and
Relay Resolvers together. ESM packages with TypeScript declarations.

| Package                                       | Purpose                               | Command        |
| --------------------------------------------- | ------------------------------------- | -------------- |
| [@relay-dx/store](packages/store/README.md)   | Typed reads, updaters and connections | `relay-store`  |
| [@relay-dx/cli](packages/cli/README.md)       | Export effective SDL                  | `relay-schema` |
| [@relay-dx/mcp](packages/mcp/README.md)       | Explore schemas through MCP           | `relay-mcp`    |
| [@relay-dx/schema](packages/schema/README.md) | Load a `GraphQLSchema` and SDL        | —              |

## Requirements

Requires **Node.js 22.18+** and **Relay 21.0.1**. Config must be JSON, including a
`relay` object in `package.json`. Release helpers support macOS/Linux arm64/x64
and Windows x64; Linux needs glibc 2.35+ and OpenSSL 3. No Rust or Watchman needed.

## Typed store

```sh
npm install @relay-dx/store
npx relay-store -o src/__generated__/store.ts
```

```ts
import { store } from "./__generated__/store.js";

const name = store.read(environment, (view) => view.get("User", userID)?.name.get());

environment.commitUpdate(
  store.updater(environment, (view) => {
    const user = view.get("User", userID);
    user?.name.set("Ada");
    user?.posts.connections().removeNodes(postIDs);
  }),
);
```

Fields expose `get`, `require` and updater-only `set`, with schema documentation
and deprecation markers. Record operations live under `$`. Reads may be null or
missing; callbacks are synchronous and handles expire afterward.
[Store reference →](packages/store/README.md)

Relay's low-level record methods accept field names as strings. After refreshing
the local schema and regenerating, this store interface turns removed fields and
incompatible writes into TypeScript errors.
[Schema drift example →](packages/store/README.md#catch-schema-drift)

## Commands

```sh
# Export SDL.
npx @relay-dx/cli ./relay.config.json -o schema.graphql

# Start the stdio MCP server.
npx @relay-dx/mcp --config /absolute/path/to/relay.config.json
```

Each command accepts `[config-path] [options]`:

| Option                   | Commands      | Meaning                                                                 |
| ------------------------ | ------------- | ----------------------------------------------------------------------- |
| `-c, --config <path>`    | All           | Config file or directory; alternative to positional path                |
| `-p, --project <name>`   | All           | Select a project in a multi-project config                              |
| `-o, --output <path>`    | schema, store | Write SDL/TypeScript; omit or use `-` for stdout                        |
| `--cwd <path>`           | mcp, store    | Base directory for discovery and relative paths, including store output |
| `--native-helper <path>` | All           | Override the bundled helper                                             |
| `-h, --help`             | All           | Usage                                                                   |
| `-v, --version`          | All           | Package version                                                         |

Without a config, discovery walks up from the working directory, checking
`package.json` before `relay.config.json`. Choose positional input or `--config`.
File output is atomic; diagnostics use stderr. Exit codes: `0` success, `1` error.
MCP stdout carries JSON-RPC; launch it without task-runner logging.

The low-level `relay-schema-native --config <file> [--project <name>]` returns
JSON and also accepts `-c`, `-p` and `-h/--help`.

[Schema CLI →](packages/cli/README.md) · [MCP setup and tools →](packages/mcp/README.md)

## Schema library

```sh
npm install @relay-dx/schema
```

```ts
import { loadRelaySchema } from "@relay-dx/schema";
const { schema, sdl } = await loadRelaySchema({ configPath: "./relay.config.json" });
```

Extraction preserves descriptions, directives, defaults and deprecations without
executing resolvers or fetching data. Continue using Relay's compiler for operation
validation and artifacts. [Library reference →](packages/schema/README.md)

## Development

Source builds need Node.js 24.18+, [Vite+](https://viteplus.dev/guide/) and stable Rust.
Build before tests to generate fixtures and executables.

```sh
vp install
vp run build
vp run relay
vp run typecheck:fixture
vp run typecheck
vp test run
vp check
vp run smoke:store
```

[Release instructions →](docs/releases.md) · [MIT](LICENSE)
