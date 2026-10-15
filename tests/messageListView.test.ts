import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveMessageListView } from "../src/lib/messageListView.ts";

test("renders messages whenever the conversation has messages", () => {
  assert.equal(resolveMessageListView(1, true), "messages");
  assert.equal(resolveMessageListView(5, true), "messages");
  assert.equal(resolveMessageListView(5, false), "messages");
});

test("does not show the empty state before the client has hydrated", () => {
  // Regression: the server cannot read localStorage, so it must not render the
  // empty state on the first paint, which otherwise flashes before the restored
  // conversation appears.
  assert.equal(resolveMessageListView(0, false), "pending-hydration");
});

test("shows the empty state once hydrated with an empty conversation", () => {
  assert.equal(resolveMessageListView(0, true), "empty");
});
