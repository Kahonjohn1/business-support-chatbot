"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during server rendering and the hydration pass, true once the client
 * owns the tree. UI whose content depends on localStorage (chat history, the
 * active conversation) uses this to avoid rendering a server-only placeholder
 * that is immediately replaced, which otherwise flashes on every load/refresh.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
