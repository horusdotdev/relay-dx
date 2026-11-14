import type { RecordSourceProxy } from "relay-runtime";

export type StoredRecord = Readonly<Record<string, unknown>>;
export type LinkedIDs = readonly (string | null | undefined)[];

/** Relay 21 adapter for collection operations on current, unpublished updater data. */
interface UpdaterRecords {
  readonly __sources: readonly { getRecordIDs(): string[] }[];
  unstable_getRawRecordWithChanges(id: string): StoredRecord | null | undefined;
  setLinkedRecordIDs(id: string, key: string, ids: LinkedIDs): void;
}

export function updaterRecords(raw: RecordSourceProxy): UpdaterRecords {
  const mutator = (raw as unknown as { __mutator?: UpdaterRecords }).__mutator;
  if (
    !mutator ||
    !Array.isArray(mutator.__sources) ||
    mutator.__sources.some((source) => typeof source.getRecordIDs !== "function") ||
    typeof mutator.unstable_getRawRecordWithChanges !== "function" ||
    typeof mutator.setLinkedRecordIDs !== "function"
  ) {
    throw new Error("Store collection helpers require the Relay 21.0.1 updater implementation.");
  }
  return mutator;
}

export function linkedIDs(value: unknown): LinkedIDs | undefined {
  if (value === null || typeof value !== "object" || !("__refs" in value)) return undefined;
  const ids = value.__refs;
  return Array.isArray(ids) && ids.every((id) => id == null || typeof id === "string")
    ? ids
    : undefined;
}

export function linkedID(value: unknown): string | undefined {
  return value !== null &&
    typeof value === "object" &&
    "__ref" in value &&
    typeof value.__ref === "string"
    ? value.__ref
    : undefined;
}

export function listIDs(record: StoredRecord, key: string): LinkedIDs {
  const value = record[key];
  if (value == null) return [];
  const ids = linkedIDs(value);
  if (!ids) throw new Error(`Expected a linked list: ${key}.`);
  return ids;
}
