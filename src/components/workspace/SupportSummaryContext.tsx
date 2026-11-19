"use client";

import { createContext, useContext } from "react";

const SupportSummaryContext = createContext<(summary: string) => void>(() => {});

export const SupportSummaryProvider = SupportSummaryContext.Provider;

export function useSupportSummaryReporter() {
  return useContext(SupportSummaryContext);
}
