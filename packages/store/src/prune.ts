import type { RecordSourceProxy } from "relay-runtime";
import type { SchemaDefinition } from "./types.js";
import {
  linkedID,
  linkedIDs,
  updaterRecords,
  type LinkedIDs,
  type StoredRecord,
} from "./updater.js";

/** Prune membership through Relay's mutation sink, preserving optimistic rollback. */
export function pruneCollections(
  raw: RecordSourceProxy,
  schema: SchemaDefinition,
  id: string,
): void {
  const mutator = updaterRecords(raw);
  const ids = new Set(mutator.__sources.flatMap((source) => source.getRecordIDs()));
  const records = new Map<string, StoredRecord | null | undefined>();
  const read = (recordID: string) => {
    if (!records.has(recordID))
      records.set(recordID, mutator.unstable_getRawRecordWithChanges(recordID));
    return records.get(recordID);
  };
  const updates: { parent: string; key: string; ids: LinkedIDs }[] = [];
  for (const parent of ids) {
    if (parent === id) continue;
    const record = read(parent);
    if (!record) continue;
    const type = record.__typename === "__Root" ? schema.query : record.__typename;
    const definition = typeof type === "string" ? schema.types[type] : undefined;
    // Scoped generation cannot distinguish links from custom scalar objects on omitted types.
    if (!definition) continue;
    for (const [key, value] of Object.entries(record)) {
      const name = key.split("(", 1)[0];
      const field = definition?.fields[name];
      // Scalar objects can themselves contain a __refs property.
      if (field && (field.kind !== "link" || !field.type.element)) continue;
      const links = linkedIDs(value);
      if (!links) continue;
      const edges = Boolean(definition?.connection && name === "edges");
      const next = links.filter((link) => {
        if (link === id) return false;
        return !edges || link == null || linkedID(read(link)?.node) !== id;
      });
      if (next.length !== links.length) updates.push({ parent, key, ids: next });
    }
  }
  for (const update of updates) mutator.setLinkedRecordIDs(update.parent, update.key, update.ids);
}
