"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/chat/ThemeToggle";
import { roleLabels, type EmployeeRole } from "@/lib/employee/roles";
import { Avatar } from "./Avatar";

interface EmployeeTopbarProps {
  onMenuOpen: () => void;
  user: {
    name: string;
    email: string | null;
    role: EmployeeRole;
  };
}

export function EmployeeTopbar({ onMenuOpen, user }: EmployeeTopbarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

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

        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface py-1 pl-1 pr-2 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <Avatar name={user.name} size="sm" />
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-semibold text-foreground">{user.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {roleLabels[user.role]}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>

          {profileOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg"
            >
              <div className="rounded-lg bg-background px-3 py-2.5">
                <p className="text-xs font-semibold text-foreground">{user.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {user.email ?? "No email on account"}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Role: <span className="font-medium text-foreground">{roleLabels[user.role]}</span>
                </p>
              </div>
              <button
                type="button"
                disabled
                className="mt-1 flex w-full cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground opacity-70"
              >
                Account settings
                <span className="text-[10px]">Pending</span>
              </button>
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
