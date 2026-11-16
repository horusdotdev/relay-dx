# @relay-dx/store

Typed Relay store reads, updaters and connection helpers, generated from your schema.

## Install and generate

```sh
npm install @relay-dx/store
npx relay-store -o src/__generated__/store.ts
```

Regenerate after schema, resolver or Relay document changes. Continue running
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
  store.updater((view) => {
    const user = view.get("User", userID)!;
    user.name.set("Ada");
    user.name.require();
    user.posts.get({ first: 20 });
    user.posts.connections().removeNodes(postIDs);

    const post = view.upsert("Post", {
      id: "client:new-post",
      title: "New post",
      status: "DRAFT",
      tags: [],
      author: user,
    });
    post.author.get()?.name.get();
    user.$.getDataID();
  }),
);
```

`store.updater` works with mutation `updater`/`optimisticUpdater`, subscriptions
and local updates. Type the response with
`store.updater<MyMutation["response"]>(callback)`.
Use `store.proxy(rawStore, callback)` inside an existing updater.
The environment is optional for updater work: `store.updater(callback)` and
`store.proxy(rawStore, callback)` keep shared helpers and mutation hooks
independent of it. These overloads also support pruning and connection discovery,
using the current Relay 21 updater sources. `read` still needs an environment.

Reads return nullable/missing values even for schema-non-null fields. `require`
checks only the outer value. Writes follow schema nullability; creation is
typed by app-wide selections. Callbacks are synchronous: return plain values, since record and field
handles expire afterward. Read-only accessors have no `set` method.

## Reference

| Access            | Operations                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store             | `createClientID(type)`, `read(environment, callback)`, `updater(callback)`, `proxy(rawStore, callback)`; updater overloads also accept an environment                                                                        |
| View              | `get(type, id)`, `getRoot()`, updater-only `upsert(type, fields)`, `invalidateStore()` and `delete(type, id, { prune?: boolean })`                                                                                           |
| Field             | `get(args?)`, `require(args?)`, `variants()`, updater-only `set(value, args?)`                                                                                                                                               |
| Linked list       | Updater-only `append(record, args?)`, `prepend(record, args?)`                                                                                                                                                               |
| Record            | `$.getDataID()`, `$.getType()`, `$.as(type)`; updater-only `$.invalidate()` and `$.setType(type)`                                                                                                                            |
| Connection field  | `keys()`, `connections(key?)`, `connection(key, filters?)`; updater-only `createConnection(key, filters?)`                                                                                                                   |
| Connection family | `variants()`, `include(record)`; updater-only `appendNode(node)`, `prependNode(node)`, `removeNodes(ids)`, `filter(predicate)`, `sort(compare)`                                                                              |
| Connection        | `record`, `nodes()`; updater-only `appendNode(node)`, `prependNode(node)`, `createEdge(node)`, `insertEdgeAfter(edge, cursor?)`, `insertEdgeBefore(edge, cursor?)`, `removeNodes(ids)`, `filter(predicate)`, `sort(compare)` |

`get(type, id)` returns `undefined` for absent/deleted records and throws on a type
mismatch. `$.as(type)` returns a concrete refinement or `undefined`.
Interfaces expose their declared fields; unions expose fields after `$.as()`.
Only valid concrete members are offered, including in connection callbacks.

Updaters can call `record.$.invalidate()` or `view.invalidateStore()` to mark
cached data stale through Relay. `$.as(type)` checks the existing typename;
`$.setType(type)` explicitly writes a possible concrete typename and returns its
typed handle. Use the latter only when deliberately refining cached data; it
does not initialize the new type's fields.

```ts
view.delete("Post", postID, { prune: true });
```

`prune` scans the store and current updater changes, removing matching connection
edges and linked-list entries before deletion. Remaining items keep their order;
counts, pagination metadata and singular links are unchanged. Omit it for plain deletion.

### Creating and inserting records

```ts
// Generate once before committing; reuse the ID in optimistic replays.
const temporaryID = store.createClientID("Post"); // client:Post:<uuid>

// Inside an updater:
const post = view.upsert("Post", {
  id: temporaryID,
  title: "New post",
  status: "DRAFT",
  tags: [],
  author: user,
});
user.posts.connections().prependNode(post);
user.friends.append(otherUser);
```

`upsert` creates an absent record or merges supplied fields into an existing one.
It returns a typed handle, which can be passed into another upsert. Required
initializer fields follow selected non-null fields across app documents, including
semantic nullability and `@required`; regenerate before type-checking in CI.
Linked handles are not checked for completeness. Omitted optional fields stay unchanged.
Required fields apply on every upsert because the record might be absent; use field
setters for partial edits to an existing record.

Abstract initializer errors name the concrete type choices.

Argumented fields are optional. Initialize specific variants with, for example,
`label: { args: { locale: "en" }, value: "Hello" }`, or an array of such entries.

The insertion helpers skip records already present by Relay ID, preserving their
position and cursor. Empty, null or missing lists initialize on insertion. Counts
and pagination metadata stay unchanged. `createClientID` uses `crypto.randomUUID()`.

### Connections

```ts
// All known keys and cached filter variants for this field.
const posts = user.posts.connections();
posts.removeNodes(postIDs); // Every cached filter variant on this user.
posts
  .filter((post) => post.title.get()?.includes(searchText) === true)
  .sort((a, b) => (a.title.get() ?? "").localeCompare(b.title.get() ?? ""));

