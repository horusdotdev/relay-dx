import {
  Environment,
  Network,
  RecordSource,
  Store,
  createOperationDescriptor,
} from "relay-runtime";
import query from "./__generated__/StoreFixtureQuery.graphql.ts";

export const draft = { status: "DRAFT" as const, nested: { term: "hello", limit: 5 } };
export const published = { status: "PUBLISHED" as const };
const author = { __typename: "User", id: "u1", name: "Ada" };
function connection(ids: string[]) {
  return {
    edges: ids.map((id) => ({
      cursor: `cursor:${id}`,
      node: { __typename: "Post", id, title: id, author },
    })),
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: "start",
      endCursor: "end",
    },
    totalCount: 99,
  };
}
/** In-memory compiler-normalized fixture; never fetches or persists data. */
export function seed() {
  const environment = new Environment({
    network: Network.create(() => {
      throw new Error("Unexpected fetch");
    }),
    store: new Store(new RecordSource()),
  });
  for (const [id, filter] of [
    ["g1", draft],
    ["g1", published],
    ["g2", draft],
  ] as const) {
    environment.commitPayload(createOperationDescriptor(query, { id, filter, scale: 2 }), {
      viewer: {
        ...author,
        avatar: "https://example.com/avatar",
        tags: ["one"],
        friend: { id: "u2", name: "Grace" },
        friends: [{ id: "u2", name: "Grace" }],
        posts: connection(["p1", "p2"]),
        archivedPosts: connection(["p1"]),
      },
      group: { id, feed: connection(["p1", "p2"]) },
      count: 42,
    });
  }
  return environment;
}
