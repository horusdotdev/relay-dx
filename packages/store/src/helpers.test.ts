import { describe, expect, it } from "vite-plus/test";
import {
  ConnectionHandler,
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  commitMutation,
  createOperationDescriptor,
  requestSubscription,
} from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";
import typeQuery from "../fixtures/__generated__/TypeRefinementFixtureQuery.graphql.js";
import mutation from "../fixtures/__generated__/PayloadFixtureMutation.graphql.js";
import subscription from "../fixtures/__generated__/PayloadFixtureSubscription.graphql.js";
import { seed, draft } from "../fixtures/environment.js";

function payloadEnvironment(data: object) {
  return new Environment({
    network: Network.create(
      () => Observable.from({ data }),
      () => Observable.from({ data }),
    ),
    store: new Store(new RecordSource()),
  });
}

describe("store infrastructure helpers", () => {
  it("reads masked id-less mutation payloads, aliases, arguments and plural fields", () => {
    const environment = payloadEnvironment({
      result: { details: { label: "value" } },
      updateValues: [{ details: { label: "other" } }, null],
    });
    let called = false;
    commitMutation(environment, {
      mutation,
      variables: { input: "input" },
      updater: store.updater<unknown>((view) => {
        called = true;
        const payload = view.getRootField("Mutation", "updateValue")!;
        expect(payload.details.require().label.get()).toBe("value");
        payload.details.require().label.set("edited");
        expect(view.getRootField("Mutation", "updateValue")!.details.require().label.get()).toBe(
          "edited",
        );
        const values = view.getRootField("Mutation", "updateValues")!;
        expect(values[0]!.details.require().label.get()).toBe("other");
        expect(values[1]).toBeNull();
      }),
      onError: (error) => {
        throw error;
      },
    });
    expect(called).toBe(true);
  });

  it("reads id-less subscription payloads and null results", () => {
    for (const valueChanged of [{ details: { label: "value" } }, null]) {
      const environment = payloadEnvironment({ valueChanged });
      let called = false;
      const disposable = requestSubscription(environment, {
        subscription,
        variables: {},
        updater: store.updater<unknown>((view) => {
          called = true;
          const value = view.getRootField("Subscription", "valueChanged");
          if (valueChanged === null) expect(value).toBeNull();
          else expect(value!.details.require().label.get()).toBe("value");
        }),
        onError: (error) => {
          throw error;
        },
      });
      expect(called).toBe(true);
      disposable.dispose();
    }
  });

  it("copies abstract handles with their concrete type and merges current cached fields", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater((view) => {
        const source = view.get("RecordItem", "u1")!;
        source.$.as("User")!.name.set("edited");
        const copy = view.copy(source, "copy");
        expect(copy.$.getType()).toBe("User");
        expect(copy.$.as("User")!.name.get()).toBe("edited");
        expect(copy.$.as("User")!.friend.require().$.getDataID()).toBe("u2");
        const target = view.get("User", "u2")!;
        target.tags.set(["retained"]);
        target.$.copyFrom(source.$.as("User")!);
        expect(target.name.get()).toBe("edited");
        expect(target.$.getDataID()).toBe("u2");
        expect(() => view.copy(source, "p1")).toThrow("Cannot copy");
        expect(() => view.copy(source, "client:root")).toThrow("root record");
        view.copy(source, "copy");
        const post = view.copy(view.get("Post", "p1")!, "post-copy");
        post.body.set("retained");
        post.$.copyFrom(view.get("Post", "p1")!);
        expect(post.body.get()).toBe("retained");
        expect(post.$.field("id").get()).toBe("p1");
      }),
    );
    store.read(environment, (view) => expect(view.get("User", "copy")!.name.get()).toBe("edited"));
  });

  it("links an existing handled connection and preserves its edges and metadata", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater((view) => {
        const source = view
          .get("User", "u1")!
          .posts.connection("StoreFixture_posts", { filter: draft })!;
        const target = view.get("User", "u2")!;
        target.posts.linkConnection("StoreFixture_posts", source, { filter: draft });
        const linked = target.posts.connection("StoreFixture_posts", { filter: draft })!;
        expect(linked.record.$.getDataID()).toBe(source.record.$.getDataID());
        expect(linked.nodes().map((node) => node.$.getDataID())).toEqual(["p1", "p2"]);
        linked.record.totalCount.set(123);
        expect(source.record.totalCount.get()).toBe(123);
        expect(target.posts.connections().variants()).toHaveLength(1);
      }),
    );
    store.read(environment, (view) => {
      const linked = view
        .get("User", "u2")!
        .posts.connection("StoreFixture_posts", { filter: draft })!;
      expect(linked.record.totalCount.get()).toBe(123);
    });
    expect(store.connectionID("u1", "StoreFixture_posts", { filter: draft })).toBe(
      ConnectionHandler.getConnectionID("u1", "StoreFixture_posts", { filter: draft }),
    );
  });

  it("scans concrete types, interfaces and unions, including the Query root", () => {
    const environment = seed();
    store.read(environment, (view) => {
      const ids = (type: "User" | "Node" | "RecordItem" | "HasPosts" | "Payload") =>
        view
          .getAll(type)
          .map((record) => record.$.getDataID())
          .sort();
      expect(ids("User")).toEqual(["u1", "u2"]);
      expect(ids("HasPosts")).toEqual(["u1", "u2"]);
      expect(ids("Node")).toEqual(["g1", "g2", "p1", "p2", "u1", "u2"]);
      expect(ids("RecordItem")).toEqual(["p1", "p2", "u1", "u2"]);
      expect(ids("Payload")).toEqual([]);
      expect(view.getAll("Query")[0].$.getDataID()).toBe("client:root");
    });
  });

  it("scans current updater changes and enforces callback scope on results", () => {
    const environment = seed();
    const escaped = store.read(environment, (view) => view.getAll("User")[0]);
    expect(() => escaped.name.get()).toThrow("escaped");
    environment.commitUpdate(
      store.updater((view) => {
        const before = view.getAll("User");
        view.copy(view.get("User", "u1")!, "new");
        view.delete("User", "u2");
        expect(before).toHaveLength(2);
        expect(
          view
            .getAll("User")
            .map((record) => record.$.getDataID())
            .sort(),
        ).toEqual(["new", "u1"]);
        for (const record of view.getAll("HasPosts")) record.$.as("User")!.name.set("updated");
        view.get("Node", "new")!.$.setType("Post");
        expect(view.getAll("User").map((record) => record.$.getDataID())).toEqual(["u1"]);
        expect(view.getAll("RecordItem").some((record) => record.$.getDataID() === "new")).toBe(
          true,
        );
      }),
    );
    store.read(environment, (view) => {
      expect(view.getAll("User").map((record) => record.name.get())).toEqual(["updated"]);
    });
  });

  it("computes typed connection IDs with parent-specific keys and filters", () => {
    expect(store.connectionID("User", "u1", "StoreFixture_posts", { filter: draft })).toBe(
      ConnectionHandler.getConnectionID("u1", "StoreFixture_posts", { filter: draft }),
    );
    expect(store.connectionID("HasPosts", "u1", "ConnectionKeysFixture_posts")).toBe(
      ConnectionHandler.getConnectionID("u1", "ConnectionKeysFixture_posts"),
    );
    const unchecked = store.connectionID as (...args: unknown[]) => string;
    expect(() => unchecked("User", "u1", "StoreFixture_feed")).toThrow("Unknown connection key");
    expect(() => unchecked("User", "u1", "StoreFixture_posts", { first: 1 })).toThrow(
      "Invalid connection filters",
    );
  });

  it("returns the runtime concrete handle and enforces scope after refinement", () => {
    const environment = seed();
    const escaped = store.read(environment, (view) => {
      const node = view.get("Node", "u1")!.$.concrete();
      expect(node.$.getType()).toBe("User");
      return view.get("Node", "u1")!.$.concrete;
    });
    expect(() => escaped()).toThrow("escaped");
    environment.commitUpdate(
      store.updater((view) => {
        const user = view.get("HasPosts", "u1")!.$.concrete();
        user.name.set("updated");
        expect(user.name.get()).toBe("updated");
        view.get("Node", "u1")!.$.setType("Post");
        expect(view.get("Node", "u1")!.$.concrete().$.getType()).toBe("Post");
      }),
    );
  });

  it("reads Relay-normalized type-schema flags without inventing missing refinements", () => {
    const environment = seed();
    expect(
      store.read(environment, (view) => view.getTypeRefinement("User", "Node")),
    ).toBeUndefined();
    environment.commitPayload(createOperationDescriptor(typeQuery, { id: "u1" }), {
      node: { __typename: "User", __isNode: "User", id: "u1" },
    });
    store.read(environment, (view) => {
      expect(view.getTypeRefinement("User", "Node")).toBe(true);
      expect(view.getTypeRefinement("User", "HasPosts")).toBeUndefined();
    });
    environment.commitUpdate((raw) => {
      raw.get("client:__type:User")!.setValue(false, "__isNode");
      store.proxy(raw, (view) => expect(view.getTypeRefinement("User", "Node")).toBe(false));
    });
    const escaped = store.read(environment, (view) => {
      expect(view.getTypeRefinement("User", "Node")).toBe(false);
      return view.getTypeRefinement;
    });
    expect(() => escaped("User", "Node")).toThrow("escaped");
  });

  it("lists live IDs and resolves dynamic field variants including unpublished edits", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater((view) => {
        view.copy(view.get("User", "u1")!, "new");
        view.delete("User", "u2");
        expect(view.ids()).toContain("new");
        expect(view.ids()).not.toContain("u2");
        const field = view.get("User", "u1")!.$.field("name");
        field.set("updated");
        expect(field.variants()[0].get()).toBe("updated");
      }),
    );
    const escaped = store.read(environment, (view) => {
      expect(view.ids()).toContain("new");
      return view.get("User", "u1")!.$.field;
    });
    expect(() => escaped("name")).toThrow("escaped");
  });

  it("rejects payload access without a selector and copies across callback scopes", () => {
    const environment = seed();
    environment.commitUpdate((raw) =>
      store.proxy(raw, (outer) => {
        expect(() => outer.getRootField("Mutation", "updateValue")).toThrow("selector updater");
        const foreign = outer.get("User", "u1")!;
        store.proxy(raw, (inner) => {
          expect(() => inner.copy(foreign, "new")).toThrow("same updater scope");
          const connection = foreign.posts.connection("StoreFixture_posts", { filter: draft })!;
          expect(() =>
            inner.get("User", "u2")!.posts.linkConnection("StoreFixture_posts", connection),
          ).toThrow("same updater scope");
          expect(() => inner.get("User", "u2")!.$.copyFrom(foreign)).toThrow("same updater scope");
        });
      }),
    );
  });
});