// Select one variant by its non-pagination arguments.
const drafts = user.posts.connection("Feed_posts", { filter: { status: "DRAFT" } });
drafts?.nodes().map((post) => post.title.get());

// Keys come from @connection directives and are checked against this field.
for (const key of user.posts.keys()) {
  user.posts.connections(key).removeNodes(postIDs);
}

// Explicitly include a connection created in this updater.
posts.include(connectionRecord).removeNodes(postIDs);

// Across every parent, explicitly opt in.
view.connections("User", "posts", { parents: "all", key: "Feed_posts" }).removeNodes(postIDs);
```

`keys()` includes keys declared in the selected project and its base projects;
connections for those keys may not currently be cached. Aliases map to the actual
schema field. Unknown keys, including keys belonging to another field, are rejected.
`include(record)` adds a same-scope, typed connection record to this selection.

To seed a connection before its first payload, use its field's updater-only
`createConnection(key, filters?)`:

```ts
const recordings = studio.recordings.createConnection("Library_recordings", {
  genre: "classical",
});
recordings.prependNode(recording);
recordings.record.entryCount.set(1);
```

This creates or reuses the handled connection, links it under Relay's handle key,
and initializes missing edges, page info and the edge index needed by later
pagination payloads. Repeated calls preserve existing edges and page info.
Filters and keys have the same checks as `connection`. Other required schema
fields, such as counts, must be set explicitly.

Counts remain caller-managed: pagination caches do not necessarily contain every
server item.

`filter` and stable `sort` edit cached edges using current updater values, keeping
node records, cursors, counts and pagination metadata. Missing nodes are skipped by
callbacks and retained; sorting keeps their slots. `nodes()` reads cached nodes;
outside updaters, use array `filter`/`toSorted` on that result. Callbacks must be
synchronous. Later server responses can restore or reorder edges.

### Plain field variants

`field.variants()` enumerates cached argument variants of scalar or linked fields,
including unpublished updater edits. Each entry has `storageKey`, `get()` and
`require()`, plus a typed `set(value)` in updaters for writable fields:

```ts
for (const variant of studio.takes.variants()) {
  const remaining = (variant.get() ?? []).flatMap((item) =>
    item && item.$.getDataID() !== removedID ? [item] : [],
  );
  variant.set(remaining);
}
```

Storage keys are opaque; variants do not decode them into argument objects. They
retain their field's value type, nullability and callback lifetime. For handled
connections, use `connections().variants()` to enumerate the handle variants.

### Supported fields

Stored server/client fields are included; resolvers, internal fields and resolver
model types are excluded. Built-ins, enums and custom mappings to `string`,
`number` or `boolean` support writes. Other scalars read as `unknown` without
`set`. Enum reads, writes and initializers accept Relay's `"%future added value"`
sentinel; writes store it as-is. Arbitrary other enum strings remain type errors.
Object scalar codecs are unsupported. Nested linked lists are omitted with a
warning rather than aborting generation; nested scalar lists remain supported. Arguments use
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
| `--types <names>`        | Type roots, `selected` (default), or `all` for the full schema         |
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
TypeScript; options are `scalarTypes`, `connectionKeys`, `selectedFields`, `types`,
`onWarning` and `runtimeImport` (default
`"@relay-dx/store"`). The CLI reads scalar mappings from the selected config.
`@relay-dx/store/cli` exports `runCli(args, io?)`, returning an exit code.
`loadRelaySchema` supplies keys and field selections automatically. Without selections,
upserts conservatively require every non-null field without arguments. With a plain GraphQL
schema, pass `connectionKeys: { User: { posts: ["Feed_posts"] } }` to register them.

Generation defaults to document-selected type roots and their transitive linked
types and abstract members. The query root remains available, with links to
excluded types omitted; it does not pull unrelated query fields back in.
Scoped generation narrows both the typed API and runtime metadata.

Use `types: ["Studio", "Episode"]` / `relay-store --types Studio,Episode` to choose
roots explicitly. Listing the query root includes all its reachable types.
Use `types: "all"` / `relay-store --types all` to include every supported schema
type, including types used only by local updater code. `types: "selected"` /
`--types selected` explicitly requests document scoping and requires selection
metadata. Plain GraphQL schemas without selections default to all supported types.
Pruning and all-parent scans only recognize types included in the generated metadata.

`onWarning(message)` receives omitted-field diagnostics in programmatic calls
(default: `console.warn`). The CLI always sends these diagnostics to stderr.
The published store package uses Relay 21's own types and an exact Relay peer;
it does not install `@types/relay-runtime`.

[Source builds and demo](https://github.com/horusdotdev/relay-dx#development) · MIT

Requires Relay 21.0.1, Node.js 22.18+ for generation, and `structuredClone` at runtime.
