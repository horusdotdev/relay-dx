# @relay-dx/schema

Load Relay's effective `GraphQLSchema` and SDL, including client extensions and
resolvers. ESM with TypeScript declarations. Requires Node.js 22.18+; the native
helper is pinned to Relay 21.0.1 and rejects mismatched installed compilers.

```sh
npm install @relay-dx/schema
```

```ts
import { loadRelaySchema } from "@relay-dx/schema";

const { schema, sdl } = await loadRelaySchema({ configPath: "./relay.config.json" });
```

## Options

| Option                      | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `configPath?: string`       | JSON config, package.json with `relay`, or project directory                |
| `project?: string`          | Required when multiple projects exist                                       |
| `cwd?: string`              | Base directory; defaults to `process.cwd()`                                 |
| `nativeHelperPath?: string` | Compatible helper override; takes precedence over `RELAY_MCP_NATIVE_HELPER` |

Without a config path, discovery walks upward from `cwd`, checking `package.json`
before `relay.config.json`. JS/TS configs are unsupported. Calls reload from disk;
failures throw `RelaySchemaError` with structured `diagnostics`.

Results include `schema`, `sdl`, `projectName`, `configPath`, `rootDirectory`,
`schemaPaths`, `schemaExtensionPaths`, `compiler` and `diagnostics`.
`getRelaySchemaWatchPaths(options?)` returns watched input paths without invoking
the helper, including paths that do not exist yet.

## Behavior

Extraction preserves descriptions, directives, defaults and deprecations, including
compiler-internal elements. Original formatting and `#` comments are discarded;
descriptions absent from compact-schema input cannot be recovered. Extraction does
not execute resolvers, fetch data or compile operations.

Supported releases include macOS/Linux arm64/x64 and Windows x64 helpers. Linux
needs glibc 2.35+ and OpenSSL 3; Rust and Watchman are unnecessary. For a custom
build, supply `nativeHelperPath` or `RELAY_MCP_NATIVE_HELPER`.

[Schema CLI](https://www.npmjs.com/package/@relay-dx/cli) ·
[MCP server](https://www.npmjs.com/package/@relay-dx/mcp) ·
[Source builds](https://github.com/horusdotdev/relay-dx#development) · MIT
