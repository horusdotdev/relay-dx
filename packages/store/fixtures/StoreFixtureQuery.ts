import { graphql } from "relay-runtime";

export const query = graphql`
  query StoreFixtureQuery($id: ID!, $filter: Filter!, $scale: Int = 2) {
    viewer {
      id
      name
      avatar
      tags
      friend {
        id
        name
      }
      friends {
        id
        name
      }
      posts(first: 10, filter: $filter) @connection(key: "StoreFixture_posts") {
        edges {
          cursor
          node {
            id
            title
            author {
              id
              name
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
      archivedPosts(first: 10, filter: $filter) @connection(key: "StoreFixture_archivedPosts") {
        edges {
          cursor
          node {
            id
            title
            author {
              id
              name
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
    }
    group(id: $id) {
      id
      feed: items(first: 10, filter: $filter) @connection(key: "StoreFixture_feed") {
        edges {
          cursor
          node {
            id
            title
            author {
              id
              name
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
    }
    count(input: $filter, scale: $scale)
  }
`;
