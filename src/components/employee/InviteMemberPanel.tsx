import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

export function InviteMemberPanel({ canInvite }: { canInvite: boolean }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">Invite an employee</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {canInvite
            ? "Administrator invitations are sent through Supabase Auth with an assigned access role."
            : "Employee invitations are restricted to administrators. Ask an Admin if access is needed."}
        </p>

        {canInvite ? (
          <Link
            href="/admin/employees"
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Open employee administration
          </Link>
        ) : (
          <div className="mt-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-muted text-xs font-semibold text-muted-foreground opacity-80">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Admin access required
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-xs font-semibold text-foreground">Access model</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Viewer, Staff, Manager, and Admin roles control which internal areas are available after
          sign-in.
        </p>
        <Link
          href="/admin/employees"
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
        >
          View administration area
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
