// Pure decision logic for the message list, kept free of React so the
// hydration behaviour can be unit-tested directly.

export type MessageListView = "messages" | "empty" | "pending-hydration";

/**
 * Chooses what the message list should render.
 *
 * Before the client has hydrated, the server cannot know whether the visitor
 * has saved conversations (that lives in localStorage). Rendering the empty
 * state during that window would show "How can we help your business today?"
 * and then immediately swap to the restored conversation, producing a visible
 * flash. So an empty list stays in a neutral "pending-hydration" state until
 * the client takes over.
 */
export function resolveMessageListView(
  messageCount: number,
  isHydrated: boolean
): MessageListView {
  if (messageCount > 0) return "messages";
  return isHydrated ? "empty" : "pending-hydration";
}
