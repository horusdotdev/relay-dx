// Compiled by the workspace's tsc --noEmit; these functions are never executed.
import type { IEnvironment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";
import { store as kitchenStore } from "../examples/__generated__/store.js";
export function checkStoreTypes(environment: IEnvironment): void {
  const createClientID: `client:Post:${string}` = store.createClientID("Post");
  void createClientID;
  // @ts-expect-error Client IDs must name a concrete generated type.
  store.createClientID("Node");
  // @ts-expect-error Unknown types cannot be used for client IDs.
  store.createClientID("Missing");
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
    view.upsert("User", { id: "new", name: "Initial", friends: [], tags: [] });
    // @ts-expect-error Deletion, including pruning, requires an updater.
    view.delete("Post", "post", { prune: true });
    // @ts-expect-error List insertion requires an updater.
    user.friends.append(user);
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
    const connection = user.posts.connection("StoreFixture_posts");
    connection?.nodes().map((node) => node.title.get());
    // @ts-expect-error Sorting cached edges requires an updater.
    connection?.sort((a, b) => a.title.require().localeCompare(b.title.require()));
    // @ts-expect-error Connection node insertion requires an updater.
    connection?.appendNode(view.get("Post", "id")!);
    // @ts-expect-error Filtering cached edges requires an updater.
    user.posts.connections("StoreFixture_posts").filter(() => true);
    // @ts-expect-error Nodes read outside an updater cannot be written.
    connection?.nodes()[0]?.title.set("No");
    // @ts-expect-error Refinements must be possible concrete types.
    view.get("Node", "id")!.$.as("PageInfo");
    // @ts-expect-error Refinement accepts concrete members, not an implemented interface.
    view.get("Post", "id")!.$.as("Node");
    // @ts-expect-error A concrete Post cannot be refined to User.
    view.get("Post", "id")!.$.as("User");
  });
  // @ts-expect-error Async callbacks can outlive their access scope.
  void store.read(environment, async () => {});
  // @ts-expect-error Async updater callbacks also outlive their scope.
  store.updater(environment, async () => {});
  store.updater(environment, (view) => {
    const user = view.get("User", "id")!;
    const post = view.upsert("Post", {
      id: "post",
      title: "Initial",
      author: view.get("User", "u1")!,
    });
    user.friends.append(user);
    user.friends.prepend(user);
    view.getRoot().recentNodes.append(post, { limit: 5 });
    view.getRoot().requiredNodes.prepend(post, { input: { status: "DRAFT" } });
    // @ts-expect-error List insertions check record types.
    user.friends.append(post);
    // @ts-expect-error Required list arguments must be provided.
    view.getRoot().requiredNodes.append(post);
    // @ts-expect-error List arguments retain their schema types.
    view.getRoot().recentNodes.append(post, { limit: "five" });
    // @ts-expect-error Scalar lists do not accept linked record operations.
    user.tags.append(user);
    // @ts-expect-error Singular links do not accept list operations.
    user.friend.append(user);
    view.delete("Post", "other-post", { prune: true });
    view.delete("Node", "other-node", { prune: false });
    // @ts-expect-error Pruning is a boolean option.
    view.delete("Post", "other-post", { prune: "true" });
    // @ts-expect-error The delete option is named prune.
    view.delete("Post", "other-post", { cleanup: true });
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
    view.upsert("Node", { id: "abstract" });
    // @ts-expect-error All-parent scans must be explicitly requested.
    view.connections("Group", "items", {});
    // @ts-expect-error Ordinary links are not connections.
    user.friend.connections();
    const connection = user.posts.connections().get("StoreFixture_posts")!;
    connection.insertEdgeAfter(connection.createEdge(post));
    connection.appendNode(post);
    connection.prependNode(post);
    // @ts-expect-error Node insertion checks connection node types.
    connection.prependNode(user);
    // @ts-expect-error Filter values are typed from schema arguments.
    user.posts.connections().get("StoreFixture_posts", { filter: { status: "NOT_A_STATUS" } });
    // @ts-expect-error Pagination arguments do not identify connection variants.
    user.posts.connections().get("StoreFixture_posts", { first: 5 });
    // @ts-expect-error Connection node types are checked.
    connection.createEdge(user);
    // @ts-expect-error Connection edge types are checked.
    connection.insertEdgeAfter(user);
    const posts = user.posts.connections("StoreFixture_posts");
    posts.appendNode(post);
    posts.prependNode(post);
    // @ts-expect-error Family insertion checks connection node types.
    posts.appendNode(user);
    const keys: readonly (
      | "StoreFixture_posts"
      | "ConnectionKeysFixture_other"
      | "ConnectionKeysFixture_posts"
    )[] = user.posts.keys();
    for (const key of keys) user.posts.connections(key).removeNodes([]);
    // @ts-expect-error Keys belong to their schema field, not another connection on the same type.
    user.posts.connections("StoreFixture_archivedPosts");
    // @ts-expect-error Misspelled connection keys are rejected.
    user.posts.connection("StoreFixture_post");
    // @ts-expect-error Family lookup uses the same generated key union.
    posts.get("StoreFixture_archivedPosts");
    // @ts-expect-error All-parent selection also checks keys against the selected field.
    view.connections("User", "posts", { parents: "all", key: "StoreFixture_archivedPosts" });
    // @ts-expect-error Generated key collections are read-only.
    user.posts.keys().push("StoreFixture_posts");
    const abstract = view.get("HasPosts", "id")!;
    for (const key of abstract.posts.keys()) abstract.posts.connections(key);
    // @ts-expect-error Connection selections accept a key string, not the old options object.
    user.posts.connections({ keys: ["StoreFixture_posts"] });
    // @ts-expect-error New connections are included with typed records, not candidate IDs.
    user.posts.connections({ candidateIDs: ["client:posts"] });
    // @ts-expect-error All-parent selection no longer accepts the old keys option.
    view.connections("User", "posts", { parents: "all", keys: ["StoreFixture_posts"] });
    posts
      .filter((node, edge) => node.title.get() === edge.cursor.get())
      .sort((a, b) => a.title.require().localeCompare(b.title.require()));
    posts.include(
      view.upsert("PostConnection", {
        id: "client:posts",
        edges: [],
        totalCount: 0,
        pageInfo: view.upsert("PageInfo", {
          id: "client:page",
          hasNextPage: false,
          hasPreviousPage: false,
        }),
      }),
    );
    // @ts-expect-error Include accepts connection records, not node IDs.
    posts.include("client:posts");
    // @ts-expect-error Include checks the connection record type.
    posts.include(user);
    // @ts-expect-error Filter callbacks return booleans.
    posts.filter((node) => node.title.get());
    // @ts-expect-error Sort callbacks return numbers.
    posts.sort((a, b) => a.title.get() === b.title.get());
    // @ts-expect-error Callbacks cannot escape the synchronous scope.
    posts.filter(async () => true);
    // @ts-expect-error Connection callbacks expose Post fields.
    posts.filter((node) => node.email.get() !== null);
    // @ts-expect-error Direct connection filters are checked from schema arguments.
    user.posts.connection("StoreFixture_posts", { filter: { status: "INVALID" } });
    // @ts-expect-error Pagination arguments do not identify connection variants.
    user.posts.connection("StoreFixture_posts", { first: 10 });
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
    view.upsert("ClientDashboard", { id: "model" });
    // @ts-expect-error Internal fields are excluded.
    user.__id.get();
    const result = view.get("SearchResult", "id")!;
    result.$.as("User")?.name.get();
    result.$.as("Post")?.title.get();
    // @ts-expect-error Unions expose fields through their concrete members.
    result.title.get();
    // @ts-expect-error Union refinement is restricted to its two concrete members.
    result.$.as("PageInfo");
    // @ts-expect-error Union refinement does not offer interface views.
    result.$.as("Node");
    view
      .getRoot()
      .search.connections("KitchenSinkQuery_search")
      .filter((node) => node.$.as("Post")?.status.get() === "PUBLISHED");
  });
}
