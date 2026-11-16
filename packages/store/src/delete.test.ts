import { ConnectionHandler, RecordSource } from "relay-runtime";
import { describe, expect, it } from "vite-plus/test";
import { store } from "../fixtures/__generated__/store.js";
import { draft, seed } from "../fixtures/environment.js";

describe("record deletion with collection pruning", () => {
  it.each([undefined, { prune: false }])("preserves memberships by default (%j)", (options) => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      raw.getRoot().setLinkedRecords([raw.get("p1")!, raw.get("p2")!], "recentNodes");
    });
    environment.commitUpdate(
      store.updater(environment, (view) => view.delete("Post", "p1", options)),
    );
    store.read(environment, (view) => {
      expect(view.get("Post", "p1")).toBeUndefined();
      expect(view.getRoot().recentNodes.require()).toHaveLength(2);
      expect(
        view.get("Group", "g1")!.items.connections().variants()[0].record.edges.require(),
      ).toHaveLength(2);
    });
  });

  it("shortens all connection variants and argument-specific lists, preserving other data", () => {
    const environment = seed();
    const source = environment.getStore().getSource();
    environment.getStore().publish(
      new RecordSource({
        u1: { ...source.get("u1")!, opaque: { __refs: ["p1"] } },
      }),
    );
    environment.commitUpdate((raw) => {
      const ghost = raw.create("ghost", "Post");
      raw
        .getRoot()
        .setLinkedRecords(
          [raw.get("p1")!, raw.get("p2")!, raw.get("p1")!, null, raw.get("u1")!, ghost],
          "recentNodes",
          { limit: 10 },
        );
      raw.getRoot().setLinkedRecords([raw.get("p1")!], "recentNodes", { limit: 20 });
      raw.getRoot().setLinkedRecord(raw.get("p1")!, "node", { id: "p1" });
      raw.get("u1")!.setValue(["p1", "p2"], "tags");
      raw.delete("ghost");
    });
    environment.commitUpdate(
      store.updater(environment, (view) => view.delete("Post", "p1", { prune: true })),
    );
    store.read(environment, (view) => {
      expect(view.get("Post", "p1")).toBeUndefined();
      for (const parent of ["g1", "g2"]) {
        for (const connection of view.get("Group", parent)!.items.connections().variants()) {
          expect(connection.record.edges.require()).toHaveLength(1);
          expect(connection.nodes().map((node) => node.$.getDataID())).toEqual(["p2"]);
          expect(connection.record.edges.require()[0]!.cursor.get()).toBe("cursor:p2");
          expect(connection.record.totalCount.get()).toBe(99);
          expect(connection.record.pageInfo.require().endCursor.get()).toBe("end");
        }
      }
      const user = view.get("User", "u1")!;
      for (const connection of user.posts.connections().variants())
        expect(connection.record.edges.require()).toHaveLength(1);
      for (const connection of user.archivedPosts.connections().variants())
        expect(connection.record.edges.require()).toHaveLength(0);
      expect(user.tags.get()).toEqual(["p1", "p2"]);
      expect(source.get("u1")!.opaque).toEqual({ __refs: ["p1"] });
      expect(view.get("Post", "p2")).toBeDefined();
    });
    const root = source.get("client:root")!;
    expect(root["recentNodes(limit:10)"]).toEqual({ __refs: ["p2", null, "u1", "ghost"] });
    expect(root["recentNodes(limit:20)"]).toEqual({ __refs: [] });
    expect(root['node(id:"p1")']).toEqual({ __ref: "p1" });
  });

  it("includes fresh native updater records and honors current edits to lists and edge nodes", () => {
    const environment = seed();
    const id = ConnectionHandler.getConnectionID("g1", "StoreFixture_feed", { filter: draft });
    environment.commitUpdate((raw) => {
      raw.getRoot().setLinkedRecords([raw.get("p1")!], "recentNodes", { limit: 1 });
    });
    environment.commitUpdate((raw) => {
      const post = raw.get("p2")!;
      raw.getRoot().setLinkedRecords([post], "recentNodes", { limit: 1 });
      raw.get(id)!.getLinkedRecords("edges")![0].setLinkedRecord(post, "node");
      const fresh = raw.create("fresh-parent", "Query");
      fresh.setLinkedRecords([raw.get("p1")!, post], "recentNodes", { limit: 5 });
      const connection = raw.create("fresh-connection", "PostConnection");
      const edge = raw.create("fresh-edge", "PostEdge");
      edge.setLinkedRecord(raw.get("p1")!, "node");
      connection.setLinkedRecords([edge], "edges");
      connection.setValue(7, "totalCount");
      store.proxy(environment, raw, (view) => view.delete("Post", "p1", { prune: true }));
      expect(
        fresh.getLinkedRecords("recentNodes", { limit: 5 })?.map((node) => node.getDataID()),
      ).toEqual(["p2"]);
      expect(connection.getLinkedRecords("edges")).toEqual([]);
      expect(connection.getValue("totalCount")).toBe(7);
    });
    store.read(environment, (view) => {
      expect(
        view
          .getRoot()
          .recentNodes.require({ limit: 1 })
          .map((node) => node?.$.getDataID()),
      ).toEqual(["p2"]);
      expect(
        view
          .get("PostConnection", id)!
          .edges.require()
          .map((edge) => edge?.node.get()?.$.getDataID()),
      ).toEqual(["p2", "p2"]);
    });
  });

  it("can prune dangling references when the target record was already deleted", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      raw.getRoot().setLinkedRecords([raw.get("p1")!], "recentNodes");
      raw.delete("p1");
    });
    environment.commitUpdate(
      store.updater(environment, (view) => {
        view.delete("Post", "p1", { prune: true });
        view.delete("Post", "missing", { prune: true });
      }),
    );
    store.read(environment, (view) => {
      expect(view.getRoot().recentNodes.get()).toEqual([]);
      for (const connection of view.get("Group", "g1")!.items.connections().variants())
        expect(connection.record.edges.require()).toHaveLength(1);
    });
  });

  it("rolls back optimistic pruning and deletion together", () => {
    const environment = seed();
    environment.commitUpdate((raw) =>
      raw.getRoot().setLinkedRecords([raw.get("p1")!, raw.get("p2")!], "recentNodes"),
    );
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater(environment, (view) =>
        view.delete("Post", "p1", { prune: true }),
      ),
    });
    store.read(environment, (view) => {
      expect(view.getRoot().recentNodes.require()).toHaveLength(1);
      expect(
        view.get("Group", "g1")!.items.connections().variants()[0].record.edges.require(),
      ).toHaveLength(1);
      expect(view.get("Post", "p1")).toBeUndefined();
    });
    optimistic.dispose();
    store.read(environment, (view) => {
      expect(view.getRoot().recentNodes.require()).toHaveLength(2);
      expect(
        view.get("Group", "g1")!.items.connections().variants()[0].record.edges.require(),
      ).toHaveLength(2);
      expect(view.get("Post", "p1")).toBeDefined();
    });
  });

  it("rejects type mismatches and root deletion before pruning any memberships", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        expect(() => view.delete("User", "p1", { prune: true })).toThrow("expected User");
        expect(() => view.delete("Query", "client:root", { prune: true })).toThrow("root record");
        expect(
          view.get("Group", "g1")!.items.connections().variants()[0].record.edges.require(),
        ).toHaveLength(2);
        expect(view.get("Post", "p1")).toBeDefined();
      }),
    );
  });
});
