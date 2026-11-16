import { ConnectionHandler, Environment, Network, RecordSource, Store } from "relay-runtime";
import { describe, expect, it } from "vite-plus/test";
import { store } from "../fixtures/__generated__/adoption.js";

function seed() {
  const environment = new Environment({
    network: Network.create(() => {
      throw new Error("Unexpected network request");
    }),
    store: new Store(new RecordSource()),
  });
  environment.commitUpdate(
    store.updater((view) => {
      view.upsert("Studio", { id: "studio:1" });
      view.upsert("Recording", {
        id: "recording:1",
        title: "Overture",
        availability: "READY",
        duration: 180,
      });
    }),
  );
  return environment;
}

describe("adoption APIs on Relay 21 updater proxies", () => {
  it("keeps proxy-only handles typed and expires detached record operations", () => {
    const environment = seed();
    let escaped: (() => void) | undefined;
    environment.commitUpdate((raw) =>
      store.proxy(raw, (view) => {
        const recording = view.get("Recording", "recording:1")!;
        expect(Object.keys(view)).not.toContain("ensure");
        recording.title.set("Interlude");
        expect(() => view.get("Episode", "recording:1")).toThrow("expected Episode");
        escaped = recording.$.invalidate;
      }),
    );
    expect(() => escaped!()).toThrow("escaped");
    expect(
      store.read(environment, (view) => view.get("Recording", "recording:1")!.title.get()),
    ).toBe("Interlude");
  });

  it("writes Relay enum payloads without casts and rolls optimistic creation back", () => {
    const environment = seed();
    const payload: { availability: "QUEUED" | "READY" | "%future added value" } = {
      availability: "%future added value",
    };
    const update = environment.applyUpdate({
      storeUpdater: store.updater((view) => {
        view.get("Recording", "recording:1")!.availability.set(payload.availability);
        view.upsert("Episode", { id: "episode:temporary", title: "Preview" });
      }),
    });
    expect(
      store.read(environment, (view) => view.get("Recording", "recording:1")!.availability.get()),
    ).toBe("%future added value");
    update.dispose();
    expect(
      store.read(environment, (view) => view.get("Recording", "recording:1")!.availability.get()),
    ).toBe("READY");
    // Mutation response arguments are also supported by the environment-free overload.
    environment.commitUpdate((raw) =>
      store.updater<typeof payload>((view, data) => {
        view.get("Recording", "recording:1")!.availability.set(data!.availability);
      })(raw, payload),
    );
    expect(
      store.read(environment, (view) => view.get("Recording", "recording:1")!.availability.get()),
    ).toBe("%future added value");
    expect(
      store.read(environment, (view) => view.get("Episode", "episode:temporary")),
    ).toBeUndefined();
  });

  it("invalidates records and the store through Relay's invalidation mechanism", () => {
    const environment = seed();
    const relayStore = environment.getStore();
    const before = relayStore.lookupInvalidationState(["recording:1"]);
    environment.commitUpdate(
      store.updater((view) => view.get("Recording", "recording:1")!.$.invalidate()),
    );
    expect(relayStore.checkInvalidationState(before)).toBe(true);
    const after = relayStore.lookupInvalidationState([]);
    environment.commitUpdate(store.updater((view) => view.invalidateStore()));
    expect(relayStore.checkInvalidationState(after)).toBe(true);
  });

  it("seeds handled connections and accepts subsequent Relay pagination edges", () => {
    const environment = seed();
    environment.commitUpdate((raw) =>
      store.proxy(raw, (view) => {
        const studio = view.get("Studio", "studio:1")!;
        const connection = studio.recordings.createConnection("Library_recordings", {
          genre: "jazz",
        });
        connection.appendNode(view.get("Recording", "recording:1")!);
        connection.record.pageInfo.require().endCursor.set("cursor:seed");
        expect(
          studio.recordings.createConnection("Library_recordings", { genre: "jazz" }).nodes(),
        ).toHaveLength(1);
        expect(studio.recordings.connections().variants()).toHaveLength(1);
        const parent = raw.get("studio:1")!;
        const handled = ConnectionHandler.getConnection(parent, "Library_recordings", {
          genre: "jazz",
        })!;
        expect(handled.getValue("__connection_next_edge_index")).toBe(0);
        const server = raw.create("server:page", "RecordingConnection");
        const edge = raw.create("server:edge", "RecordingEdge");
        const next = view.upsert("Recording", {
          id: "recording:next",
          title: "Finale",
          availability: "READY",
          duration: 240,
        });
        edge.setLinkedRecord(raw.get(next.$.getDataID())!, "node");
        edge.setValue("cursor:next", "cursor");
        server.setLinkedRecords([edge], "edges");
        parent.setLinkedRecord(server, "recordings", {
          first: 1,
          after: "cursor:seed",
          genre: "jazz",
        });
        ConnectionHandler.update(raw, {
          dataID: "studio:1",
          fieldKey: 'recordings(after:"cursor:seed",first:1,genre:"jazz")',
          handleKey: '__Library_recordings_connection(genre:"jazz")',
          handle: "connection",
          args: { first: 1, after: "cursor:seed", genre: "jazz" },
        });
        expect(connection.nodes().map((node) => node.$.getDataID())).toEqual([
          "recording:1",
          "recording:next",
        ]);
        expect(handled.getValue("__connection_next_edge_index")).toBe(1);
      }),
    );
  });

  it("discovers freshly created parents and connections during proxy-only all-parent scans", () => {
    const environment = seed();
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater((view) => {
        const studio = view.upsert("Studio", { id: "studio:fresh" });
        studio.recordings
          .createConnection("Library_recordings")
          .appendNode(view.get("Recording", "recording:1")!);
        const family = view.connections("Studio", "recordings", { parents: "all" });
        expect(family.variants()).toHaveLength(1);
        family.removeNodes(["recording:1"]);
        expect(family.variants()[0].nodes()).toEqual([]);
        view.delete("Recording", "recording:1", { prune: true });
      }),
    });
    optimistic.dispose();
    store.read(environment, (view) => {
      expect(view.get("Studio", "studio:fresh")).toBeUndefined();
      expect(view.get("Recording", "recording:1")).toBeDefined();
    });
  });

  it("reuses existing handle links even when their connection ID was supplied by the app", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      raw
        .get("studio:1")!
        .setLinkedRecord(
          raw.create("connection:custom", "RecordingConnection"),
          "__Library_recordings_connection",
          { genre: "ambient" },
        );
      store.proxy(raw, (view) => {
        const field = view.get("Studio", "studio:1")!.recordings;
        const connection = field.createConnection("Library_recordings", { genre: "ambient" });
        connection.appendNode(view.get("Recording", "recording:1")!);
        expect(connection.record.$.getDataID()).toBe("connection:custom");
        expect(field.connection("Library_recordings", { genre: "ambient" })!.nodes()).toHaveLength(
          1,
        );
      });
    });
    store.read(environment, (view) =>
      expect(
        view
          .get("Studio", "studio:1")!
          .recordings.connection("Library_recordings", { genre: "ambient" })!
          .record.$.getDataID(),
      ).toBe("connection:custom"),
    );
  });

  it("enumerates opaque scalar and linked-list variants with typed, scoped setters", () => {
    const environment = seed();
    let late: (() => unknown) | undefined;
    environment.commitUpdate(
      store.updater((view) => {
        const studio = view.get("Studio", "studio:1")!;
        const recording = view.get("Recording", "recording:1")!;
        studio.takes.set([recording], { limit: 2 });
        studio.takes.set([recording], { limit: 30 });
        studio.label.set("Live", { locale: 'en:()"' });
        studio.label.set("Direct", { locale: "fr" });
        expect(studio.takes.variants().map((variant) => variant.storageKey)).toEqual([
          "takes(limit:2)",
          "takes(limit:30)",
        ]);
        for (const variant of studio.takes.variants()) {
          expect(variant.require()[0]!.$.getDataID()).toBe("recording:1");
          variant.set([]);
        }
        for (const variant of studio.label.variants()) variant.set(variant.require().toUpperCase());
        late = studio.label.variants()[0].get;
      }),
    );
    expect(() => late!()).toThrow("escaped");
    store.read(environment, (view) => {
      const studio = view.get("Studio", "studio:1")!;
      expect(studio.label.variants().map((variant) => variant.get())).toEqual(["LIVE", "DIRECT"]);
      expect(studio.takes.variants().map((variant) => variant.get())).toEqual([[], []]);
    });
  });

  it("preserves opaque values on types outside generated metadata during pruning", () => {
    const environment = seed();
    environment.getStore().publish(
      new RecordSource({
        "cache:external": {
          __id: "cache:external",
          __typename: "ExternalCache",
          payload: { __refs: ["recording:1"] },
        },
      }),
    );
    environment.commitUpdate((raw) => {
      store.proxy(raw, (view) => {
        const studio = view.get("Studio", "studio:1")!;
        studio.takes.set([view.get("Recording", "recording:1")!], { limit: 3 });
        view.delete("Recording", "recording:1", { prune: true });
        expect(studio.takes.get({ limit: 3 })).toEqual([]);
      });
    });
    expect(environment.getStore().getSource().get("cache:external")!.payload).toEqual({
      __refs: ["recording:1"],
    });
  });

  it("explicitly assigns only possible concrete typenames through abstract handles", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater((view) => {
        const media = view.get("Media", "recording:1")!;
        const episode = media.$.setType("Episode");
        episode.title.set("A conversation");
        expect(media.$.as("Episode")!.title.get()).toBe("A conversation");
      }),
    );
    expect(store.read(environment, (view) => view.get("Episode", "recording:1")!.$.getType())).toBe(
      "Episode",
    );
  });
});
