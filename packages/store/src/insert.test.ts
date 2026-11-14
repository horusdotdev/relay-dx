import { ConnectionHandler } from "relay-runtime";
import { describe, expect, it } from "vite-plus/test";
import { store } from "../fixtures/__generated__/store.js";
import { draft, seed } from "../fixtures/environment.js";

describe("client IDs and duplicate-safe collection insertion", () => {
  it("creates unique, namespaced client IDs for concrete types", () => {
    const first = store.createClientID("Post");
    expect(first).toMatch(
      /^client:Post:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(store.createClientID("Post")).not.toBe(first);
    const unsafe = store as unknown as { createClientID(type: string): string };
    expect(() => unsafe.createClientID("Node")).toThrow("concrete schema type");
    expect(() => unsafe.createClientID("Missing")).toThrow("concrete schema type");
  });

  it("appends and prepends nodes once, keeping existing positions and cursors", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const connection = view
          .get("Group", "g1")!
          .items.connection("StoreFixture_feed", { filter: draft })!;
        const third = view.create("Post", "p3");
        const fourth = view.create("Post", "p4");
        third.id.set("same-scalar-id");
        fourth.id.set("same-scalar-id");
        connection.prependNode(view.get("Post", "p2")!);
        connection.appendNode(third);
        connection.appendNode(third);
        connection.prependNode(fourth);
        connection.prependNode(fourth);
        expect(connection.nodes().map((node) => node.$.getDataID())).toEqual([
          "p4",
          "p1",
          "p2",
          "p3",
        ]);
        expect(connection.record.edges.require().map((edge) => edge?.cursor.get())).toEqual([
          null,
          "cursor:p1",
          "cursor:p2",
          null,
        ]);
        expect(connection.record.totalCount.get()).toBe(99);
        expect(connection.record.pageInfo.require().endCursor.get()).toBe("end");
      }),
    );
  });

  it("applies duplicate-safe insertion across a field's cached variants", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const family = view.get("User", "u1")!.posts.connections();
        const post = view.create("Post", "p3");
        family.prependNode(post);
        family.appendNode(post);
        for (const connection of family.variants())
          expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p3", "p1", "p2"]);
        for (const connection of view.get("User", "u1")!.archivedPosts.connections().variants())
          expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p1"]);
      }),
    );
  });

  it("preserves null and missing edge references when inserting a node", () => {
    const environment = seed();
    const id = ConnectionHandler.getConnectionID("g1", "StoreFixture_feed", { filter: draft });
    let original: (string | null)[] = [];
    environment.commitUpdate((raw) => {
      const connection = raw.get(id)!;
      const [first, second] = connection.getLinkedRecords("edges")!;
      const missing = raw.create("missing-edge", "PostEdge");
      connection.setLinkedRecords([first, null, missing, second], "edges");
      original = [first.getDataID(), null, missing.getDataID(), second.getDataID()];
      raw.delete("missing-edge");
      store.withUpdater(environment, raw, (view) => {
        const typed = view
          .get("Group", "g1")!
          .items.connection("StoreFixture_feed", { filter: draft })!;
        const post = view.create("Post", "p3");
        typed.appendNode(post);
        typed.appendNode(post);
      });
    });
    const edges = environment.getStore().getSource().get(id)!.edges as {
      __refs: (string | null)[];
    };
    expect(edges.__refs.slice(0, 4)).toEqual(original);
    expect(edges.__refs).toHaveLength(5);
  });

  it("appends and prepends typed list records once, isolating argument variants", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const root = view.getRoot();
        const first = view.get("Post", "p1")!;
        const second = view.get("Post", "p2")!;
        root.recentNodes.set([first, null, second], { limit: 10 });
        root.recentNodes.prepend(second, { limit: 10 });
        root.recentNodes.append(first, { limit: 10 });
        const third = view.create("Post", "p3");
        root.recentNodes.append(third, { limit: 10 });
        root.recentNodes.append(third, { limit: 10 });
        expect(root.recentNodes.require({ limit: 10 }).map((node) => node?.$.getDataID())).toEqual([
          "p1",
          undefined,
          "p2",
          "p3",
        ]);
        expect(root.recentNodes.get({ limit: 20 })).toBeUndefined();
        root.recentNodes.set(null);
        root.recentNodes.prepend(second);
        expect(root.recentNodes.require().map((node) => node?.$.getDataID())).toEqual(["p2"]);
        const user = view.create("User", "new-user");
        user.friends.append(view.get("User", "u1")!);
        expect(user.friends.require().map((node) => node?.$.getDataID())).toEqual(["u1"]);
        root.requiredNodes.append(first, { input: draft });
        expect(root.requiredNodes.require({ input: draft })).toHaveLength(1);
      }),
    );
  });

  it("keeps dangling list references and current native updater changes", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      const missing = raw.create("missing-post", "Post");
      raw.getRoot().setLinkedRecords([raw.get("p1")!, null, missing], "recentNodes", { limit: 10 });
      raw.delete("missing-post");
      store.withUpdater(environment, raw, (view) => {
        view.getRoot().recentNodes.append(view.get("Post", "p2")!, { limit: 10 });
        view.getRoot().recentNodes.append(view.get("Post", "p2")!, { limit: 10 });
      });
    });
    expect(environment.getStore().getSource().get("client:root")!["recentNodes(limit:10)"]).toEqual(
      { __refs: ["p1", null, "missing-post", "p2"] },
    );
  });

  it("checks node types, scopes and updater-only access", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      store.withUpdater(environment, raw, (outer) => {
        const foreign = outer.get("Post", "p1")!;
        store.withUpdater(environment, raw, (view) => {
          const connection = view
            .get("Group", "g1")!
            .items.connection("StoreFixture_feed", { filter: draft })!;
          expect(() => connection.appendNode(foreign)).toThrow("same updater scope");
          expect(() => view.getRoot().recentNodes.append(foreign)).toThrow("same updater scope");
          const unsafe = connection as unknown as { appendNode(node: object): void };
          expect(() => unsafe.appendNode(view.get("User", "u1")!)).toThrow("expected Post");
        });
      });
    });
    store.read(environment, (view) => {
      expect("append" in view.getRoot().recentNodes).toBe(false);
      const connection = view
        .get("Group", "g1")!
        .items.connection("StoreFixture_feed", { filter: draft })!;
      const unsafe = connection as unknown as { appendNode(node: object): void };
      expect(() => unsafe.appendNode(view.get("Post", "p1")!)).toThrow("updater scope");
    });
  });

  it("reuses a generated ID through optimistic replay and rolls back both collections", () => {
    const environment = seed();
    const id = store.createClientID("Post");
    let runs = 0;
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater(environment, (view) => {
        runs++;
        const post = view.create("Post", id);
        view.getRoot().recentNodes.append(post);
        view.getRoot().recentNodes.append(post);
        view.get("Group", "g1")!.items.connections().prependNode(post);
        view.get("Group", "g1")!.items.connections().prependNode(post);
      }),
    });
    environment.commitUpdate(
      store.updater(environment, (view) => view.get("User", "u1")!.name.set("Grace")),
    );
    expect(runs).toBeGreaterThan(1);
    store.read(environment, (view) => {
      expect(
        view
          .getRoot()
          .recentNodes.require()
          .map((node) => node?.$.getDataID()),
      ).toEqual([id]);
      for (const connection of view.get("Group", "g1")!.items.connections().variants())
        expect(connection.nodes().map((node) => node.$.getDataID())).toEqual([id, "p1", "p2"]);
    });
    optimistic.dispose();
    store.read(environment, (view) => {
      expect(view.getRoot().recentNodes.get()).toBeUndefined();
      expect(view.get("Post", id)).toBeUndefined();
      for (const connection of view.get("Group", "g1")!.items.connections().variants())
        expect(connection.nodes()).toHaveLength(2);
    });
  });
});
