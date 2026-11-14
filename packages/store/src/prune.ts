import type { RecordSourceProxy } from "relay-runtime";
import type { SchemaDefinition } from "./types.js";

type StoredRecord = Readonly<Record<string, unknown>>;
type LinkedIDs = readonly (string | null | undefined)[];

/** Relay 21 adapter: public updater APIs cannot enumerate unpublished records or fields. */
interface UpdaterRecords {
  readonly __sources: readonly { getRecordIDs(): string[] }[];
  unstable_getRawRecordWithChanges(id: string): StoredRecord | null | undefined;
  setLinkedRecordIDs(id: string, key: string, ids: LinkedIDs): void;
}

function updaterRecords(raw: RecordSourceProxy): UpdaterRecords {
  const mutator = (raw as unknown as { __mutator?: UpdaterRecords }).__mutator;
  if (
    !mutator ||
    !Array.isArray(mutator.__sources) ||
    mutator.__sources.some((source) => typeof source.getRecordIDs !== "function") ||
    typeof mutator.unstable_getRawRecordWithChanges !== "function" ||
    typeof mutator.setLinkedRecordIDs !== "function"
  ) {
    throw new Error("Pruning requires the Relay 21.0.1 updater implementation.");
  }
  return mutator;
}

function linkedIDs(value: unknown): LinkedIDs | undefined {
  if (value === null || typeof value !== "object" || !("__refs" in value)) return undefined;
  const ids = value.__refs;
  return Array.isArray(ids) && ids.every((id) => id == null || typeof id === "string")
    ? ids
    : undefined;
}

function pointsTo(value: unknown, id: string): boolean {
  return value !== null && typeof value === "object" && "__ref" in value && value.__ref === id;
}

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
        return !edges || link == null || !pointsTo(read(link)?.node, id);
      });
      if (next.length !== links.length) updates.push({ parent, key, ids: next });
    }
  }
  for (const update of updates) mutator.setLinkedRecordIDs(update.parent, update.key, update.ids);
}
