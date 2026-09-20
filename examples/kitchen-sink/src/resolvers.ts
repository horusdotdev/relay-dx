import type { DataID, LiveState } from "relay-runtime";
import { graphql, readFragment } from "relay-runtime";
import type { UserCurrentUserFragment$key } from "./__generated__/UserCurrentUserFragment.graphql.js";
import type { UserDisplayNameFragment$key } from "./__generated__/UserDisplayNameFragment.graphql.js";
import type { UserProfileCardFragment$key } from "./__generated__/UserProfileCardFragment.graphql.js";

type DashboardModel = {
  id: DataID;
  title: string;
};

/**
 * A strong client model. Relay uses the returned ID to memoize the model.
 *
 * @RelayResolver ClientDashboard
 */
export function ClientDashboard(id: DataID): DashboardModel {
  return { id, title: "Kitchen sink dashboard" };
}

/**
 * @RelayResolver ClientDashboard.title: String
 */
export function dashboardTitle(model: DashboardModel): string {
  return model.title;
}

/**
 * @RelayResolver Query.dashboard: ClientDashboard
 */
export function dashboard(): { id: DataID } {
  return { id: "client-dashboard" };
}

/**
 * A weak client model has no global ID and is returned as a complete object.
 *
 * @RelayResolver ProfileCard
 * @weak
 */
export type ProfileCard = {
  headline: string;
  imageUrl: string;
};

/**
 * @RelayResolver ProfileCard.headline: String
 */
export function profileCardHeadline(card: ProfileCard): string {
  return card.headline;
}

/**
 * @RelayResolver ProfileCard.imageUrl: String
 */
export function profileCardImageUrl(card: ProfileCard): string {
  return card.imageUrl;
}

/**
 * @RelayResolver User.profileCard: ProfileCard
 * @rootFragment UserProfileCardFragment
 */
export function profileCard(key: UserProfileCardFragment$key): ProfileCard {
  const user = readFragment(
    graphql`
      fragment UserProfileCardFragment on User {
        name
        avatar
      }
    `,
    key,
  );
  return {
    headline: user.name,
    imageUrl: user.avatar ?? "https://cdn.example.test/default.png",
  };
}

/**
 * @RelayResolver User.isCurrentUser: Boolean
 * @rootFragment UserCurrentUserFragment
 */
export function isCurrentUser(key: UserCurrentUserFragment$key): boolean {
  const user = readFragment(
    graphql`
      fragment UserCurrentUserFragment on User {
        id
      }
    `,
    key,
  );
  return user.id === "user-1";
}

/**
 * @RelayResolver User.greeting(prefix: String!): String
 */
export function greeting(args: { prefix: string }): string {
  return `${args.prefix}, Relay user`;
}

/**
 * A derived resolver reads a root fragment and is reevaluated when its data
 * changes.
 *
 * @RelayResolver User.displayName: String
 * @rootFragment UserDisplayNameFragment
 */
export function displayName(key: UserDisplayNameFragment$key): string {
  const user = readFragment(
    graphql`
      fragment UserDisplayNameFragment on User {
        name
        role
      }
    `,
    key,
  );
  return `${user.name} (${user.role})`;
}

/**
 * @RelayResolver Query.tick: Int
 * @live
 */
export function tick(): LiveState<number> {
  return {
    read: () => Math.floor(Date.now() / 1000) % 1_000_000,
    subscribe: () => () => {},
  };
}

/**
 * The v21 resolver syntax uses the field-specific @relayField tag. This is
 * the modern equivalent of the legacy @RelayResolver field form.
 *
 * @relayField Query.modernGreeting: String
 */
export function modernGreeting(): string {
  return "Hello from the modern resolver syntax";
}
