import { graphql } from "relay-runtime";

export const mutation = graphql`
  mutation PayloadFixtureMutation($input: String!) {
    result: updateValue(input: $input) {
      ...PayloadFixture_payload
    }
    updateValues {
      details {
        label
      }
    }
  }
`;
export const subscription = graphql`
  subscription PayloadFixtureSubscription {
    valueChanged {
      ...PayloadFixture_payload
    }
  }
`;
export const fragment = graphql`
  fragment PayloadFixture_payload on Payload {
    details {
      label
    }
  }
`;
