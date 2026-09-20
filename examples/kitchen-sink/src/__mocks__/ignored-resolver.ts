/**
 * This resolver is intentionally excluded by Relay's default `__mocks__`
 * source exclusion. It must not appear in the effective schema.
 *
 * @relayField Query.shouldNotAppear: String
 */
export function shouldNotAppear(): string {
  return "excluded";
}
