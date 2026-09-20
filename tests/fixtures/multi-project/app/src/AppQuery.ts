import { graphql } from "relay-runtime";

export const AppQuery = graphql`
  query AppQuery {
    sharedValue
    sharedClientValue
    appValue
    appClientValue
  }
`;
