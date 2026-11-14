import type { Environment, RecordSourceProxy, Variables } from "relay-runtime";

/** Phantom field descriptions emitted by the generator; never constructed. */
export interface ScalarField<Read = unknown, Write = unknown, Args = object> {
  readonly read: Read;
  readonly write: Write;
  readonly args: Args;
}
export interface LinkedField<
  Target extends string = string,
  Plural extends boolean = boolean,
  Nullable extends boolean = boolean,
  ItemNullable extends boolean = boolean,
  Args = object,
  Keys extends string = string,
> {
  readonly target: Target;
  readonly plural: Plural;
  readonly nullable: Nullable;
  readonly itemNullable: ItemNullable;
  readonly args: Args;
  readonly keys: Keys;
}
export interface TypeShape {
  readonly possibleTypes: string;
  readonly concrete: boolean;
  readonly scalars: Record<string, ScalarField>;
  readonly links: Record<string, LinkedField>;
  readonly connection: { readonly edge: string; readonly node: string } | null;
}
export type StoreTypes = Record<string, TypeShape>;
type Name<S> = Extract<keyof S, string>;
type LinkKey<S extends StoreTypes, T extends Name<S>, Plural extends boolean> = {
  [K in Extract<keyof S[T]["links"], string>]: S[T]["links"][K]["plural"] extends Plural
    ? K
    : never;
}[Extract<keyof S[T]["links"], string>];
type Args<F extends { args: unknown }> = object extends F["args"]
  ? [args?: F["args"]]
  : {} extends F["args"]
    ? [args?: F["args"]]
    : [args: F["args"]];
type Target<S extends StoreTypes, F extends LinkedField> = Extract<F["target"], Name<S>>;
type Nullable<F extends LinkedField, V> = F["nullable"] extends true ? V | null : V;
export type LinkedRecordInput<S extends StoreTypes, T extends Name<S>> = {
  [P in Extract<S[T]["possibleTypes"] | T, Name<S>>]: TypedRecord<S, P, true>;
}[Extract<S[T]["possibleTypes"] | T, Name<S>>];
type ConnectionKey<S extends StoreTypes, T extends Name<S>> = {
  [K in LinkKey<S, T, false>]: S[Target<S, S[T]["links"][K]>]["connection"] extends null
    ? never
    : K;
}[LinkKey<S, T, false>];
type ConnectionTarget<
  S extends StoreTypes,
  T extends Name<S>,
  K extends ConnectionKey<S, T>,
> = Target<S, S[T]["links"][K]>;
type Filters<F extends { args: unknown }> = Partial<
  Omit<F["args"], "first" | "after" | "last" | "before">
>;
type FieldKeys<F extends LinkedField> = F["keys"];
type Edge<S extends StoreTypes, C extends Name<S>> = S[C]["connection"] extends { edge: infer E }
  ? Extract<E, Name<S>>
  : never;
type Node<S extends StoreTypes, C extends Name<S>> = S[C]["connection"] extends { node: infer N }
  ? Extract<N, Name<S>>
  : never;

/** One field interface for scalars, singular links and plural links. */
export type FieldAccessor<Read, Write, Arguments, Writable extends boolean> = {
  get(this: void, ...args: Args<{ args: Arguments }>): Read;
  /** Requires the outer value; linked-list entries may still be absent. */
  require(this: void, ...args: Args<{ args: Arguments }>): NonNullable<Read>;
} & (Writable extends true
  ? [Write] extends [never]
    ? {}
    : { set(this: void, value: Write, ...args: Args<{ args: Arguments }>): void }
  : {});

type ScalarAccessors<Fields extends Record<string, ScalarField>, W extends boolean> = {
  readonly [K in keyof Fields]: FieldAccessor<
    Fields[K]["read"],
    Fields[K]["write"],
    Fields[K]["args"],
    W
  >;
};
type LinkRead<
  S extends StoreTypes,
  F extends LinkedField,
  W extends boolean,
> = F["plural"] extends true
  ? ReadonlyArray<TypedRecord<S, Target<S, F>, W> | null | undefined> | null | undefined
  : TypedRecord<S, Target<S, F>, W> | null | undefined;
