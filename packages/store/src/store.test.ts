import { describe, expect, it } from "vite-plus/test";
import { ConnectionHandler, type Environment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";
import { store as kitchenStore } from "../examples/__generated__/store.js";
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
      store.proxy(environment, raw, (outer) => {
        const foreign = outer.get("User", "u1")!;
        store.proxy(environment, raw, (inner) => {
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
  it("refines union records to their concrete members", () => {
    const environment = seed();
    kitchenStore.read(environment, (view) => {
      const user = view.get("SearchResult", "u1")!;
      expect(user.$.as("User")?.name.get()).toBe("Ada");
      expect(user.$.as("Post")).toBeUndefined();
      const post = view.get("SearchResult", "p1")!;
      expect(post.$.as("Post")?.title.get()).toBe("p1");
      expect(post.$.as("User")).toBeUndefined();
    });
    environment.commitUpdate(
      kitchenStore.updater(environment, (view) => {
        const record = view.upsert("SearchResultConnection", {
          id: "client:results",
          edges: [],
          pageInfo: view
            .get(
              "PostConnection",
              ConnectionHandler.getConnectionID("g1", "StoreFixture_feed", { filter: draft }),
            )!
            .pageInfo.require(),
        });
        record.edges.set([]);
        const family = view.getRoot().search.connections().include(record);
        const connection = family.variants()[0]!;
        connection.insertEdgeAfter(connection.createEdge(view.get("User", "u1")!));
        connection.insertEdgeAfter(connection.createEdge(view.get("Post", "p1")!));
        expect(connection.nodes().map((node) => node.$.getType())).toEqual(["User", "Post"]);
        family.filter((node) => node.$.as("Post") !== undefined);
        expect(connection.nodes().map((node) => node.$.as("Post")?.title.get())).toEqual(["p1"]);
      }),
    );
  });
  it("checks key ownership at runtime and returns immutable source key inventories", () => {
    const environment = seed();
    store.read(environment, (view) => {
      const user = view.get("User", "u1")!;
      const field = user.posts as unknown as {
        connections(key: string): unknown;
        connection(key: string): unknown;
      };
      expect(() => field.connections("StoreFixture_archivedPosts")).toThrow(
        "Unknown connection key",
      );
      expect(() => field.connection("StoreFixture_typo")).toThrow("Unknown connection key");
      expect(Object.isFrozen(user.posts.keys())).toBe(true);
      expect(view.get("HasPosts", "u1")!.posts.keys()).toEqual(user.posts.keys());
      expect(user.archivedPosts.keys()).toEqual(["StoreFixture_archivedPosts"]);
      expect(view.get("Group", "g1")!.items.keys()).toEqual(["StoreFixture_feed"]);
      for (const key of user.posts.keys()) {
        expect(user.posts.connections(key).variants().length).toBe(
          key === "StoreFixture_posts" ? 2 : 0,
        );
      }
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
        const next = view.upsert("User", { id: "u3", name: "Initial", friends: [], tags: [] });
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
  it("supports explicit all-parent removal and discovers keys for fields sharing a connection type", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        view.connections("Group", "items", { parents: "all" }).removeNodes(["p1"]);
        const user = view.get("User", "u1")!;
        expect(user.posts.keys()).toEqual([
          "ConnectionKeysFixture_other",
          "ConnectionKeysFixture_posts",
          "StoreFixture_posts",
        ]);
        expect(user.posts.connections().variants()).toHaveLength(2);
        user.posts.connections().removeNodes(["p1"]);
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
        const post = view.upsert("Post", {
          id: "p3",
          title: "Initial",
          author: view.get("User", "u1")!,
        });
        post.title.set("New");
        post.author.set(view.get("User", "u1")!);
        const connection = view
          .get("Group", "g1")!
          .items.connection("StoreFixture_feed", { filter: draft })!;
        const edge = connection.createEdge(post);
        expect(edge.cursor.get()).toBeNull();
        edge.cursor.set("cursor:p3");
        connection.insertEdgeBefore(edge);
      }),
    );
    expect(nodeIDs(environment)).toEqual(["p3", "p1", "p2"]);
  });
  it("includes typed unpublished connections and sees current updater edges", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      const fresh = raw.create("unpublished", "PostConnection");
      fresh.setLinkedRecords([], "edges");
      store.proxy(environment, raw, (view) => {
        const family = view.get("Group", "g1")!.items.connections();
        expect(family.variants()).toHaveLength(2);
        expect(
          view
            .get("Group", "g1")!
            .items.connections()
            .include(view.get("PostConnection", "unpublished")!)
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
  it("rejects object selections and unknown all-parent options", () => {
    const environment = seed();
    store.read(environment, (view) => {
      const field = view.get("User", "u1")!.posts as unknown as {
        connections(options: object): unknown;
      };
      expect(() => field.connections({ keys: ["StoreFixture_posts"] })).toThrow("as a string");
      const unsafe = view as unknown as {
        connections(type: string, field: string, options: object): unknown;
      };
      expect(() =>
        unsafe.connections("Group", "items", { parents: "all", candidateIDs: [] }),
      ).toThrow("Unknown connection selection option");
    });
  });
  it("validates included record types and callback scopes", () => {
    const environment = seed();
    store.read(environment, (outer) => {
      const foreign = outer.get(
        "PostConnection",
        ConnectionHandler.getConnectionID("g2", "StoreFixture_feed", { filter: draft }),
      )!;
      store.read(environment, (inner) => {
        const posts = inner.get("Group", "g1")!.items.connections();
        expect(() => posts.include(foreign)).toThrow("same updater scope");
        const unsafe = posts as unknown as { include(record: object): void };
        expect(() => unsafe.include(inner.get("User", "u1")!)).toThrow("expected PostConnection");
      });
    });
  });
  it("reads cached nodes and filters one variant without touching other variants", () => {
    const environment = seed();
    store.read(environment, (view) => {
      const connection = view
        .get("Group", "g1")!
        .items.connection("StoreFixture_feed", { filter: draft })!;
      expect(connection.nodes().map((node) => node.title.get())).toEqual(["p1", "p2"]);
      expect(
        view.get("User", "u1")!.posts.connection("ConnectionKeysFixture_other"),
      ).toBeUndefined();
      expect(() =>
        (connection as unknown as { filter(predicate: () => boolean): void }).filter(() => false),
      ).toThrow("updater");
    });
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const connection = view
          .get("Group", "g1")!
          .items.connection("StoreFixture_feed", { filter: draft })!;
        connection.filter(
          (node, edge) => node.title.get() === "p2" && edge.cursor.get() === "cursor:p2",
        );
        expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p2"]);
        expect(connection.record.totalCount.get()).toBe(99);
        expect(connection.record.pageInfo.require().endCursor.get()).toBe("end");
        expect(view.get("Post", "p1")).toBeDefined();
      }),
    );
    expect(nodeIDs(environment)).toEqual(["p2"]);
    expect(nodeIDs(environment, "g1", published)).toEqual(["p1", "p2"]);
  });
  it("sorts and filters every cached variant using current updater data, with stable ties", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        view.get("Post", "p1")!.title.set("Beta");
        view.get("Post", "p2")!.title.set("Alpha");
        const post = view.upsert("Post", {
          id: "p3",
          title: "Initial",
          author: view.get("User", "u1")!,
        });
        post.title.set("Beta");
        const family = view.get("Group", "g1")!.items.connections();
        for (const connection of family.variants())
          connection.insertEdgeAfter(connection.createEdge(post));
        family.sort((a, b) => a.title.require().localeCompare(b.title.require()));
        for (const connection of family.variants()) {
          expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p2", "p1", "p3"]);
          expect(connection.record.edges.require()[0]!.cursor.get()).toBe("cursor:p2");
        }
        family
          .filter((node) => node.$.getDataID() !== "p1")
          .sort((a, b) => b.title.require().localeCompare(a.title.require()));
        for (const connection of family.variants()) {
          expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p3", "p2"]);
          expect(connection.record.totalCount.get()).toBe(99);
          expect(connection.record.pageInfo.require().endCursor.get()).toBe("end");
        }
      }),
    );
    expect(nodeIDs(environment, "g2")).toEqual(["p1", "p2"]);
  });
  it("preserves incomplete edges and nodes while transforming cached data", () => {
    const environment = seed();
    const id = ConnectionHandler.getConnectionID("g1", "StoreFixture_feed", { filter: draft });
    environment.commitUpdate((raw) => {
      const connection = raw.get(id)!;
      const [first, second] = connection.getLinkedRecords("edges")!;
      const missingNode = raw.create("missing-node-edge", "PostEdge");
      connection.setLinkedRecords([first, null, missingNode, second], "edges");
      store.proxy(environment, raw, (view) => {
        const typed = view
          .get("Group", "g1")!
          .items.connection("StoreFixture_feed", { filter: draft })!;
        typed.sort((a, b) => b.title.require().localeCompare(a.title.require()));
        expect(typed.record.edges.require().map((edge) => edge?.node.get()?.$.getDataID())).toEqual(
          ["p2", undefined, undefined, "p1"],
        );
        typed.filter(() => false);
        expect(typed.record.edges.require().map((edge) => edge?.$.getDataID())).toEqual([
          undefined,
          "missing-node-edge",
        ]);
        expect(typed.nodes()).toEqual([]);
      });
    });
  });
  it("prepares all variant transformations before writing and rejects async callbacks", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const family = view.get("Group", "g1")!.items.connections();
        let calls = 0;
        expect(() =>
          family.filter(() => {
            if (++calls === 3) throw new Error("bad predicate");
            return false;
          }),
        ).toThrow("bad predicate");
        for (const connection of family.variants()) expect(connection.nodes()).toHaveLength(2);
        const unsafe = family as unknown as {
          filter(predicate: () => Promise<boolean>): void;
          sort(compare: () => Promise<number>): void;
        };
        expect(() => unsafe.filter(async () => false)).toThrow("synchronous boolean");
        expect(() => unsafe.sort(async () => 0)).toThrow("synchronous number");
        expect(() => family.sort(() => NaN)).toThrow("synchronous number");
      }),
    );
    expect(nodeIDs(environment)).toEqual(["p1", "p2"]);
  });
  it("rolls back optimistic sort and filter changes", () => {
    const environment = seed();
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater(environment, (view) => {
        view
          .get("Group", "g1")!
          .items.connections()
          .sort((a, b) => b.title.require().localeCompare(a.title.require()))
          .filter((node) => node.$.getDataID() !== "p1");
      }),
    });
    expect(nodeIDs(environment)).toEqual(["p2"]);
    optimistic.dispose();
    expect(nodeIDs(environment)).toEqual(["p1", "p2"]);
  });
  it("guards runtime field access, unsupported scalars, link types and creation", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      store.proxy(environment, raw, (view) => {
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
        expect(
          view.upsert("User", { id: "u1", name: "Initial", friends: [], tags: [] }).name.get(),
        ).toBe("Initial");
        expect(() => view.delete("Post", "u1")).toThrow("expected Post");
      });
    });
  });
});
