"use client";

import { Bell, Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/chat/ThemeToggle";

interface EmployeeTopbarProps {
  onMenuOpen: () => void;
}

export function EmployeeTopbar({ onMenuOpen }: EmployeeTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenuOpen}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4.5 w-4.5" aria-hidden="true" />
      </button>

      <div className="hidden min-w-0 lg:block">
        <p className="text-sm font-semibold text-foreground">Marque Technologies Workspace</p>
      </div>

      <div className="relative ml-auto hidden w-full max-w-md md:block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="Search employee workspace"
          placeholder="Search projects, tasks, people..."
          className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-16 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <ThemeToggle />
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Notifications, 3 preview alerts"
          title="Notifications"
        >
          <Bell className="h-4.5 w-4.5" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            3
          </span>
        </button>
      </div>
    </header>
  );
}
