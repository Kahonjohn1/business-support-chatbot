import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { AvatarWithName } from "@/components/employee/Avatar";
import { InviteEmployeeForm } from "@/components/employee/InviteEmployeeForm";
import { InviteMemberPanel } from "@/components/employee/InviteMemberPanel";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requireEmployee } from "@/lib/employee/access";
import {
  employeeStatusTone,
  getEmployeeDirectory,
} from "@/lib/employee/employeeData";
import { hasPermission } from "@/lib/employee/roles";

export const metadata: Metadata = {
  title: "Team",
};

export default async function TeamPage() {
  const session = await requireEmployee();
  const canInvite = hasPermission(session.user.role, "employees:invite");
  const directory = await getEmployeeDirectory(session);
  const rolesInUse = directory.roleCounts.filter((item) => item.value > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Team"
        description="Live employee directory and invitation workflow for the internal operations platform."
        actions={
          canInvite ? (
            <Link
              href="/admin/employees"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Invite member
            </Link>
          ) : (
            <PreviewButton icon={UserPlus}>Admin invitation only</PreviewButton>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Employees</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(directory.entries.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {directory.activeCount} active profiles
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Suspended</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(directory.suspendedCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Access blocked until reinstated
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Roles in use</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(rolesInUse).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Viewer through Admin
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard
          title="Employee directory"
          description="Profiles available from employee authentication records."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Added</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  {directory.includesAuthDetails ? (
                    <th className="px-4 py-3 font-semibold">Last sign-in</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {directory.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-3.5">
                      <AvatarWithName
                        name={entry.name}
                        meta={entry.email ?? "Email visible to administrators"}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone="violet" dot={false}>
                        {entry.roleLabel}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone={employeeStatusTone(entry.status)}>
                        {entry.statusLabel}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {entry.createdLabel}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {entry.updatedLabel}
                    </td>
                    {directory.includesAuthDetails ? (
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        {entry.lastSignInLabel}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {directory.entries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No employee profiles are available to this account.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <div className="space-y-5">
          {canInvite ? <InviteEmployeeForm /> : <InviteMemberPanel canInvite={false} />}
          <SectionCard title="Access roles" bodyClassName="p-3">
            <ul className="space-y-1">
              {directory.roleCounts.map((item) => (
                <li
                  key={item.role}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-muted"
                >
                  <span className="inline-flex items-center gap-2 font-medium text-foreground">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {item.label}
                  </span>
                  <span className="text-muted-foreground">{item.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-start gap-2 border-t border-border px-3 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action-teal" aria-hidden="true" />
              Suspended profiles cannot sign in to the internal platform.
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
