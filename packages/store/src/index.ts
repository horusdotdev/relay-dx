import {
  ConnectionHandler,
  Record as RelayRecordExport,
  ROOT_ID,
  ROOT_TYPE,
  getStorageKey,
  type Environment,
  type RecordProxy,
  type RecordSourceProxy,
  type Variables,
} from "relay-runtime";
import type {
  ConnectionScan,
  FieldDefinition,
  SchemaDefinition,
  StoreAPI,
  StoreTypes,
  TypeReference,
} from "./types.js";
export type * from "./types.js";

// @types/relay-runtime 20 declares this runtime namespace as a class instance.
const RelayRecord = RelayRecordExport as unknown as InstanceType<typeof RelayRecordExport>;

/** Use public getStorageKey with variable arguments so nested values are stable. */
function storageKey(name: string, args: Variables = {}): string {
  return getStorageKey(
    {
      kind: "ScalarField",
      name,
      alias: null,
      args: Object.keys(args)
        .sort()
        .map((key) => ({ kind: "Variable", name: key, variableName: key })),
    },
    args,
  );
}
function required<T>(value: T, label: string): NonNullable<T> {
  if (value == null) throw new Error(`Missing required store value: ${label}`);
  return value;
}
function named(type: TypeReference): string {
  return type.name ?? named(required(type.element, "list element type"));
}
function writableValue(value: unknown, type: TypeReference, label: string): void {
  if (value === undefined || (value === null && !type.nullable)) {
    throw new Error(`Invalid null/undefined write: ${label}`);
  }
  if (value === null) return;
  if (type.element) {
    if (!Array.isArray(value)) throw new Error(`Expected a list: ${label}`);
    for (const item of value) writableValue(item, type.element, label);
  } else if (
    typeof value === "object" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`Object-valued/custom scalar writes are unsupported: ${label}`);
  }
}
function copyValue(value: unknown): unknown {
  // Never expose a mutable array/object owned by the normalized source.
  return value !== null && typeof value === "object" ? structuredClone(value) : value;
}

type RecordView = Readonly<Record<string, unknown>>;
const recordStates = new WeakMap<object, RuntimeRecord>();

class Scope {
  active = true;
  readonly definition: SchemaDefinition;
  readonly environment: Environment;
  readonly raw: RecordSourceProxy | undefined;
  constructor(definition: SchemaDefinition, environment: Environment, raw?: RecordSourceProxy) {
    this.definition = definition;
    this.environment = environment;
    this.raw = raw;
  }
  check(write = false): void {
    if (!this.active) throw new Error("Store access escaped its synchronous callback scope.");
    if (write && !this.raw) throw new Error("Store writes require an updater scope.");
  }
  source() {
    this.check();
    return this.environment.getStore().getSource();
  }
  type(type: string) {
    return required(this.definition.types[type], `schema type ${type}`);
  }
  actualType(id: string): string | undefined {
    this.check();
    if (id === ROOT_ID) {
      const actual = this.raw?.get(id)?.getType() ?? this.source().get(id)?.__typename;
      if (actual === ROOT_TYPE) return this.definition.query;
      return actual;
    }
    if (this.raw) return this.raw.get(id)?.getType();
    const record = this.source().get(id);
    return record ? RelayRecord.getType(record) : undefined;
  }
  lookup(type: string, id: string): RuntimeRecord | undefined {
    const actual = this.actualType(id);
    if (actual === undefined) return undefined;
    if (!this.type(type).possibleTypes.includes(actual)) {
      throw new Error(`Record ${id} is ${actual}, expected ${type}.`);
    }
    return new RuntimeRecord(this, type, id);
  }
  get(type: string, id: string): RecordView | undefined {
    return this.lookup(type, id)?.view();
  }
  getParentIfMatching(type: string, id: string): RuntimeRecord | undefined {
    const actual = this.actualType(id);
    return actual && this.type(type).possibleTypes.includes(actual)
      ? this.lookup(type, id)
      : undefined;
  }
  native(record: RuntimeRecord): RecordProxy {
    this.check(true);
    if (!(record instanceof RuntimeRecord) || record.scope !== this) {
      throw new Error("Linked records must belong to the same updater scope.");
    }
    return required(this.raw!.get(record.id), `record ${record.id}`);
  }
  state(view: RecordView): RuntimeRecord {
    this.check(true);
    const state = recordStates.get(view);
    if (!state || state.scope !== this)
      throw new Error("Linked records must belong to the same updater scope.");
    return state;
  }
  create(type: string, id: string): RecordView {
    this.check(true);
    if (!this.type(type).concrete) throw new Error(`Cannot create abstract type ${type}.`);
    if (this.raw!.get(id)) throw new Error(`Record ${id} already exists.`);
    this.raw!.create(id, type);
    return required(this.get(type, id), id);
  }
  delete(type: string, id: string): void {
    this.check(true);
    if (this.get(type, id)) this.raw!.delete(id);
  }
  getRoot(): RecordView {
    return required(this.get(this.definition.query, ROOT_ID), "root record");
  }
  connections(
    type: string,
    field: string,
    options: ConnectionScan & { parents: "all" },
  ): RuntimeFamily {
    this.check();
    if (options.parents !== "all") throw new Error("All-parent scans must be explicit.");
    return new RuntimeFamily(this, type, field, undefined, options);
  }
  view() {
    return {
      get: this.get.bind(this),
      getRoot: this.getRoot.bind(this),
      connections: this.connections.bind(this),
      ...(this.raw ? { create: this.create.bind(this), delete: this.delete.bind(this) } : {}),
    };
  }
}

