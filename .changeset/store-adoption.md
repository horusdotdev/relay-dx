---
"@relay-dx/store": minor
"@relay-dx/schema": patch
---

Unblock large-schema generation by warning and omitting nested linked lists, and
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
first-party declarations. Pin GraphQL consistently in schema and store so
installed generation uses one GraphQL implementation.
