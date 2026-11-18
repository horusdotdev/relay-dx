import type { IEnvironment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";

export function checkHelpers(environment: IEnvironment): void {
  const id: string = store.connectionID("client:root", "Root_items", { status: "ACTIVE" });
  void id;
  store.read(environment, (view) => {
    view.getAll("User")[0]?.name.get();
    view.getAll("Node")[0]?.$.as("User")?.name.get();
    view.getAll("RecordItem")[0]?.$.as("Post")?.title.get();
    // @ts-expect-error Scans only accept generated schema types.
    view.getAll("Missing");
    // @ts-expect-error Records from read callbacks cannot be written.
    view.getAll("User")[0]?.name.set("name");
    // @ts-expect-error Abstract handles must be refined to access concrete fields.
    view.getAll("Node")[0]?.name.get();
    const ids: readonly string[] = view.ids();
    void ids;
    const record = view.get("User", "u1")!;
    const label: string | null | undefined = record.$.field("name").get();
    void label;
    // @ts-expect-error Dynamic fields still require a valid schema field name.
    record.$.field("missing");
    // @ts-expect-error Read callbacks cannot copy records.
    view.copy(record, "copy");
    // @ts-expect-error Read callbacks cannot merge fields.
    record.$.copyFrom(record);
    // @ts-expect-error Read callbacks cannot read operation payloads.
    view.getRootField("Mutation", "updateValue");
    // @ts-expect-error Read callbacks cannot link connections.
    record.posts.linkConnection(
      "StoreFixture_posts",
      record.posts.connection("StoreFixture_posts")!,
    );
  });
  store.updater((view) => {
    view.getAll("User")[0]?.name.set("name");
    view.getAll("Node")[0]?.$.as("User")?.name.set("name");
    view.getRootField("Mutation", "updateValue")?.details.get()?.label.set("label");
    view.getRootField("Mutation", "updateValues")?.[0]?.details.get();
    view.getRootField("Subscription", "valueChanged")?.details.get();
    // @ts-expect-error The root must be a generated operation root.
    view.getRootField("User", "friend");
    // @ts-expect-error The field must belong to this operation root.
    view.getRootField("Mutation", "valueChanged");
    const source = view.get("Node", "id")!;
    const copy = view.copy(source, "copy");
    copy.$.as("Post")?.title.set("title");
    const user = view.get("User", "u1")!;
    user.$.copyFrom(view.copy(user, "copy"));
    // @ts-expect-error Different concrete types cannot be merged.
    user.$.copyFrom(view.get("Post", "p1")!);
    user.$.field("name").set("name");
    const connection = user.posts.connection("StoreFixture_posts")!;
    user.posts.linkConnection("StoreFixture_posts", connection, { filter: { status: "DRAFT" } });
    // @ts-expect-error Connection keys are checked.
    user.posts.linkConnection("Missing_posts", connection);
    // @ts-expect-error Pagination arguments are not filters.
    user.posts.linkConnection("StoreFixture_posts", connection, { first: 1 });
  });
}
