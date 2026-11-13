import { seed } from "../fixtures/environment.ts";
import { store } from "../fixtures/__generated__/store.ts";
const environment = seed();
function snapshot() {
  return store.read(environment, (view) => ({
    name: view.get("User", "u1")!.name.get(),
    groups: ["g1", "g2"].map((id) => ({
      id,
      connections: view
        .get("Group", id)!
        .items.connections()
        .variants()
        .map(({ record }) => ({
          id: record.$.getDataID(),
          nodes: record.edges.get()?.map((edge) => edge?.node.get()?.$.getDataID()),
          totalCount: record.totalCount.get(),
        })),
    })),
    removedNodeStillExists: Boolean(view.get("Post", "p1")),
  }));
}
process.stdout.write(`Before\n${JSON.stringify(snapshot(), null, 2)}\n`);
environment.commitUpdate(
  store.updater(environment, (view) => {
    view.get("User", "u1")!.name.set("Updated through typed store");
    // Removes p1 from both g1 filter variants, leaving g2 and node p1 intact.
    view.get("Group", "g1")!.items.connections().removeNodes(["p1"]);
  }),
);
process.stdout.write(`After\n${JSON.stringify(snapshot(), null, 2)}\n`);
