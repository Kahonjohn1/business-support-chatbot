"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown, LogOut, X } from "lucide-react";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { getEmployeeNavGroups } from "@/lib/employee/navigation";
import { roleLabels, type EmployeeRole } from "@/lib/employee/roles";
import { Avatar } from "./Avatar";

interface EmployeeSidebarProps {
  pathname: string;
  role: EmployeeRole;
  name: string;
  email: string | null;
  onNavigate?: () => void;
  showClose?: boolean;
}

export function EmployeeSidebar({
  pathname,
  role,
  name,
  email,
  onNavigate,
  showClose = false,
}: EmployeeSidebarProps) {
  const groups = getEmployeeNavGroups(role);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <Link href="/dashboard" onClick={onNavigate} className="flex min-w-0 flex-col gap-1">
          <MarqueLogo width={132} height={54} priority className="max-h-9 w-auto" />
        </Link>
        {showClose ? (
          <button
            type="button"
            onClick={onNavigate}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="Employee navigation">
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                          isActive
                            ? "bg-selected-teal font-semibold text-brand-teal dark:bg-[#102A2E] dark:text-[#8FE0E8]"
                            : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <Icon
                          className={`h-4.5 w-4.5 shrink-0 ${
                            isActive
                              ? "text-action-teal dark:text-[#7FD9E2]"
                              : "text-muted-foreground group-hover:text-foreground"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {isActive ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-action-teal dark:bg-[#7FD9E2]" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-border px-3 py-3">
        <details className="group rounded-xl border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <Avatar name={name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-foreground">{name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {email ?? "No email on account"}
              </span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Role: <span className="font-medium text-foreground">{roleLabels[role]}</span>
              </span>
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-1 border-t border-border px-2 py-2">
            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground opacity-70"
            >
              Account settings
              <span className="text-[10px]">Pending</span>
            </button>
            <Link
              href="/"
              onClick={onNavigate}
              className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-action-teal transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-[#7FD9E2]"
            >
              Public support site
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
