import type { Metadata } from "next";
import { Building2, ShieldCheck, UserCog, Users } from "lucide-react";
import { AvatarWithName } from "@/components/employee/Avatar";
import { InviteEmployeeForm } from "@/components/employee/InviteEmployeeForm";
import { PageHeader } from "@/components/employee/PageHeader";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requirePermission } from "@/lib/employee/access";
import { teamMembers } from "@/lib/employee/mockData";

export const metadata: Metadata = {
  title: "Employee administration",
};

export default async function EmployeesAdminPage() {
  await requirePermission("employees:invite");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Employees"
        description="Invite employees, assign access roles, and review the illustrated employee directory."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Directory records</p>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">18</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Illustrative preview profiles</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Access roles</p>
            <ShieldCheck className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">04</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Viewer through Admin</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Invitation provider</p>
            <UserCog className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-lg font-semibold text-foreground">Supabase Auth</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Administrator-only invitations</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <InviteEmployeeForm />

        <SectionCard
          title="Employee directory"
          description="Operational profiles below remain illustrative mock records."
          bodyClassName="p-3 sm:p-4"
        >
          <div className="space-y-3">
            {teamMembers.map((member) => (
              <article
                key={member.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <AvatarWithName name={member.name} meta={member.email} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
                    <Building2 className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    {member.team}
                  </span>
                  <span className="rounded-lg bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
                    {member.role}
                  </span>
                  <StatusBadge tone={member.status === "Active" ? "success" : "warning"}>
                    {member.status}
                  </StatusBadge>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
