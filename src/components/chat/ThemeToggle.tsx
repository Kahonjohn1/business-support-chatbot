"use client";

import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
      className={`relative inline-flex items-center w-14 h-8 shrink-0 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        isDark
          ? "bg-primary border-primary/60"
          : "bg-muted border-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center w-6 h-6 ml-1 rounded-full bg-switch-thumb shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
          isDark ? "translate-x-6" : "translate-x-0"
        }`}
      >
        {isDark ? (
          <Moon className="w-3.5 h-3.5 text-primary" />
        ) : (
          <Sun className="w-3.5 h-3.5 text-primary" />
        )}
      </span>
    </button>
  );
};
