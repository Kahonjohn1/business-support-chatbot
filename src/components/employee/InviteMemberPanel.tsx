import { Mail, Plus } from "lucide-react";
import { Avatar } from "./Avatar";

export function InviteMemberPanel() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">Invite an employee</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Invitation delivery will be available when authentication and employee data are connected.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Work email</span>
            <div className="relative">
              <input
                type="email"
                readOnly
                placeholder="name@marquetechnologies.com"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-3 pr-9 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Mail
                className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Role</span>
            <select
              disabled
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-muted-foreground"
            >
              <option>Select a role</option>
              <option>Operations</option>
              <option>Engineering</option>
              <option>Support</option>
            </select>
          </label>
          <button
            type="button"
            disabled
            className="flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-muted text-xs font-semibold text-muted-foreground opacity-80"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Send invitation preview
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-xs font-semibold text-foreground">Outstanding invitations</p>
        <div className="mt-3 flex items-center gap-2.5">
          <Avatar name="Priya Kapoor" size="sm" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">Priya Kapoor</p>
            <p className="truncate text-[11px] text-muted-foreground">Support Analyst · 3 days ago</p>
          </div>
        </div>
      </div>
    </div>
  );
}
