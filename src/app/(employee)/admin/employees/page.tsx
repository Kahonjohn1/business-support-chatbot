import type { Metadata } from "next";
import { ShieldCheck, UserCog, Users } from "lucide-react";
import { AvatarWithName } from "@/components/employee/Avatar";
import { InviteEmployeeForm } from "@/components/employee/InviteEmployeeForm";
import { PageHeader } from "@/components/employee/PageHeader";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requirePermission } from "@/lib/employee/access";
import {
  employeeStatusTone,
  getEmployeeDirectory,
} from "@/lib/employee/employeeData";

export const metadata: Metadata = {
  title: "Employee administration",
};

export default async function EmployeesAdminPage() {
  const session = await requirePermission("employees:invite");
  const directory = await getEmployeeDirectory(session);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Employees"
        description="Invite employees, assign access roles, and review live employee profiles."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Directory records</p>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(directory.entries.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Profiles in employee_profiles
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Active profiles</p>
            <ShieldCheck className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(directory.activeCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {directory.suspendedCount} suspended
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Invitation provider</p>
            <UserCog className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-lg font-semibold text-foreground">Supabase Auth</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Administrator-only invitations
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <InviteEmployeeForm />

        <SectionCard
          title="Employee directory"
          description="Live profiles and authentication details available to administrators."
          bodyClassName="p-3 sm:p-4"
        >
          <div className="space-y-3">
            {directory.entries.map((entry) => (
              <article
                key={entry.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <AvatarWithName
                  name={entry.name}
                  meta={entry.email ?? "Email not available"}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
                    {entry.roleLabel}
                  </span>
                  <StatusBadge tone={employeeStatusTone(entry.status)}>
                    {entry.statusLabel}
                  </StatusBadge>
                  <span className="text-[11px] text-muted-foreground">
                    Added {entry.createdLabel}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Updated {entry.updatedLabel}
                  </span>
                  {directory.includesAuthDetails ? (
                    <span className="text-[11px] text-muted-foreground">
                      Last sign-in {entry.lastSignInLabel}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
            {directory.entries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No employee profiles are available.
              </p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
