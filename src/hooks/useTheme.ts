"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeToTheme,
  type Theme,
} from "@/lib/theme";

interface UseThemeResult {
  theme: Theme;
  isDark: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Reads and mutates the document's light/dark theme. Uses useSyncExternalStore
 * so the value is stable during hydration (server renders "light" and the
 * client reconciles to the real theme without a hydration mismatch).
 */
export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next, true);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(getThemeSnapshot() === "dark" ? "light" : "dark", true);
  }, []);

  return { theme, isDark: theme === "dark", setTheme, toggleTheme };
}
