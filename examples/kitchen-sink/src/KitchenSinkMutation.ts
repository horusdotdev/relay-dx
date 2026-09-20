import { graphql } from "relay-runtime";

export const KitchenSinkMutation = graphql`
  mutation KitchenSinkMutation($input: UpdatePostInput!) {
    updatePost(input: $input) {
      post {
        id
        title
        status
      }
      errors
    }
  }
`;
