import { describe, expect, it } from "vite-plus/test";
import { ConnectionHandler, type Environment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";
import { draft, published, seed } from "../fixtures/environment.js";
function nodeIDs(
  environment: Environment,
  parent = "g1",
  filter: object = draft,
  key = "StoreFixture_feed",
) {
  const id = ConnectionHandler.getConnectionID(parent, key, { filter });
  return store.read(environment, (view) =>
    view
      .get("PostConnection", id)!
      .edges.get()
      ?.map((edge) => edge?.node.get()?.$.getDataID()),
  );
}
describe("experimental typed store on compiler-normalized Relay 21 records", () => {
  it("keeps schema fields separate from record operations and backend state", () => {
    const environment = seed();
    const names = [
      "getType",
      "getDataID",
      "as",
      "connections",
      "constructor",
      "fields",
      "scope",
      "then",
    ] as const;
    store.read(environment, (view) =>
      expect(view.get("User", "u1")!.constructor.get()).toBeUndefined(),
    );
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const user = view.get("User", "u1")!;
        for (const name of names) user[name].set(name);
        expect(user.$.getDataID()).toBe("u1");
        expect(user.$.getType()).toBe("User");
        expect(user.$.as("User")!.as.get()).toBe("as");
        expect(user.name).toBe(user.name);
        expect("getValue" in user).toBe(false);
      }),
    );
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      for (const name of names) expect(user[name].get()).toBe(name);
      expect(() => Object.assign(user, { name: "replacement" })).toThrow(TypeError);
    });
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const user = view.get("User", "u1")!;
        user.name.set("Changed");
        expect(user.constructor.get()).toBe("constructor");
      }),
    );
  });

  it("keeps detached field methods bound and rejects expired field accessors", () => {
    const environment = seed();
    const escaped = store.read(environment, (view) => {
      const field = view.get("User", "u1")!.name;
      const get = field.get;
      expect(get()).toBe("Ada");
      return field;
    });
    expect(() => escaped.get()).toThrow("escaped");
    expect(() => escaped.require()).toThrow("escaped");
    let lateSet: ((value: string) => void) | undefined;
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const { set } = view.get("User", "u1")!.name;
        set("Bound setter");
        lateSet = set;
      }),
    );
    expect(() => lateSet!("Too late")).toThrow("escaped");
  });

  it("rejects linked records from another callback scope", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      store.withUpdater(environment, raw, (outer) => {
        const foreign = outer.get("User", "u1")!;
        store.withUpdater(environment, raw, (inner) => {
          expect(() => inner.get("User", "u1")!.friend.set(foreign)).toThrow("same updater scope");
        });
      });
    });
  });
  it("reads the root, scalars, links, abstract refinements and absent records", () => {
    const environment = seed();
    store.read(environment, (view) => {
      expect(view.getRoot().viewer.get()?.name.get()).toBe("Ada");
      expect(view.get("User", "missing")).toBeUndefined();
      const user = view.get("Node", "u1")!;
      expect(user.$.as("User")?.name.get()).toBe("Ada");
      expect(user.$.as("Post")).toBeUndefined();
      expect(view.get("User", "u1")!.opaque.get()).toBeUndefined();
      expect(() => view.get("Post", "u1")).toThrow("expected Post");
    });
  });
  it("preserves missing and null values, including dangling list entries", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      raw.get("u1")!.setValue(null, "name");
      raw.delete("u2");
    });
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      expect(user.name.get()).toBeNull();
      expect(() => user.name.require()).toThrow("required store value");
      expect(() => user.opaque.require()).toThrow("required store value");
      expect(user.friends.get()?.[0]).toBeUndefined();
      expect(user.friends.require()[0]).toBeUndefined();
      expect(user.friend.get()).toBeUndefined();
      expect(view.get("User", "u2")).toBeUndefined();
    });
  });
  it("creates, relinks and deletes records through native updater proxies", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const user = view.get("User", "u1")!;
        const next = view.create("User", "u3");
        next.name.set("Lin");
        user.name.set("Changed");
        user.friend.set(next);
        user.friends.set([next, user]);
        expect(user.friend.require().name.get()).toBe("Lin");
        view.delete("User", "u2");
      }),
    );
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      expect(user.name.get()).toBe("Changed");
      expect(user.friend.get()?.$.getDataID()).toBe("u3");
      expect(user.friends.get()?.map((item) => item?.$.getDataID())).toEqual(["u3", "u1"]);
      expect(view.get("User", "u2")).toBeUndefined();
    });
    environment.commitUpdate(
      store.updater(environment, (view) => view.get("User", "u1")!.friend.set(null)),
    );
    expect(store.read(environment, (view) => view.get("User", "u1")!.friend.get())).toBeNull();
  });
  it("keeps returned and supplied scalar arrays detached from store-owned arrays", () => {
    const environment = seed();
    const input = ["new"];
    environment.commitUpdate(
      store.updater(environment, (view) => view.get("User", "u1")!.tags.set(input)),
    );
    input.push("outside");
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      const tags = user.tags.require() as string[];
      tags.push("mutated read");
      expect(user.tags.get()).toEqual(["new"]);
    });
  });
  it("matches compiler storage keys for nested inputs, nulls and explicit variable defaults", () => {
    const environment = seed();
    store.read(environment, (view) => {
      const root = view.getRoot();
      expect(
        root.count.get({
          input: { nested: { limit: 5, term: "hello" }, status: "DRAFT" },
          scale: 2,
        }),
      ).toBe(42);
      // No schema/operation defaults are silently added by the record facade.
      expect(root.count.get({ input: draft })).toBeUndefined();
    });
    environment.commitUpdate(
      store.updater(environment, (view) => {
        view.getRoot().count.set(7, { input: draft });
      }),
    );
    expect(
      store.read(environment, (view) => view.getRoot().count.get({ input: draft, label: null })),
    ).toBe(7);
  });
  it("rejects escaped handles, async access, and runtime writes through read-only views", () => {
    const environment = seed();
    const escaped = store.read(environment, (view) => view.get("User", "u1")!);
    expect(() => escaped.name.get()).toThrow("escaped");
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      expect("set" in user.name).toBe(false);
      const field = user.name as unknown as { set(value: string): void };
      expect(() => field.set("No")).toThrow(TypeError);
    });
    const asyncRead = store.read as unknown as (
      env: Environment,
      callback: () => Promise<void>,
    ) => void;
    expect(() => asyncRead(environment, async () => {})).toThrow("synchronous");
    let expiredWrite: (() => void) | undefined;
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const user = view.get("User", "u1")!;
        expiredWrite = () => user.name.set("Too late");
      }),
    );
    expect(expiredWrite).toThrow("escaped");
  });
  it("reads optimistic values and restores them on rollback", () => {
    const environment = seed();
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater(environment, (view) => {
        view.get("User", "u1")!.name.set("Optimistic");
        view.get("Group", "g1")!.items.connections().removeNodes(["p1"]);
      }),
    });
    expect(store.read(environment, (view) => view.get("User", "u1")!.name.get())).toBe(
      "Optimistic",
    );
    expect(nodeIDs(environment)).toEqual(["p2"]);
    optimistic.dispose();
    expect(store.read(environment, (view) => view.get("User", "u1")!.name.get())).toBe("Ada");
    expect(nodeIDs(environment)).toEqual(["p1", "p2"]);
  });
  it("removes across filtered and aliased variants on one parent, preserving nodes and metadata", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const family = view.get("Group", "g1")!.items.connections();
        expect(family.variants()).toHaveLength(2);
        family.removeNodes(["p1", "p1"]);
        for (const variant of family.variants()) {
          expect(variant.record.totalCount.get()).toBe(99);
          expect(variant.record.pageInfo.get()?.endCursor.get()).toBe("end");
        }
        expect(view.get("Post", "p1")).toBeDefined();
      }),
    );
    expect(nodeIDs(environment)).toEqual(["p2"]);
    expect(nodeIDs(environment, "g1", published)).toEqual(["p2"]);
    expect(nodeIDs(environment, "g2")).toEqual(["p1", "p2"]);
  });
  it("supports explicit all-parent removal and disambiguates shared connection types by keys", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        view.connections("Group", "items", { parents: "all" }).removeNodes(["p1"]);
        const user = view.get("User", "u1")!;
        expect(() => user.posts.connections().variants()).toThrow("explicit connection keys");
        user.posts.connections({ keys: ["StoreFixture_posts"] }).removeNodes(["p1"]);
      }),
    );
    expect(nodeIDs(environment, "g2")).toEqual(["p2"]);
    expect(nodeIDs(environment, "u1", draft, "StoreFixture_posts")).toEqual(["p2"]);
    expect(nodeIDs(environment, "u1", draft, "StoreFixture_archivedPosts")).toEqual(["p1"]);
  });
  it("creates and inserts edges using unwrapped native records", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const post = view.create("Post", "p3");
        post.title.set("New");
        post.author.set(view.get("User", "u1")!);
        const connection = view
          .get("Group", "g1")!
          .items.connections()
          .get("StoreFixture_feed", { filter: draft })!;
        const edge = connection.createEdge(post);
        expect(edge.cursor.get()).toBeNull();
        edge.cursor.set("cursor:p3");
        connection.insertEdgeBefore(edge);
      }),
    );
    expect(nodeIDs(environment)).toEqual(["p3", "p1", "p2"]);
  });
  it("accepts explicit candidates for unpublished connections and sees current updater edges", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      const fresh = raw.create("unpublished", "PostConnection");
      fresh.setLinkedRecords([], "edges");
      store.withUpdater(environment, raw, (view) => {
        const family = view.get("Group", "g1")!.items.connections();
        expect(family.variants()).toHaveLength(2);
        expect(
          view
            .get("Group", "g1")!
            .items.connections({ candidateIDs: ["unpublished"] })
            .variants(),
        ).toHaveLength(3);
        const existing = family.get("StoreFixture_feed", { filter: draft })!;
        const edge = existing.createEdge(view.get("Post", "p2")!);
        existing.insertEdgeAfter(edge);
        family.removeNodes(["p2"]);
      });
    });
    expect(nodeIDs(environment)).toEqual(["p1"]);
  });
  it("guards runtime field access, unsupported scalars, link types and creation", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      store.withUpdater(environment, raw, (view) => {
        const user = view.get("User", "u1")!;
        const bypass = user as unknown as Record<
          string,
          { get(): unknown; set(value: unknown): void }
        >;
        expect(bypass.typo).toBeUndefined();
        expect(() => bypass.name.set(null)).toThrow("Invalid null/undefined");
        expect(() => bypass.avatar.set({ object: true })).toThrow("Object-valued");
        expect("set" in bypass.opaque).toBe(false);
        expect(() => bypass.friend.set(view.get("Post", "p1")!)).toThrow("expected User");
        expect(() => view.create("User", "u1")).toThrow("already exists");
        expect(() => view.delete("Post", "u1")).toThrow("expected Post");
      });
    });
  });
});
