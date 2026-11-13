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
> {
  readonly target: Target;
  readonly plural: Plural;
  readonly nullable: Nullable;
  readonly itemNullable: ItemNullable;
  readonly args: Args;
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
            connections(
              options?: ConnectionScan,
            ): ConnectionFamily<S, Target<S, Fields[K]>, W, Filters<Fields[K]>>;
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

export interface ConnectionScan {
  /** Operation connection keys, required when fields share a connection type. */
  readonly keys?: readonly string[];
  /** Explicit candidates for connections absent from the published source. */
  readonly candidateIDs?: readonly string[];
}
export type TypedConnection<S extends StoreTypes, C extends Name<S>, W extends boolean> = {
  readonly record: TypedRecord<S, C, W>;
} & (W extends true
  ? {
      createEdge(node: LinkedRecordInput<S, Node<S, C>>): TypedRecord<S, Edge<S, C>, true>;
      insertEdgeAfter(edge: TypedRecord<S, Edge<S, C>, true>, cursor?: string | null): void;
      insertEdgeBefore(edge: TypedRecord<S, Edge<S, C>, true>, cursor?: string | null): void;
      removeNodes(nodeIDs: readonly string[]): void;
    }
  : {});
export type ConnectionFamily<
  S extends StoreTypes,
  C extends Name<S>,
  W extends boolean,
  F = Variables,
> = {
  variants(): ReadonlyArray<TypedConnection<S, C, W>>;
  /** Key/filter correctness is supplied by the caller, not inferred from SDL. */
  get(key: string, filters?: F): TypedConnection<S, C, W> | undefined;
} & (W extends true ? { removeNodes(nodeIDs: readonly string[]): void } : {});
type Concrete<S extends StoreTypes> = {
  [T in Name<S>]: S[T]["concrete"] extends true ? T : never;
}[Name<S>];
export type TypedStore<S extends StoreTypes, Query extends Name<S>, W extends boolean> = {
  get<T extends Name<S>>(type: T, id: string): TypedRecord<S, T, W> | undefined;
  getRoot(): TypedRecord<S, Query, W>;
  connections<T extends Name<S>, K extends ConnectionKey<S, T>>(
    type: T,
    field: K,
    options: ConnectionScan & { parents: "all" },
  ): ConnectionFamily<S, ConnectionTarget<S, T, K>, W, Filters<S[T]["links"][K]>>;
} & (W extends true
  ? {
      create<T extends Concrete<S>>(type: T, id: string): TypedRecord<S, T, true>;
      delete<T extends Name<S>>(type: T, id: string): void;
    }
  : {});
type Sync<R> = R extends PromiseLike<unknown> ? never : R;
export interface StoreAPI<S extends StoreTypes, Q extends Name<S>> {
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
