import type { Metadata } from "next";
import Link from "next/link";
import { Building2, UserPlus, Users } from "lucide-react";
import { teamMembers } from "@/lib/employee/mockData";
import { AvatarWithName } from "@/components/employee/Avatar";
import { InviteMemberPanel } from "@/components/employee/InviteMemberPanel";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requireEmployee } from "@/lib/employee/access";
import { hasPermission } from "@/lib/employee/roles";

export const metadata: Metadata = {
  title: "Team",
};

const teams = ["Operations", "Product", "Engineering", "Support", "Partnerships"];

export default async function TeamPage() {
  const session = await requireEmployee();
  const canInvite = hasPermission(session.user.role, "employees:invite");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Team"
        description="Employee directory, team structure, and invitation workflow for the internal operations platform."
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
          <p className="text-xs text-muted-foreground">Team members</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">18</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Across five operating teams</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Outstanding invitations</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">03</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Preview-only invitation queue</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Active teams</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">05</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Operations through partnerships</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard
          title="Employee directory"
          description="Illustrative profiles shown for layout review."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Team</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr key={member.id} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-3.5">
                      <AvatarWithName name={member.name} meta={member.email} />
                    </td>
                    <td className="px-4 py-3.5 text-xs font-medium text-foreground">{member.role}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {member.team}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">{member.location}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone={member.status === "Active" ? "success" : "warning"}>
                        {member.status}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <InviteMemberPanel canInvite={canInvite} />
          <SectionCard title="Teams" bodyClassName="p-3">
            <ul className="space-y-1">
              {teams.map((team, index) => (
                <li
                  key={team}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-muted"
                >
                  <span className="inline-flex items-center gap-2 font-medium text-foreground">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {team}
                  </span>
                  <span className="text-muted-foreground">{[6, 3, 4, 4, 1][index] ?? 0}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
