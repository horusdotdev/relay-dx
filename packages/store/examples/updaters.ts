import type { Environment } from "relay-runtime";
import { store } from "./__generated__/store.js";
export function renameViewer(environment: Environment, name: string): void {
  environment.commitUpdate(
    store.updater(environment, (view) => {
      view.getRoot().viewer.require().name.set(name);
    }),
  );
}
export function readViewerName(environment: Environment): string | null | undefined {
  return store.read(environment, (view) => view.getRoot().viewer.get()?.name.get());
}
export function removePostsForUser(
  environment: Environment,
  userID: string,
  postIDs: readonly string[],
): void {
  environment.commitUpdate(
    store.updater(environment, (view) => {
      view.get("User", userID)?.posts.connections().removeNodes(postIDs);
    }),
  );
}
export function removePostsForAllUsers(environment: Environment, postIDs: readonly string[]): void {
  environment.commitUpdate(
    store.updater(environment, (view) => {
      view.connections("User", "posts", { parents: "all" }).removeNodes(postIDs);
    }),
  );
}
export function filterAndSortPosts(environment: Environment, userID: string, search: string): void {
  environment.commitUpdate(
    store.updater(environment, (view) => {
      view
        .get("User", userID)
        ?.posts.connections()
        .filter((post) => post.title.get()?.includes(search) === true)
        .sort((a, b) => (a.title.get() ?? "").localeCompare(b.title.get() ?? ""));
    }),
  );
}