type LinkWrite<S extends StoreTypes, F extends LinkedField> = Nullable<
  F,
  F["plural"] extends true
    ? ReadonlyArray<
        LinkedRecordInput<S, Target<S, F>> | (F["itemNullable"] extends true ? null : never)
      >
    : LinkedRecordInput<S, Target<S, F>>
>;
type LinkedAccessors<
  S extends StoreTypes,
  Fields extends Record<string, LinkedField>,
  W extends boolean,
> = {
  readonly [K in keyof Fields]: FieldAccessor<
    LinkRead<S, Fields[K], W>,
    LinkWrite<S, Fields[K]>,
    Fields[K]["args"],
    W
  > &
    (Fields[K]["plural"] extends false
      ? S[Target<S, Fields[K]>]["connection"] extends null
        ? {}
        : {
            /** All cached filter variants of this field's @connection key. */
            connections(
              key?: FieldKeys<Fields[K]>,
            ): ConnectionFamily<
              S,
              Target<S, Fields[K]>,
              W,
              Filters<Fields[K]>,
              FieldKeys<Fields[K]>
            >;
            /** All @connection keys declared for this schema field in the selected project. */
            keys(): readonly FieldKeys<Fields[K]>[];
            /** One cached variant, identified by @connection key and non-pagination filters. */
            connection(
              key: FieldKeys<Fields[K]>,
              filters?: Filters<Fields[K]>,
            ): TypedConnection<S, Target<S, Fields[K]>, W> | undefined;
          }
      : W extends true
        ? {
            /** Append once by Relay record ID; leaves existing entries in place. */
            append(
              this: void,
              record: LinkedRecordInput<S, Target<S, Fields[K]>>,
              ...args: Args<Fields[K]>
            ): void;
            /** Prepend once by Relay record ID; leaves existing entries in place. */
            prepend(
              this: void,
              record: LinkedRecordInput<S, Target<S, Fields[K]>>,
              ...args: Args<Fields[K]>
            ): void;
          }
        : {});
};

declare const recordType: unique symbol;
export type TypedRecord<
  S extends StoreTypes,
  T extends Name<S>,
  Writable extends boolean = false,
> = ScalarAccessors<S[T]["scalars"], Writable> &
  LinkedAccessors<S, S[T]["links"], Writable> & {
    readonly [recordType]: T;
    /** Record operations live outside the GraphQL field namespace. */
    readonly $: {
      getDataID(): string;
      getType(): S[T]["possibleTypes"];
      as<P extends Extract<S[T]["possibleTypes"], Name<S>>>(
        type: P,
      ): TypedRecord<S, P, Writable> | undefined;
    };
  };

type ConnectionNode<S extends StoreTypes, C extends Name<S>, W extends boolean> = TypedRecord<
  S,
  Node<S, C>,
  W
>;
type ConnectionPredicate<S extends StoreTypes, C extends Name<S>, W extends boolean> = (
  node: ConnectionNode<S, C, W>,
  edge: TypedRecord<S, Edge<S, C>, W>,
) => boolean;
type ConnectionComparator<S extends StoreTypes, C extends Name<S>, W extends boolean> = (
  a: ConnectionNode<S, C, W>,
  b: ConnectionNode<S, C, W>,
) => number;
export type TypedConnection<S extends StoreTypes, C extends Name<S>, W extends boolean> = {
  readonly record: TypedRecord<S, C, W>;
  /** Cached nodes in edge order; skips missing edges and nodes. */
  nodes(): ReadonlyArray<ConnectionNode<S, C, W>>;
} & (W extends true
  ? {
      createEdge(node: LinkedRecordInput<S, Node<S, C>>): TypedRecord<S, Edge<S, C>, true>;
      /** Append once by node ID, preserving existing edges and cursors. */
      appendNode(node: LinkedRecordInput<S, Node<S, C>>): void;
      /** Prepend once by node ID, preserving existing edges and cursors. */
      prependNode(node: LinkedRecordInput<S, Node<S, C>>): void;
      insertEdgeAfter(edge: TypedRecord<S, Edge<S, C>, true>, cursor?: string | null): void;
      insertEdgeBefore(edge: TypedRecord<S, Edge<S, C>, true>, cursor?: string | null): void;
      removeNodes(nodeIDs: readonly string[]): void;
      /** Keep matching cached edges. Missing nodes and metadata are preserved. */
      filter(predicate: ConnectionPredicate<S, C, W>): TypedConnection<S, C, W>;
      /** Stable sort of cached edges. Missing nodes keep their positions. */
      sort(compare: ConnectionComparator<S, C, W>): TypedConnection<S, C, W>;
    }
  : {});
