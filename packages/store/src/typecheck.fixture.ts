// Compiled by the workspace's tsc --noEmit; these functions are never executed.
import type { Environment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";
import { store as kitchenStore } from "../examples/__generated__/store.js";
export function checkStoreTypes(environment: Environment): void {
  store.read(environment, (view) => {
    const user = view.get("User", "id")!;
    const name: string | null | undefined = user.name.get();
    void name;
    // @ts-expect-error A normalized store is not guaranteed complete.
    const complete: string = user.name.get();
    void complete;
    // @ts-expect-error Environment reads do not expose writes.
    user.name.set("No");
    // @ts-expect-error Accessors cannot be replaced with scalar values.
    user.name = "No";
    // @ts-expect-error Environment reads do not expose creation.
    view.create("User", "new");
    // @ts-expect-error Schema field names are checked.
    user.naem.get();
    user.friend.get()?.name.get();
    // @ts-expect-error Read-only linked records do not expose writes.
    user.friend.get()?.name.set("No");
    // @ts-expect-error Required field arguments cannot be omitted.
    view.getRoot().count.get();
    // @ts-expect-error Nested input fields are typed.
    view.getRoot().count.get({ input: { nested: { limit: "five" } } });
    // @ts-expect-error No-argument fields do not accept arbitrary arguments.
    user.name.get({ typo: true });
    // @ts-expect-error Scalar accessors have no connection operations.
    user.name.connections();
    // @ts-expect-error Outside-updater connection access has no removal method.
    user.posts.connections().removeNodes(["id"]);
    // @ts-expect-error Refinements must be possible concrete types.
    view.get("Node", "id")!.$.as("PageInfo");
  });
  // @ts-expect-error Async callbacks can outlive their access scope.
  void store.read(environment, async () => {});
  // @ts-expect-error Async updater callbacks also outlive their scope.
  store.updater(environment, async () => {});
  store.updater(environment, (view) => {
    const user = view.get("User", "id")!;
    const post = view.create("Post", "post");
    user.name.set("Yes");
    user.friend.set(user);
    post.author.set(user);
    post.author.require().name.set("Typed linked write");
    user.friend.set(null);
    // @ts-expect-error Schema scalar values are checked.
    user.name.set(123);
    // @ts-expect-error Non-null scalar writes cannot be null.
    user.name.set(null);
    // @ts-expect-error Unmapped custom scalars are not writable.
    user.opaque.set("unknown");
    // @ts-expect-error Linked record types are checked.
    user.friend.set(post);
    // @ts-expect-error Non-null links cannot be cleared.
    post.author.set(null);
    // @ts-expect-error Non-null list elements cannot be null.
    user.friends.set([null]);
    // @ts-expect-error Plural links do not expose connection operations.
    user.friends.connections();
    // @ts-expect-error Abstract types cannot be instantiated.
    view.create("Node", "abstract");
    // @ts-expect-error All-parent scans must be explicitly requested.
    view.connections("Group", "items", {});
    // @ts-expect-error Ordinary links are not connections.
    user.friend.connections();
    const connection = user.posts.connections().get("Key_posts")!;
    connection.insertEdgeAfter(connection.createEdge(post));
    // @ts-expect-error Filter values are typed from schema arguments.
    user.posts.connections().get("Key_posts", { filter: { status: "NOT_A_STATUS" } });
    // @ts-expect-error Pagination arguments do not identify connection variants.
    user.posts.connections().get("Key_posts", { first: 5 });
    // @ts-expect-error Connection node types are checked.
    connection.createEdge(user);
    // @ts-expect-error Connection edge types are checked.
    connection.insertEdgeAfter(user);
  });
  kitchenStore.updater(environment, (view) => {
    const user = view.get("User", "id")!;
    user.avatar.set("https://example.com");
    user.clientLabel.set("Local");
    user.name.set("Ada");
    // @ts-expect-error Direct field accessors preserve scalar value types.
    user.name.set(123);
    // @ts-expect-error Computed resolvers are not writable stored fields.
    user.displayName.set("No");
    // @ts-expect-error Resolver reads require RelayReader, not raw store access.
    user.displayName.get();
    // @ts-expect-error Resolver model objects are excluded.
    view.create("ClientDashboard", "model");
    // @ts-expect-error Internal fields are excluded.
    user.__id.get();
  });
}
