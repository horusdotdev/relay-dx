import { graphql } from "relay-runtime";

export const query = graphql`
  query TypeRefinementFixtureQuery($id: ID!) {
    node(id: $id) {
      __typename
      ...TypeRefinementFixture_node
    }
  }
`;
export const fragment = graphql`
  fragment TypeRefinementFixture_node on Node {
    id
  }
`;
