import type { IEnvironment } from "relay-runtime";
import { store as kitchenStore } from "../examples/__generated__/store.js";
import { store as adoptionStore } from "../fixtures/__generated__/adoption.js";
import { store } from "../fixtures/__generated__/store.js";

export function checkHelpers(environment: IEnvironment): void {
  const id: string = store.connectionID("client:root", "Root_items", { status: "ACTIVE" });
  void id;
  kitchenStore.connectionID("Query", "client:root", "KitchenSinkQuery_search");
  // @ts-expect-error Query roots use the same checked form as other types.
  kitchenStore.connectionID("Query", "client:root", "Missing_search");
  store.connectionID("User", "u1", "StoreFixture_posts", { filter: { status: "DRAFT" } });
  store.connectionID("HasPosts", "u1", "ConnectionKeysFixture_posts");
  // @ts-expect-error A typed connection key must belong to this parent type.
  store.connectionID("User", "u1", "StoreFixture_feed");
  // @ts-expect-error Unknown connection keys cannot use the typed form.
  store.connectionID("User", "u1", "Missing_posts");
  // @ts-expect-error Typed filters exclude pagination arguments.
  store.connectionID("User", "u1", "StoreFixture_posts", { first: 1 });
  // @ts-expect-error Filter input values are schema checked.
  store.connectionID("User", "u1", "StoreFixture_posts", { filter: { status: "INVALID" } });
  // @ts-expect-error A key cannot borrow filters from another field.
  store.connectionID("User", "u1", "StoreFixture_posts", { genre: "A" });
  // @ts-expect-error Unknown parent types cannot use the typed form.
  store.connectionID("Missing", "id", "StoreFixture_posts");
  // @ts-expect-error Nonconnection fields do not provide connection keys.
  store.connectionID("Post", "id", "StoreFixture_posts");
  adoptionStore.read(environment, (view) => {
    const item = view.get("Media", "id")!.$.concrete();
    item.title.get();
    const value: string | number | null | undefined = item.commonValue.get();
    void value;
    // @ts-expect-error Concrete unions still preserve read-only permissions.
    item.title.set("title");
    // @ts-expect-error A field present on only one member requires refinement.
    item.availability.get();
  });
  adoptionStore.updater((view) => {
    const record = view.get("Media", "id")!.$.concrete();
    record.title.set("title");
    // @ts-expect-error Conflicting member write types cannot be combined into a union write.
    record.commonValue.set("text");
    // @ts-expect-error Conflicting member write types cannot be combined into a union write.
    record.commonValue.set(1);
    record.commonValue.set(null);
  });
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
    const refinement: boolean | undefined = view.getTypeRefinement("User", "Node");
    void refinement;
    view.getTypeRefinement("User", "RecordItem");
    // @ts-expect-error First argument must be concrete.
    view.getTypeRefinement("Node", "Node");
    // @ts-expect-error Second argument must be abstract.
    view.getTypeRefinement("User", "User");
    // @ts-expect-error Abstract type names are schema checked.
    view.getTypeRefinement("User", "Missing");
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