class RuntimeRecord {
  readonly scope: Scope;
  readonly type: string;
  readonly id: string;
  constructor(scope: Scope, type: string, id: string) {
    this.scope = scope;
    this.type = type;
    this.id = id;
  }
  getDataID(): string {
    this.scope.check();
    return this.id;
  }
  getType(): string {
    return required(this.scope.actualType(this.id), this.id);
  }
  as(type: string): RecordView | undefined {
    this.scope.check();
    if (
      !this.scope.type(this.type).possibleTypes.includes(type) ||
      !this.scope.type(type).concrete
    ) {
      throw new Error(`${type} is not a concrete refinement of ${this.type}.`);
    }
    return this.getType() === type ? this.scope.get(type, this.id) : undefined;
  }
  field(
    name: string,
    kind: "scalar" | "link",
    args?: Variables,
    plural?: boolean,
  ): FieldDefinition {
    this.scope.check();
    const field = this.scope.type(this.type).fields[name];
    if (
      !field ||
      field.kind !== kind ||
      (plural !== undefined && Boolean(field.type.element) !== plural)
    ) {
      throw new Error(`Invalid ${kind} field ${this.type}.${name}.`);
    }
    for (const key of Object.keys(args ?? {})) {
      if (!Object.hasOwn(field.args, key)) throw new Error(`Unknown argument ${name}(${key}:).`);
    }
    for (const [key, argument] of Object.entries(field.args)) {
      if (argument.required && args?.[key] == null)
        throw new Error(`Missing argument ${name}(${key}:).`);
    }
    return field;
  }
  getValue(name: string, args?: Variables): unknown {
    this.field(name, "scalar", args);
    const key = storageKey(name, args);
    if (this.scope.raw) {
      const value = required(this.scope.raw.get(this.id), this.id).getValue(name, args);
      // Relay's plain-object updater sink can inherit e.g. `constructor`, masking
      // a published field. Such prototype values are not cached scalar values.
      if (!Object.hasOwn(Object.prototype, key) || value !== Reflect.get(Object.prototype, key))
        return copyValue(value);
    }
    const record = this.scope.source().get(this.id);
    return record && Object.hasOwn(record, key)
      ? copyValue(RelayRecord.getValue(record, key))
      : undefined;
  }
  linked(name: string, args?: Variables, plural = false): unknown {
    const field = this.field(name, "link", args, plural);
    const target = named(field.type);
    if (this.scope.raw) {
      const record = required(this.scope.raw.get(this.id), this.id);
      if (plural) {
        const links = record.getLinkedRecords(name, args);
        return links == null
          ? links
          : links.map((link) => (link == null ? link : this.scope.get(target, link.getDataID())));
      }
      const link = record.getLinkedRecord(name, args);
      return link == null ? link : this.scope.get(target, link.getDataID());
    }
    const record = this.scope.source().get(this.id);
    if (!record) return undefined;
    const key = storageKey(name, args);
    if (plural) {
      const ids = RelayRecord.getLinkedRecordIDs(record, key);
      return ids == null ? ids : ids.map((id) => (id == null ? id : this.scope.get(target, id)));
    }
    const id = RelayRecord.getLinkedRecordID(record, key);
    return id == null ? id : this.scope.get(target, id);
  }
  setValue(value: unknown, name: string, args?: Variables): void {
    this.scope.check(true);
    const field = this.field(name, "scalar", args);
    if (!field.writable) throw new Error(`Field ${name} has no supported scalar write mapping.`);
    writableValue(value, field.type, `${this.type}.${name}`);
    // Runtime validation above restricts values to native Relay leaf values.
    this.scope
      .native(this)
      .setValue(copyValue(value) as Parameters<RecordProxy["setValue"]>[0], name, args);
  }
  setLinkedRecord(record: RuntimeRecord | null, name: string, args?: Variables): void {
    this.scope.check(true);
    const field = this.field(name, "link", args, false);
    const native = this.scope.native(this);
    if (record === null) {
      if (!field.type.nullable) throw new Error(`Cannot write null to ${this.type}.${name}.`);
      // Native singular setLinkedRecord rejects null; Relay's setValue stores it.
      native.setValue(null, name, args);
    } else {
      this.scope.lookup(named(field.type), record.id);
      native.setLinkedRecord(this.scope.native(record), name, args);
    }
  }
  setLinkedRecords(
    records: readonly (RuntimeRecord | null)[] | null,
    name: string,
    args?: Variables,
  ): void {
    this.scope.check(true);
    const field = this.field(name, "link", args, true);
    if (records === null) {
      if (!field.type.nullable) throw new Error(`Cannot write null to ${this.type}.${name}.`);
      this.scope.native(this).setValue(null, name, args);
      return;
    }
    const element = required(field.type.element, "list element");
    const nativeRecords = records.map((record) => {
      if (record === null) {
        if (!element.nullable) throw new Error(`Cannot write a null item to ${this.type}.${name}.`);
        return null;
      }
      this.scope.lookup(named(element), record.id);
      return this.scope.native(record);
    });
    this.scope.native(this).setLinkedRecords(nativeRecords, name, args);
  }
  connections(field: string, options: ConnectionScan = {}): RuntimeFamily {
    this.scope.check();
    return new RuntimeFamily(this.scope, this.type, field, this.id, options);
  }
  view(): RecordView {
    // Public field names never share an object with backend methods or state.
    const view: Record<string, unknown> = Object.create(null);
    Object.defineProperty(view, "$", {
      value: Object.freeze({
        getDataID: this.getDataID.bind(this),
        getType: this.getType.bind(this),
        as: this.as.bind(this),
      }),
    });
    const fields = this.scope.type(this.type).fields;
    const cache = new Map<string, object>();
    for (const name of Object.keys(fields)) {
      Object.defineProperty(view, name, {
        enumerable: true,
        get: () => {
          this.scope.check();
          let accessor = cache.get(name);
          if (!accessor) {
            accessor = this.accessor(name, fields[name]);
            cache.set(name, accessor);
          }
          return accessor;
        },
      });
    }
    recordStates.set(view, this);
    return Object.freeze(view);
  }
  accessor(name: string, field: FieldDefinition): object {
    const read = (args?: Variables) =>
      field.kind === "scalar"
        ? this.getValue(name, args)
        : this.linked(name, args, Boolean(field.type.element));
    const accessor: Record<string, unknown> = {
      get: read,
      require: (args?: Variables) => required(read(args), `${this.type}.${name}`),
    };
    if (this.scope.raw && field.writable) {
      accessor.set = (value: unknown, args?: Variables) => {
        this.scope.check(true);
        if (field.kind === "scalar") this.setValue(value, name, args);
        else if (field.type.element) {
          const records = value as readonly (RecordView | null)[] | null;
          this.setLinkedRecords(
            records === null
              ? null
              : records.map((record) => (record === null ? null : this.scope.state(record))),
            name,
            args,
          );
        } else
          this.setLinkedRecord(
            value === null ? null : this.scope.state(value as RecordView),
            name,
            args,
          );
      };
    }
    if (
      field.kind === "link" &&
      !field.type.element &&
      this.scope.type(named(field.type)).connection
    ) {
      accessor.connections = (options: ConnectionScan = {}) => this.connections(name, options);
    }
    return Object.freeze(accessor);
  }
}

