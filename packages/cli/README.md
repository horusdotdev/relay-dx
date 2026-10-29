# @relay-dx/cli

Export the GraphQL schema available to a Relay application: server schema,
client schema extensions, and Relay Resolvers together. Extraction uses the
official Relay compiler through `@relay-dx/schema`.

## Quick start

```sh
npx @relay-dx/cli /path/to/app/relay.config.json --output effective-schema.graphql
```

Or install the package in your project:

```sh
npm install --save-dev @relay-dx/cli
npx relay-schema --output effective-schema.graphql
```

Requires Node.js **22.18.0 or newer**. The native helper is pinned to Relay
**21.0.1**; an installed `relay-compiler` in the target project must match.
Release packages support macOS arm64/x64, Linux arm64/x64, and Windows x64.
Linux requires glibc 2.35 or newer and OpenSSL 3. Supported release packages do
not require Rust or Watchman.

## Command reference

```text
relay-schema [config-path] [options]
```

| Option                   | Meaning                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `-c, --config <path>`    | Config file or project directory; alternative to the positional path. |
| `-p, --project <name>`   | Select a project when the config contains multiple projects.          |
| `-o, --output <path>`    | Write SDL to a file. Omit or use `-` for stdout.                      |
| `--native-helper <path>` | Use a custom compatible native helper executable.                     |
| `-h, --help`             | Print usage.                                                          |
| `-v, --version`          | Print the CLI package version.                                        |

Supply the config path either positionally or with `--config`. With no path,
the command searches the current directory and its ancestors for a `relay`
object in `package.json` or `relay.config.json`, in that order per directory.
A supplied directory starts discovery there. Configuration must be JSON;
JavaScript and TypeScript config files are not loaded.

```sh
# Discover configuration and print SDL to stdout.
npx relay-schema > effective-schema.graphql

# Select one project from a multi-project configuration.
npx relay-schema ./relay.config.json --project web --output ./schemas/web.graphql

# Discover configuration from a project directory.
npx relay-schema /path/to/app --output -
```

File output creates missing parent directories and replaces the destination
atomically. SDL goes to stdout; file-write status and errors go to stderr.
The exit status is `0` on success (including help/version) and `1` on failure.

## Programmatic use

The ESM entry point exports `runCli` and the TypeScript `CliIO` interface.
`runCli` returns an exit code without terminating the process:

```ts
import { runCli } from "@relay-dx/cli";

const exitCode = await runCli(["/path/to/app/relay.config.json", "--project", "web"], {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
process.exitCode = exitCode;
```

For a `GraphQLSchema` object and structured diagnostics, use
[@relay-dx/schema](https://www.npmjs.com/package/@relay-dx/schema) directly.

## Compatibility and troubleshooting

- **Config not found:** pass an explicit JSON config path or a `package.json`
  containing a `relay` configuration object.
- **Project selection required:** pass `--project` with one of the names in
  the error message.
- **Compiler version mismatch:** the installed Relay compiler must match the
  helper's 21.0.1 compiler. Other versions require a rebuilt compatible helper.
- **Native helper missing or unable to run:** check platform and Linux runtime
  requirements. Override with `--native-helper` or `RELAY_MCP_NATIVE_HELPER`.
  Relative helper paths resolve from the current working directory.

Extraction reads local files without running application resolvers, making
GraphQL requests, or generating Relay artifacts. Documentation descriptions,
applied directives, defaults, and deprecations are preserved, including
compiler-internal schema elements. Original formatting and `#` comments are
not preserved. Descriptions omitted from `schemaCompact` inputs cannot be
recovered. Exporting a schema does not validate Relay operations or replace
running the Relay compiler.

See the [repository](https://github.com/horusdotdev/relay-dx#readme) for source
build instructions, or use [@relay-dx/mcp](https://www.npmjs.com/package/@relay-dx/mcp)
to explore the same schema through an MCP client.

Licensed under MIT.
