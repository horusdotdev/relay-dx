import { graphql } from "relay-runtime";

export const aliased = graphql`
  fragment ConnectionKeysFixture_user on User {
    other: posts(first: 5) @connection(key: "ConnectionKeysFixture_other") {
      edges {
        node {
          id
        }
      }
    }
  }
`;

export const abstract = graphql`
  fragment ConnectionKeysFixture_hasPosts on HasPosts {
    posts(first: 5) @connection(key: "ConnectionKeysFixture_posts") {
      edges {
        node {
          id
        }
      }
    }
  }
`;
