# @relay-dx/store

Schema-generated, typed Relay record access with field documentation and
`@deprecated` markers. Requires Relay 21.0.1, Node.js 22.18+ for generation, and a
runtime with `structuredClone`. ESM with declarations; verified with TypeScript 5.9.

## Install and generate

```sh
npm install @relay-dx/store
npx relay-store -o src/__generated__/store.ts
```

Regenerate after schema, client-extension or resolver changes. Continue running
Relay's compiler for operation artifacts.

## Catch schema drift

Suppose the server renames `User.name` to `User.fullName`. After updating the local
schema and regenerating, compare the two updater styles:

```ts
// Relay's low-level RecordProxy: the old field name still type-checks.
rawStore.get(userID)?.setValue("Ada", "name");

// Generated store: TypeScript highlights the removed field.
view.get("User", userID)?.name.set("Ada"); // TS2339: property 'name' does not exist.

// Fix the updater to match the new schema.
view.get("User", userID)?.fullName.set("Ada");
```

Other schema changes are caught too:

| Change                            | Stale code TypeScript rejects after regeneration |
| --------------------------------- | ------------------------------------------------ |
| `String` becomes `Int`            | `user.name.set("Ada")`                           |
| Nullable becomes non-null         | `user.name.set(null)`                            |
| A field argument becomes required | `user.label.get()` without its arguments         |

Run generation before type-checking in CI, using your updated local schema:

```sh
npx relay-store -o src/__generated__/store.ts
npx tsc --noEmit
```

Deprecated fields remain valid but carry editor markers and reasons. This covers
low-level record access; Relay's generated operations and `@updatable` already
provide their own checks. It does not detect remote schema changes automatically.

## Usage

```ts
import { store } from "./__generated__/store.js";

const name = store.read(environment, (view) => view.get("User", userID)?.name.get());

environment.commitUpdate(
  store.updater(environment, (view) => {
    const user = view.get("User", userID)!;
    user.name.set("Ada");
    user.name.require();
    user.posts.get({ first: 20 });
    user.posts.connections().removeNodes(postIDs);

    const post = view.create("Post", "client:new-post");
    post.author.set(user);
    post.author.get()?.name.get();
    user.$.getDataID();
  }),
);
```

`store.updater` works with mutation `updater`/`optimisticUpdater`, subscriptions
and local updates. Type the response with
`store.updater<MyMutation["response"]>(environment, callback)`.
Use `store.withUpdater(environment, rawStore, callback)` inside an existing updater.

Reads return nullable/missing values even for schema-non-null fields. `require`
checks only the outer value. Writes follow schema nullability; creation is
incremental. Callbacks are synchronous: return plain values, since record and field
handles expire afterward. Read-only accessors have no `set` method.

## Reference

| Access            | Operations                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store             | `read(environment, callback)`, `updater(environment, callback)`, `withUpdater(environment, rawStore, callback)`                                     |
| View              | `get(type, id)`, `getRoot()`, updater-only `create(type, id)` and `delete(type, id)`                                                                |
| Field             | `get(args?)`, `require(args?)`, updater-only `set(value, args?)`                                                                                    |
| Record            | `$.getDataID()`, `$.getType()`, `$.as(type)`                                                                                                        |
| Connection field  | `connections({ keys?, candidateIDs? })`                                                                                                             |
| Connection family | `variants()`, `get(key, filters?)`, updater-only `removeNodes(ids)`                                                                                 |
| Connection        | `record`, `createEdge(node)`, `insertEdgeAfter(edge, cursor?)`, `insertEdgeBefore(edge, cursor?)`, `removeNodes(ids)`; mutations require an updater |

`get(type, id)` returns `undefined` for absent/deleted records and throws on a type
mismatch. `$.as(type)` returns a concrete refinement or `undefined`.

### Connections

```ts
user.posts.connections().removeNodes(postIDs); // All published variants on this user.
view.connections("User", "posts", { parents: "all" }).removeNodes(postIDs);

user.posts
  .connections({
    keys: ["Feed_posts"], // Required when fields share a connection type.
    candidateIDs: [newID], // Include unpublished connections explicitly.
  })
  .removeNodes(postIDs);
```

Scans discover published variants; updater lookups see their current values.
Removal preserves node records, counts and pagination metadata. Later responses
can add edges back. Keys, identifying filters and explicit candidate membership
are caller-supplied; filter values and connection/edge/node types are checked.

### Supported fields

Stored server/client fields are included; resolvers, internal fields and resolver
model types are excluded. Built-ins, enums and custom mappings to `string`,
`number` or `boolean` support writes. Other scalars read as `unknown` without
`set`. Object scalar codecs and nested linked lists are unsupported. Arguments use
Relay's storage keys without injecting defaults. Value types are checked by
TypeScript, not a complete runtime GraphQL validator.

## CLI

```text
relay-store [config-path] [options]
```

| Option                   | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `-c, --config <path>`    | JSON config, package.json or directory; alternative to positional path |
| `-p, --project <name>`   | Select a project                                                       |
| `-o, --output <path>`    | Write TypeScript; omit or use `-` for stdout                           |
| `--cwd <path>`           | Base directory for discovery and relative input/helper/output paths    |
| `--native-helper <path>` | Override the bundled helper                                            |
| `-h, --help`             | Usage                                                                  |
| `-v, --version`          | Package version                                                        |

No config path: discover `package.json`'s `relay` object or `relay.config.json`
from the working directory upward. JS/TS configs are unsupported. File output is
atomic; diagnostics use stderr. Exit codes: `0` success, `1` error.
`RELAY_MCP_NATIVE_HELPER` also overrides the helper; the flag takes precedence.

## Programmatic generation

```ts
import { loadRelaySchema } from "@relay-dx/schema";
import { generateStore } from "@relay-dx/store/generate";

const { schema } = await loadRelaySchema({ configPath: "./relay.config.json" });
const source = generateStore(schema, { scalarTypes: { URL: "string" } });
```

Declare `@relay-dx/schema` directly if you import it. `generateStore` returns
TypeScript; options are `scalarTypes` and `runtimeImport` (default
`"@relay-dx/store"`). The CLI reads scalar mappings from the selected config.
`@relay-dx/store/cli` exports `runCli(args, io?)`, returning an exit code.

[Source builds and demo](https://github.com/horusdotdev/relay-dx#development) · MIT
