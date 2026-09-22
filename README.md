# Relay DX

Explore the GraphQL schema available to a Relay application: server schema,
client schema extensions, and Relay Resolvers together.

This Vite+ monorepo contains:

| Package                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `@relay-dx/schema`       | Load a Relay project into a `GraphQLSchema` and export its SDL |
| `@relay-dx/cli`          | The `relay-schema` extraction command                          |
| `@relay-dx/mcp`          | The `relay-mcp` stdio server for AI agents                     |
| `@relay-dx/kitchen-sink` | A real Relay project used by integration tests                 |

## Build and verify

Prerequisites: Node.js 24.18+, [Vite+](https://viteplus.dev/guide/), and a recent
stable [Rust toolchain](https://rustup.rs/). The native helper uses Rust edition
2024 and was tested with Rust 1.94.1. The first build downloads and compiles the
pinned Relay compiler crates; later builds reuse Cargo's cache.

```sh
vp install
vp run build
vp run relay
vp run typecheck:fixture
vp test run
vp check
vp run typecheck
```

Build before running the test suite: the stdio integration test launches the
built MCP executable. The root `.node-version` and `packageManager` field pin
Node and pnpm. Vite+ handles library packaging, tests, formatting, linting,
type checking, and workspace task ordering. CI runs on Ubuntu.

## Export a schema

From this checkout:

```sh
node packages/cli/dist/cli.js examples/kitchen-sink/relay.config.json \
  --output /tmp/effective-schema.graphql

# A project directory or config file can be supplied.
node packages/cli/dist/cli.js /path/to/app > /tmp/effective-schema.graphql

# Multi-project Relay configuration requires an explicit project.
node packages/cli/dist/cli.js tests/fixtures/multi-project/relay.config.json \
  --project app --output /tmp/app-schema.graphql

# From the published package
npx @relay-dx/cli /path/to/app/relay.config.json --output /tmp/effective-schema.graphql
```

The package exposes the `relay-schema` executable when installed. Omit the
config path to discover a config from the current directory. `--output -`
prints SDL to stdout. File output creates parent directories and replaces the
destination atomically; errors and status messages go to stderr.

## Connect an MCP client

Add this to your client's MCP server configuration, replacing both absolute
paths:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": [
        "/absolute/path/to/relay-dx/packages/mcp/dist/cli.js",
        "--config",
        "/absolute/path/to/app/relay.config.json"
      ]
    }
  }
}
```

Add `"--project", "web"` for a multi-project config. The package also exposes
the `relay-mcp` executable when installed. Use the executable directly for
stdio clients; task-runner output can interfere with the protocol.

For a published installation, use `npx` in the MCP client configuration:

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

| Tool                | What it returns                                                          |
| ------------------- | ------------------------------------------------------------------------ |
| `schema_overview`   | Root operation types, type names/counts, and directives                  |
| `search_schema`     | Matching type/field names, with a result limit                           |
| `inspect_type`      | Fields, arguments, defaults, deprecations, directives, and relationships |
| `get_sdl`           | The combined schema as GraphQL SDL                                       |
| `validate_document` | Standard GraphQL validation results                                      |
| `refresh_schema`    | Reloaded schema after source/config edits                                |

The SDL is also available as the resource `relay://schema/effective`.
The server loads one configured project and keeps a snapshot until refresh.
It reads schema information locally; it does not execute application resolvers
or send operations to a GraphQL endpoint.

`validate_document` uses GraphQL.js validation, not Relay operation transforms.
Relay-specific fragment arguments and other compiler conventions still require
running the Relay compiler. A successful validation result is a schema check,
not a guarantee that an operation will compile with Relay.

## Use the library

```ts
import { loadRelaySchema } from "@relay-dx/schema";

const result = await loadRelaySchema({
  configPath: "/path/to/app/relay.config.json",
  // project: "web",
});

console.log(result.schema.getQueryType()?.getFields());
console.log(result.sdl);
```

## How extraction works

The schema package calls a small native helper linked against the official
Relay **21.0.1** compiler crates. It loads Relay configuration and sources,
then invokes Relay's schema-building pipeline and schema printer. Relay itself
handles client extensions, resolver docblocks, feature
flags, source exclusions, and base-project relationships. Extraction does not
generate Relay artifacts or persist operations, and does not require Watchman.

The helper is built for the current machine. Building from source requires
Rust; using a built package requires a matching native executable. An explicit
`--native-helper` path (library option `nativeHelperPath`) can override it.
The release workflow builds packages for supported macOS, Linux, and Windows
targets; npm publishing remains gated by the repository release variable.

Compatibility is pinned to Relay 21.0.1. Other Relay versions may use different
configuration or resolver semantics; changing the helper's Relay dependency
requires rebuilding and testing against that release. If the target project
has a different installed `relay-compiler` version, extraction reports the
mismatch instead of returning a schema built with different semantics.

Configuration input supports JSON files and the `relay` key in `package.json`.
Executable JavaScript/TypeScript config files are not loaded by this wrapper.

The export preserves documentation descriptions from server SDL, client schema
extensions, and resolver docblocks, including schema/type/field descriptions,
arguments, input fields, enum values, and directives. The CLI and MCP expose the
same descriptions. Compiler type/field structure, applied directives, defaults,
and deprecations are retained; original formatting and `#` comments are not.
Compiler-internal fields and directives are included in the export.
For `schemaCompact` inputs, server descriptions must already be present in the
compact file; documentation discarded when creating it cannot be recovered.

See [the extraction research](docs/relay-schema-research.md) and
[WASM investigation](docs/wasm-research.md) for the upstream APIs and tradeoffs.

## Release packages

`@relay-dx/schema`, `@relay-dx/cli`, and `@relay-dx/mcp` are public packages in
one fixed Changesets release group. The workspace and kitchen-sink fixture are
private. The release workflow verifies on Ubuntu, builds native helpers for
macOS, Linux, and Windows, and uploads packed packages as `changeset-pack-*`
artifacts. Version `0.1.0` is published, trusted publishing is registered for
all three packages, and `NPM_TRUSTED_PUBLISHING=true` enables future releases
after the version PR is merged. See the [release guide](docs/releases.md) for
the workflow and new-package bootstrap.

## Test projects

The [kitchen sink](examples/kitchen-sink/) covers server objects, interfaces,
unions, inputs, enums, scalars, connections, a mutation, client extensions,
strong/weak client models, root-fragment and live resolvers, modern resolver
syntax, an excluded resolver, and an object with more than 100 fields.
The [multi-project fixture](tests/fixtures/multi-project/) tests base-project
schema extensions and explicit project selection.

The suite exercises native extraction, the file/stdout CLI, MCP tools with the
official SDK's in-memory transport, and a built MCP process over real stdio.