export type ConnectionFamily<
  S extends StoreTypes,
  C extends Name<S>,
  W extends boolean,
  F = Variables,
  Key extends string = string,
> = {
  variants(): ReadonlyArray<TypedConnection<S, C, W>>;
  /** Include a typed connection record created or linked in the current updater. */
  include(...records: readonly TypedRecord<S, C, W>[]): ConnectionFamily<S, C, W, F, Key>;
  get(key: Key, filters?: F): TypedConnection<S, C, W> | undefined;
} & (W extends true
  ? {
      removeNodes(nodeIDs: readonly string[]): void;
      filter(predicate: ConnectionPredicate<S, C, W>): ConnectionFamily<S, C, W, F, Key>;
      sort(compare: ConnectionComparator<S, C, W>): ConnectionFamily<S, C, W, F, Key>;
      appendNode(node: LinkedRecordInput<S, Node<S, C>>): void;
      prependNode(node: LinkedRecordInput<S, Node<S, C>>): void;
    }
  : {});
type Concrete<S extends StoreTypes> = {
  [T in Name<S>]: S[T]["concrete"] extends true ? T : never;
}[Name<S>];
export interface DeleteOptions {
  /** Remove matching connection edges and linked-list entries before deleting the record. */
  readonly prune?: boolean;
}
export type TypedStore<S extends StoreTypes, Query extends Name<S>, W extends boolean> = {
  get<T extends Name<S>>(type: T, id: string): TypedRecord<S, T, W> | undefined;
  getRoot(): TypedRecord<S, Query, W>;
  connections<T extends Name<S>, K extends ConnectionKey<S, T>>(
    type: T,
    field: K,
    options: { parents: "all"; key?: FieldKeys<S[T]["links"][K]> },
  ): ConnectionFamily<
    S,
    ConnectionTarget<S, T, K>,
    W,
    Filters<S[T]["links"][K]>,
    FieldKeys<S[T]["links"][K]>
  >;
} & (W extends true
  ? {
      create<T extends Concrete<S>>(type: T, id: string): TypedRecord<S, T, true>;
      delete<T extends Name<S>>(type: T, id: string, options?: DeleteOptions): void;
    }
  : {});
type Sync<R> = R extends PromiseLike<unknown> ? never : R;
export interface StoreAPI<S extends StoreTypes, Q extends Name<S>> {
  /** Generate once before committing, so optimistic replays reuse the same ID. */
  createClientID<T extends Concrete<S>>(this: void, type: T): `client:${T}:${string}`;
  read<R>(
    this: void,
    environment: Environment,
    callback: (store: TypedStore<S, Q, false>) => R & Sync<R>,
  ): R;
  withUpdater<R>(
    this: void,
    environment: Environment,
    raw: RecordSourceProxy,
    callback: (store: TypedStore<S, Q, true>) => R & Sync<R>,
  ): R;
  updater<Data = unknown, R = void>(
    this: void,
    environment: Environment,
    callback: (store: TypedStore<S, Q, true>, data: Data | null | undefined) => R & Sync<R>,
  ): (raw: RecordSourceProxy, data?: Data | null) => void;
}

export interface TypeReference {
  readonly nullable: boolean;
  readonly name?: string;
  readonly element?: TypeReference;
}
export interface FieldDefinition {
  readonly kind: "scalar" | "link";
  readonly type: TypeReference;
  readonly args: Readonly<Record<string, { required: boolean }>>;
  readonly writable: boolean;
  readonly connectionKeys?: readonly string[];
}
export interface TypeDefinition {
  readonly concrete: boolean;
  readonly possibleTypes: readonly string[];
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly connection?: { readonly edge: string; readonly node: string };
}
export interface SchemaDefinition {
  readonly query: string;
  readonly types: Readonly<Record<string, TypeDefinition>>;
}
