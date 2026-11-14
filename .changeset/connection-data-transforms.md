---
"@relay-dx/store": minor
"@relay-dx/schema": patch
---

Add typed connection filtering, stable sorting and cached-node reads. Simplify
connection selection with direct keys and single-variant lookup, and use typed
record inclusion in place of candidate IDs. Remove the previous `keys` and
`candidateIDs` options and the object overload of field `connections()`.

Extract connection keys from Relay source documents, including aliases and base
projects. Expose typed field `keys()` inventories and automatically select all
known keys for each field, with type-checked explicit selection.

Add opt-in `delete(type, id, { prune: true })` to remove matching connection edges
and linked-list entries across the current store and updater before deletion,
preserving remaining order and metadata with optimistic rollback support.

Add schema-typed `clientID(type)` generation and duplicate-safe connection
`appendNode`/`prependNode` and linked-list `append`/`prepend` helpers. Existing
membership is matched by Relay record ID and keeps its position and cursor.