class RuntimeConnection {
  readonly record: RecordView;
  readonly scope: Scope;
  readonly type: string;
  constructor(scope: Scope, type: string, id: string) {
    this.scope = scope;
    this.type = type;
    this.record = required(scope.get(type, id), id);
  }
  createEdge(node: RecordView): RecordView {
    this.scope.check(true);
    const state = this.scope.state(node);
    const shape = required(this.scope.type(this.type).connection, this.type);
    this.scope.lookup(shape.node, state.id);
    const edge = ConnectionHandler.createEdge(
      this.scope.raw!,
      this.scope.native(this.scope.state(this.record)),
      this.scope.native(state),
      shape.edge,
    );
    return required(this.scope.get(shape.edge, edge.getDataID()), "created edge");
  }
  insertEdgeAfter(edge: RecordView, cursor?: string | null): void {
    const state = this.scope.state(edge);
    this.validateEdge(state);
    ConnectionHandler.insertEdgeAfter(
      this.scope.native(this.scope.state(this.record)),
      this.scope.native(state),
      cursor,
    );
  }
  insertEdgeBefore(edge: RecordView, cursor?: string | null): void {
    const state = this.scope.state(edge);
    this.validateEdge(state);
    ConnectionHandler.insertEdgeBefore(
      this.scope.native(this.scope.state(this.record)),
      this.scope.native(state),
      cursor,
    );
  }
  validateEdge(edge: RuntimeRecord): void {
    this.scope.check(true);
    this.scope.get(required(this.scope.type(this.type).connection, this.type).edge, edge.id);
  }
  removeNodes(ids: readonly string[]): void {
    this.scope.check(true);
    for (const id of new Set(ids))
      ConnectionHandler.deleteNode(this.scope.native(this.scope.state(this.record)), id);
  }
}

