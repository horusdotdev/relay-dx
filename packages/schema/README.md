# @relay-dx/schema

Load the effective GraphQL schema of a Relay application as a `GraphQLSchema`
and SDL. The official Relay compiler combines the server schema, client schema
extensions, and Relay Resolvers, including base-project relationships and
feature flags.

## Install

```sh
npm install @relay-dx/schema
```

Requires Node.js **22.18.0 or newer**. The bundled native helper uses Relay
**21.0.1**. If the target project has an installed `relay-compiler`, its version
must match the helper; a mismatch fails with `COMPILER_VERSION_MISMATCH`.

Release packages include native helpers for macOS arm64/x64, Linux arm64/x64,
and Windows x64. Linux requires glibc 2.35 or newer and OpenSSL 3. Rust and
Watchman are not required to use a supported release package.

## Load a schema

This package is ESM-only and includes TypeScript declarations.

```ts
import { loadRelaySchema, RelaySchemaError } from "@relay-dx/schema";

try {
  const result = await loadRelaySchema({
    configPath: "/absolute/path/to/app/relay.config.json",
    // project: "web", // Select a project in a multi-project config.
  });

  console.log(result.schema.getQueryType()?.getFields());
  console.log(result.sdl);
} catch (error) {
  if (error instanceof RelaySchemaError) {
    console.error(error.message, error.diagnostics);
  }
  throw error;
}
```

### `loadRelaySchema(options?)`

Returns `Promise<RelaySchemaResult>`. Each call reads the project again.

| Option                      | Meaning                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `configPath?: string`       | JSON config file, `package.json` with a `relay` object, or project directory. Relative paths resolve against `cwd`. |
| `project?: string`          | Project name. Required when the config contains more than one project. A sole project is selected automatically.    |
| `cwd?: string`              | Directory for config discovery and relative paths; defaults to `process.cwd()`.                                     |
| `nativeHelperPath?: string` | Path to a compatible native executable; overrides the bundled helper and environment variable.                      |

Without `configPath`, discovery walks up from `cwd`, checking a `relay` object
in `package.json` before `relay.config.json` in each directory. A directory
passed as `configPath` starts discovery there. Executable JavaScript and
TypeScript configuration files are not supported.

### Result

| Property                                     | Contents                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `schema`                                     | GraphQL.js `GraphQLSchema` for inspection and standard GraphQL validation.         |
| `sdl`                                        | Combined schema as GraphQL SDL with a trailing newline.                            |
| `projectName`, `configPath`, `rootDirectory` | Selected project and resolved configuration metadata.                              |
| `schemaPaths`, `schemaExtensionPaths`        | Resolved schema files and extension files, including base-project extensions.      |
| `compiler`                                   | Native helper `path`, compiler `version`, and `available` status.                  |
| `diagnostics`                                | Diagnostics with `severity`, `code`, `message`, and optional `path` and `project`. |

TypeScript exports include `LoadRelaySchemaOptions`, `RelaySchemaResult`,
`RelaySchemaDiagnostic`, and `RelayCompilerInfo`. Extraction failures throw
`RelaySchemaError`, whose `diagnostics` array provides additional details when
available.

## Extraction behavior

Extraction reads local files without executing application resolvers, sending
GraphQL requests, generating Relay artifacts, or persisting operations.
Descriptions from server SDL, client extensions, and resolver docblocks are
preserved, along with directives, defaults, and deprecations. Original formatting
and `#` comments are not retained. Compiler-internal fields and directives are
included. For `schemaCompact`, descriptions must already exist in the compact
input.

This is a schema inspection API. GraphQL.js validation does not run Relay
transforms or check all Relay compiler conventions; continue to compile your
operations with Relay.

## Native helper troubleshooting

If the helper is missing or cannot run, check your operating system,
architecture, and Linux runtime requirements. You can select a custom helper
with `nativeHelperPath` or `RELAY_MCP_NATIVE_HELPER`; relative paths resolve
against `cwd`. It must implement this package's helper protocol and use the
correct Relay compiler version. The included `relay-schema-native` command is
the low-level helper dispatcher; use `@relay-dx/cli` for human-facing SDL export.

For source builds and compiler compatibility details, see the
[repository documentation](https://github.com/horusdotdev/relay-dx#readme).

## Related packages

- [@relay-dx/cli](https://www.npmjs.com/package/@relay-dx/cli): export SDL from the command line.
- [@relay-dx/mcp](https://www.npmjs.com/package/@relay-dx/mcp): explore schemas from an MCP client.

Licensed under MIT.
