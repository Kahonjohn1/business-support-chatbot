export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "business-support-chatbot:theme";

/**
 * Blocking script that applies the persisted (or system) theme before the page
 * paints. It runs as the first element in <body>, so the correct theme is set
 * before the chat UI renders and no wrong-theme flash is shown.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var stored = window.localStorage.getItem(key);
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  } catch (error) {}
})();
`;

// In-memory snapshot so useSyncExternalStore receives a stable value.
let currentTheme: Theme | null = null;
const listeners = new Set<() => void>();

function readThemeFromDom(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function getThemeSnapshot(): Theme {
  if (currentTheme === null) {
    currentTheme = readThemeFromDom();
  }
  return currentTheme;
}

// The server cannot know the client theme, so it renders the default and lets
// useSyncExternalStore reconcile to the real value after hydration.
export function getThemeServerSnapshot(): Theme {
  return "light";
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitThemeChange(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Applies a theme to the document and notifies subscribers. When `persist` is
 * true the choice is written to localStorage so it survives a refresh.
 */
export function applyTheme(theme: Theme, persist: boolean): void {
  currentTheme = theme;

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }

  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore unavailable storage (private mode, quota exceeded, etc.).
    }
  }

  emitThemeChange();
}
