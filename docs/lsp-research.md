# Relay 21.0.1 native LSP schema probe

The published `relay-compiler` 21.0.1 binary includes an LSP subcommand:

```sh
cd examples/kitchen-sink
../../../node_modules/.bin/relay-compiler lsp relay.config.json --output quiet
```

The process speaks JSON-RPC over stdio using normal `Content-Length` framed
messages. The compiler config is the positional argument to `lsp`; its paths
are resolved relative to the LSP process working directory. Starting the LSP
from the repository root while passing `examples/kitchen-sink/relay.config.json`
therefore fails because `./src` is resolved from the root. Spawn it with the
project directory as `cwd`.

Initialization uses the ordinary LSP handshake. The useful sequence is:

1. Send `initialize` with `rootUri` and `workspaceFolders` for the project.
2. Send the `initialized` notification.
3. Send `textDocument/didOpen` for the schema, schema extension, and source
   files (the LSP's watchman-backed initial state build is triggered by these
   notifications in the standalone probe).
4. Wait for `window/showStatus` with `shortMessage: "Relay: ready"` before
   requesting schema data.

The server uses watchman for its initial source query. The installed probe had
`/opt/homebrew/bin/watchman`; there is no LSP `--noWatchman` option. A request
sent before the ready status returns error `-32001` with “schema is missing (or
not ready, yet)”.

The schema name for a single project is `default`. The relevant private Relay
LSP requests are:

```json
{"jsonrpc":"2.0","id":2,"method":"relay/searchSchemaItems","params":{"schema_name":"default","filter":"User","take":500,"skip":0}}
{"jsonrpc":"2.0","id":3,"method":"relay/exploreSchemaForType","params":{"schema_name":"default","item":"User","filter":null}}
```

`relay/searchSchemaItems` returns sorted named types and supports pagination.
`relay/exploreSchemaForType` returns the effective type, field arguments,
rendered type strings, type references, descriptions, directives, and
`is_extension`. On the kitchen-sink fixture it correctly returned the server
fields on `User`, the `clientLabel` schema extension, and resolver fields
(`profileCard`, `isCurrentUser`, `greeting`, and `displayName`) with
`relay_resolver` metadata and root fragment names. It also includes generated
resolver model types such as `ProfileCardModel`.

There is no full-schema request in the public LSP dispatch. The only other
GraphQL request is `graphql/executeQuery`; it parses and Relay-transforms an
operation and returns printed operation text, rather than executing an
introspection query. `exploreSchemaForType` hard-codes `DEFAULT_COUNT = 100`
for object fields and does not accept a count or offset parameter. Its `filter`
is a substring filter over field name, named return type, or return-type
description; it is not pagination. Therefore a type with 120 fields returns
only the first 100. Completion can help discover fields interactively, but it
is not a reliable full schema transport. Exact extraction should use Relay's
Rust compiler crates to build and print the schema, with LSP retained as an
optional fallback for editor-style inspection.
