import { graphql } from "relay-runtime";

export const KitchenSinkQuery = graphql`
  query KitchenSinkQuery(
    $id: ID!
    $first: Int
    $after: String
    $filter: PostFilter
    $prefix: String!
  ) {
    viewer {
      id
      name
      role
      email
      isCurrentUser
      clientLabel
      greeting(prefix: $prefix)
      displayName
      profileCard {
        headline
        imageUrl
      }
      posts(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            status
            publishedAt
            author {
              id
              name
            }
            tags
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    node(id: $id) {
      id
      __typename
      ... on User {
        name
      }
      ... on Post {
        title
      }
    }
    search(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          __typename
          ... on User {
            id
            name
          }
          ... on Post {
            id
            title
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    stats {
      postCount
      unreadCount
    }
    dashboard {
      title
    }
    modernGreeting
    tick
  }
`;
