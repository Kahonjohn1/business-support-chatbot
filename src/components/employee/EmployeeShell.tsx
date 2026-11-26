"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { EmployeeSidebar } from "./EmployeeSidebar";
import { EmployeeTopbar } from "./EmployeeTopbar";
import type { EmployeeRole } from "@/lib/employee/roles";

interface EmployeeShellProps {
  children: ReactNode;
  user: {
    name: string;
    email: string | null;
    role: EmployeeRole;
  };
}

export function EmployeeShell({ children, user }: EmployeeShellProps) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobileOpen = openPath === pathname;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-border lg:block">
        <EmployeeSidebar
          pathname={pathname}
          role={user.role}
          name={user.name}
          email={user.email}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={() => setOpenPath(null)}
            aria-label="Close navigation overlay"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(20rem,88vw)] border-r border-border shadow-xl">
            <EmployeeSidebar
              pathname={pathname}
              role={user.role}
              name={user.name}
              email={user.email}
              onNavigate={() => setOpenPath(null)}
              showClose
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <EmployeeTopbar onMenuOpen={() => setOpenPath(pathname)} />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1500px] space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