class RuntimeFamily {
  readonly target: string;
  readonly scope: Scope;
  readonly parentType: string;
  readonly field: string;
  readonly parentID: string | undefined;
  readonly options: ConnectionScan;
  constructor(
    scope: Scope,
    parentType: string,
    field: string,
    parentID: string | undefined,
    options: ConnectionScan,
  ) {
    this.scope = scope;
    this.parentType = parentType;
    this.field = field;
    this.parentID = parentID;
    this.options = options;
    const definition = scope.type(parentType).fields[field];
    if (!definition || definition.kind !== "link" || definition.type.element)
      throw new Error(`Not a connection field: ${parentType}.${field}`);
    this.target = named(definition.type);
    if (!scope.type(this.target).connection)
      throw new Error(`Not a connection type: ${this.target}`);
  }
  get(key: string, filters?: Variables): RuntimeConnection | undefined {
    this.scope.check();
    if (!this.parentID) throw new Error("Selecting one connection requires a parent record.");
    const id = ConnectionHandler.getConnectionID(this.parentID, key, filters);
    return this.scope.get(this.target, id)
      ? new RuntimeConnection(this.scope, this.target, id)
      : undefined;
  }
  variants(): RuntimeConnection[] {
    this.scope.check();
    const source = this.scope.source();
    const ids = new Set<string>();
    const parents = this.parentID ? [this.parentID] : source.getRecordIDs();
    for (const parentID of parents) {
      const published = source.get(parentID);
      if (!published) continue;
      const parent = this.scope.getParentIfMatching(this.parentType, parentID);
      if (!parent) continue;
      const definition = this.scope.type(parent.getType());
      const matchingFields = Object.values(definition.fields).filter(
        (field) =>
          field.kind === "link" && !field.type.element && named(field.type) === this.target,
      );
      if (matchingFields.length > 1 && !this.options.keys?.length) {
        throw new Error(
          `Ambiguous connection field ${this.parentType}.${this.field}; supply explicit connection keys.`,
        );
      }
      for (const key of Object.keys(published)) {
        const handle = key.split("(", 1)[0];
        if (!/^__.+_connection$/.test(handle)) continue;
        if (
          this.options.keys &&
          !this.options.keys.some((candidate) => handle === `__${candidate}_connection`)
        )
          continue;
        // Resolve the current link, not its possibly outdated published target.
        const currentID = this.scope.raw
          ? this.scope.raw.get(parentID)?.getLinkedRecord(key)?.getDataID()
          : RelayRecord.getLinkedRecordID(published, key);
        if (currentID && this.scope.actualType(currentID) === this.target) ids.add(currentID);
      }
    }
    for (const id of this.options.candidateIDs ?? []) {
      if (this.scope.get(this.target, id)) ids.add(id);
    }
    return [...ids].map((id) => new RuntimeConnection(this.scope, this.target, id));
  }
  removeNodes(ids: readonly string[]): void {
    this.scope.check(true);
    for (const connection of this.variants()) connection.removeNodes(ids);
  }
}

/** Generated metadata is the only runtime schema dependency. No GraphQL package in the app. */
export function createStoreAPI<S extends StoreTypes, Q extends Extract<keyof S, string>>(
  definition: SchemaDefinition,
): StoreAPI<S, Q> {
  function run(
    environment: Environment,
    raw: RecordSourceProxy | undefined,
    callback: (view: unknown) => unknown,
  ): unknown {
    const scope = new Scope(definition, environment, raw);
    try {
      const result = callback(scope.view());
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new Error("Store callbacks must be synchronous.");
      return result;
    } finally {
      scope.active = false;
    }
  }
  // One audited bridge between generated phantom types and checked runtime views.
  return {
    read: (environment: Environment, callback: (view: unknown) => unknown) =>
      run(environment, undefined, callback),
    withUpdater: (
      environment: Environment,
      raw: RecordSourceProxy,
      callback: (view: unknown) => unknown,
    ) => run(environment, raw, callback),
    updater:
      (environment: Environment, callback: (view: unknown, data: unknown) => unknown) =>
      (raw: RecordSourceProxy, data?: unknown) =>
        run(environment, raw, (view) => callback(view, data)),
  } as StoreAPI<S, Q>;
}
