import { describe, expect, it } from "vite-plus/test";
import { store } from "../fixtures/__generated__/store.js";
import { seed } from "../fixtures/environment.js";

describe("selection-aware upserts", () => {
  it("writes identity once, accepts nested upserts and returns typed linked handles", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const post = view.upsert("Post", {
          id: "new-post",
          title: "Hello",
          author: view.upsert("User", { id: "new-author", name: "Ada", friends: [], tags: [] }),
        });
        expect(post.$.getDataID()).toBe("new-post");
        expect(post.id.get()).toBe("new-post");
        expect(post.title.get()).toBe("Hello");
        expect(post.author.require().name.get()).toBe("Ada");
        expect(post.body.get()).toBeUndefined();
      }),
    );
  });

  it("merges into an existing record and preserves omitted fields", () => {
    const environment = seed();
    environment.commitUpdate(
      store.updater(environment, (view) => {
        const user = view.upsert("User", {
          id: "u1",
          name: "New name",
          friends: [],
          tags: [],
          constructor: "Own field",
        });
        expect(user.$.getDataID()).toBe("u1");
        expect(user.name.get()).toBe("New name");
        expect(user.avatar.get()).toBe("https://example.com/avatar");
        expect(user.friend.require().name.get()).toBe("Grace");
        expect(user.constructor.get()).toBe("Own field");
        expect(() => view.upsert("Post", { id: "u1", title: "Wrong type", author: user })).toThrow(
          "expected Post",
        );
        expect(user.name.get()).toBe("New name");
      }),
    );
  });

  it("initializes argument variants optionally without reading existing handle contents", () => {
    const environment = seed();
    environment.commitUpdate((raw) => {
      raw.create("partial-user", "User");
      store.withUpdater(environment, raw, (view) => {
        const post = view.upsert("Post", {
          id: "post",
          title: "Hello",
          author: view.get("User", "partial-user")!,
        });
        expect(post.author.require().name.get()).toBeUndefined();
        const required = {
          title: "Hello",
          semantic: "Present",
          conditional: "Present",
          requiredLabel: "Present",
          strictItems: [],
          nested: [],
        };
        const record = view.upsert("CreationFixture", {
          id: "argumented",
          ...required,
          argumented: [
            { args: { locale: "en" }, value: "Hello" },
            { args: { locale: "fr" }, value: "Bonjour" },
          ],
        });
        expect(record.argumented.get({ locale: "en" })).toBe("Hello");
        expect(record.argumented.get({ locale: "fr" })).toBe("Bonjour");
        expect(record.argumented.get({ locale: "de" })).toBeUndefined();
        expect(record.optional.get()).toBeUndefined();
        view.upsert("CreationFixture", { id: "argumented", ...required, title: "Updated" });
        expect(record.argumented.get({ locale: "fr" })).toBe("Bonjour");
      });
    });
  });

  it("rolls back optimistic inserts and merges", () => {
    const environment = seed();
    const optimistic = environment.applyUpdate({
      storeUpdater: store.updater(environment, (view) => {
        const user = view.upsert("User", { id: "u1", name: "Optimistic", friends: [], tags: [] });
        view.upsert("Post", { id: "optimistic-post", title: "Optimistic", author: user });
      }),
    });
    expect(store.read(environment, (view) => view.get("User", "u1")!.name.get())).toBe(
      "Optimistic",
    );
    optimistic.dispose();
    store.read(environment, (view) => {
      expect(view.get("User", "u1")!.name.get()).toBe("Ada");
      expect(view.get("Post", "optimistic-post")).toBeUndefined();
    });
  });
});
