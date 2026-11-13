# @relay-dx/cli

Export Relay's effective schema: server SDL, client extensions and resolvers.
Requires Node.js 22.18+ and Relay compiler 21.0.1.

```sh
npx @relay-dx/cli ./relay.config.json -o schema.graphql
```

For repeated use: `npm install --save-dev @relay-dx/cli`, then run `npx relay-schema`.

## Options

```text
relay-schema [config-path] [options]
```

| Option                   | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `-c, --config <path>`    | JSON config or project directory; alternative to positional path |
| `-p, --project <name>`   | Select a project in a multi-project config                       |
| `-o, --output <path>`    | Write SDL; omit or use `-` for stdout                            |
| `--native-helper <path>` | Override the bundled helper                                      |
| `-h, --help`             | Usage                                                            |
| `-v, --version`          | Package version                                                  |

Without a path, discovery walks up from the current directory, checking a `relay`
object in `package.json` before `relay.config.json`. Executable JS/TS configs are
unsupported. Choose positional input or `--config`, not both.

File output creates directories and atomically replaces the destination. SDL goes
to stdout; diagnostics go to stderr. Exit codes: `0` success, `1` error.

## Library use

`@relay-dx/cli` exports `runCli(args, { stdout, stderr }?)`, which returns an exit
code without terminating the process. For a `GraphQLSchema`, use
[@relay-dx/schema](https://www.npmjs.com/package/@relay-dx/schema).

Descriptions, directives, defaults and deprecations are preserved. Extraction does
not execute resolvers or generate Relay artifacts; continue compiling operations
with Relay. Supported release helpers need no Rust or Watchman. For platform
requirements or helper errors, see the
[repository guide](https://github.com/horusdotdev/relay-dx#requirements).
Use `--native-helper` or `RELAY_MCP_NATIVE_HELPER` for a compatible custom helper.

MIT
