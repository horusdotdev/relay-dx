import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createStoreAPI } from "./index.js";
import { store } from "../fixtures/__generated__/store.js";
import { seed } from "../fixtures/environment.js";

// Exercise the real Relay cache rather than a schema field that resembles one.
const { LiveResolverCache } = createRequire(import.meta.url)(
  "relay-runtime/lib/store/live-resolvers/LiveResolverCache.js",
) as {
  LiveResolverCache: new (...args: unknown[]) => {
    readFromCacheOrEvaluate(...args: unknown[]): unknown[];
  };
};

const flags = createRequire(import.meta.url)("relay-runtime/lib/util/RelayFeatureFlags.js") as {
  ENABLE_READ_TIME_RESOLVER_STORAGE_KEY_PREFIX: boolean;
};
const originalPrefix = flags.ENABLE_READ_TIME_RESOLVER_STORAGE_KEY_PREFIX;
afterEach(() => {
  flags.ENABLE_READ_TIME_RESOLVER_STORAGE_KEY_PREFIX = originalPrefix;
});

describe("record copies and Relay resolver caches", () => {
  for (const prefix of [true, false]) {
    for (const mode of ["copy", "copyFrom"] as const) {
      for (const cachedTarget of [false, true]) {
        it(`isolates ${mode} evaluations with prefix ${prefix}, cached target ${cachedTarget}`, () => {
          flags.ENABLE_READ_TIME_RESOLVER_STORAGE_KEY_PREFIX = prefix;
          const environment = seed();
          const cache = new LiveResolverCache(
            () => environment.getStore().getSource(),
            environment.getStore(),
          );
          const evaluations = new Map<string, number>();
          const read = (id: string) =>
            cache.readFromCacheOrEvaluate(
              id,
              { kind: "RelayResolver", name: "computedLabel", args: null, fragment: null },
              {},
              () => {
                evaluations.set(id, (evaluations.get(id) ?? 0) + 1);
                return { resolverResult: `computed:${id}`, snapshot: null, error: null };
              },
              () => {
                throw new Error("No fragment in this resolver");
              },
            )[0];
          expect(read("u1")).toBe("computed:u1");
          if (cachedTarget) {
            environment.commitUpdate((raw) => {
              raw.create("target", "User");
            });
            expect(read("target")).toBe("computed:target");
          }
          environment.commitUpdate((raw) => {
            store.proxy(raw, (view) => {
              const source = view.get("User", "u1")!;
              if (mode === "copy") view.copy(source, "target");
              else {
                if (!cachedTarget) raw.create("target", "User");
                view.get("User", "target")!.$.copyFrom(source);
              }
            });
          });
          expect(read("target")).toBe("computed:target");
          expect(read("u1")).toBe("computed:u1");
          expect(evaluations.get("u1")).toBe(1);
          expect(evaluations.get("target")).toBe(1);
        });
      }
    }
  }
  it("excludes dangling resolver variants using metadata while keeping ordinary fields", () => {
    const api = createStoreAPI({
      query: "Query",
      types: {
        Query: { concrete: true, possibleTypes: ["Query"], fields: {} },
        Item: {
          concrete: true,
          possibleTypes: ["Item"],
          fields: {},
          resolverFields: ["computedLabel"],
        },
      },
    });
    const environment = seed();
    environment.commitUpdate((raw) => {
      const source = raw.create("source", "Item");
      source.setLinkedRecord(raw.create("cache", "__RELAY_RESOLVER__"), "computedLabel", {
        format: "short",
      });
      source.setValue("retained", "label");
      source.setLinkedRecord(raw.get("u1")!, "ordinaryLink");
      raw.delete("cache");
      api.proxy(raw, (view) => view.copy(view.get("Item", "source")!, "target"));
      expect(
        raw.get("target")!.getLinkedRecord("computedLabel", { format: "short" }),
      ).toBeUndefined();
      expect(raw.get("target")!.getValue("label")).toBe("retained");
      expect(raw.get("target")!.getLinkedRecord("ordinaryLink")!.getDataID()).toBe("u1");
    });
  });
});
