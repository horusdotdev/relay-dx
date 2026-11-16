# @relay-dx/store

## 0.4.0

### Minor Changes

- db3eca6: Unblock large-schema generation by warning and omitting nested linked lists, and
  accept Relay's future enum sentinel in generated value types. Default generation
  to document-selected type roots and their linked types when selections are available.
  Support explicit roots through `types` / `--types` and full-schema generation with
  `types: "all"` / `--types all`; plain schemas without selections include all types.

  Rename `withUpdater` to `proxy` and add environment-free updater overloads,
  record and store invalidation, explicit typename refinement, handled connection
  creation, and plain field variants.
  Connection discovery includes unpublished parents and handle links. Abstract
  initializer diagnostics identify concrete alternatives without expanding a large
  record union. Preserve strict upsert completeness and caller-managed counts.

  Remove the store package's legacy Relay type dependency, relying on Relay 21's
  first-party declarations. Share GraphQL through a peer dependency across schema,
  store and MCP so generation uses the application's GraphQL implementation.

### Patch Changes

- Updated dependencies [db3eca6]
  - @relay-dx/schema@0.4.0

## 0.3.1

### Patch Changes

- b55027a: Accept Relay's environment interface so `read`, `updater` and `withUpdater` work
  directly with React Relay's `useRelayEnvironment()` without a type cast.
- @relay-dx/schema@0.3.1

## 0.3.0

### Minor Changes

- 59bb289: Add typed connection filtering, stable sorting and cached-node reads. Simplify
  connection selection with direct keys and single-variant lookup, and use typed
  record inclusion in place of candidate IDs. Remove the previous `keys` and
  `candidateIDs` options and the object overload of field `connections()`.

  Extract connection keys from Relay source documents, including aliases and base
  projects. Expose typed field `keys()` inventories and automatically select all
  known keys for each field, with type-checked explicit selection.

  Add opt-in `delete(type, id, { prune: true })` to remove matching connection edges
  and linked-list entries across the current store and updater before deletion,
  preserving remaining order and metadata with optimistic rollback support.

  Add schema-typed `createClientID(type)` generation and duplicate-safe connection
  `appendNode`/`prependNode` and linked-list `append`/`prepend` helpers. Existing
  membership is matched by Relay record ID and keeps its position and cursor.

  Replace `create(type, id)` with `upsert(type, { id, ...fields })`. Generate required
  initializer fields from app-wide selections, semantic nullability and `@required`.
  Argumented fields remain optional; linked fields accept handles without recursive
  validation. Existing records merge supplied fields and preserve omitted fields.

### Patch Changes

- Updated dependencies [59bb289]
  - @relay-dx/schema@0.3.0

## 0.2.0

### Minor Changes

- 04e1453: Add the typed Relay store package and `relay-store` generator command, including
  documented direct field accessors, scoped reads and updaters, and connection
  helpers. Ship built ESM and TypeScript declarations and document installation,
  every public CLI option, and consumer examples. Add MCP command version output.
  Preserve executable permissions for native helpers in single-platform source packs.

### Patch Changes

- Updated dependencies [04e1453]
  - @relay-dx/schema@0.2.0
