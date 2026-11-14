import { graphql } from "relay-runtime";

export const record = graphql`
  fragment CreationFixture_record on CreationFixture
  @throwOnFieldError
  @argumentDefinitions(enabled: { type: "Boolean!", defaultValue: true }) {
    id
    title
    semantic
    items
    strictItems
    nested
    optional
    conditional @include(if: $enabled)
    requiredLabel @required(action: LOG)
    argumented(locale: "en")
  }
`;
