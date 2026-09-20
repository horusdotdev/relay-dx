import { graphql } from "relay-runtime";

export const BaseQuery = graphql`
  query BaseQuery {
    sharedValue
    sharedClientValue
  }
`;
