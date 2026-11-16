import type { IEnvironment, RecordSourceProxy } from "relay-runtime";
import { store } from "../fixtures/__generated__/adoption.js";

/** Compiled by tsc; invalid calls are never executed. */
export function checkAdoptionTypes(environment: IEnvironment, raw: RecordSourceProxy): void {
  const rename = store.updater<{ title: string }>((view, payload) => {
    view.get("Recording", "recording:1")!.title.set(payload!.title);
  });
  rename(raw, { title: "Sonata" });
  store.proxy(raw, (view) => {
    const studio = view.get("Studio", "studio:1")!;
    const recording = view.get("Recording", "recording:1")!;
    recording.$.invalidate();
    view.invalidateStore();
    recording.availability.set("%future added value");
    // @ts-expect-error Arbitrary unknown enum values are still rejected.
    recording.availability.set("ARCHIVED");
    // @ts-expect-error Strict creation retains its completeness check.
    view.upsert("Recording", { id: "recording:partial", title: "No duration" });
    // @ts-expect-error Abstract upsert reports the possible concrete types.
    view.upsert("Media", { id: "media:1" });
    // @ts-expect-error Creation still rejects unknown fields on variables.
    view.upsert("Episode", { id: "episode:1", title: "Overture", missing: true });
    studio.recordings
      .createConnection("Library_recordings", { genre: "classical" })
      .appendNode(recording);
    // @ts-expect-error Connection creation checks declared keys.
    studio.recordings.createConnection("Other_recordings");
    // @ts-expect-error Connection creation accepts filters, not pagination arguments.
    studio.recordings.createConnection("Library_recordings", { first: 8 });
    for (const variant of studio.takes.variants()) {
      variant.set([recording]);
      // @ts-expect-error Field variants preserve their linked record type.
      variant.set([studio]);
    }
    for (const variant of studio.label.variants()) {
      variant.set("Session");
      // @ts-expect-error Field variants preserve scalar types.
      variant.set(5);
    }
    view.get("Media", "media:1")!.$.setType("Episode").title.set("Podcast");
    // @ts-expect-error A refinement must be a possible concrete member.
    view.get("Media", "media:1")!.$.setType("Studio");
  });
  store.read(environment, (view) => {
    const recording = view.get("Recording", "recording:1")!;
    // @ts-expect-error Record invalidation requires an updater.
    recording.$.invalidate();
    // @ts-expect-error Changing the typename requires an updater.
    view.get("Media", "media:1")!.$.setType("Episode");
    // @ts-expect-error Store invalidation requires an updater.
    view.invalidateStore();
    const studio = view.get("Studio", "studio:1")!;
    // @ts-expect-error Connection creation requires an updater.
    studio.recordings.createConnection("Library_recordings");
    // @ts-expect-error Read-only variants have no setter.
    studio.takes.variants()[0].set([]);
  });
  // @ts-expect-error Proxy-only callbacks retain the synchronous lifetime check.
  store.updater(async () => {});
  // @ts-expect-error Proxy-only callbacks retain the synchronous lifetime check.
  store.proxy(raw, async () => {});
}
