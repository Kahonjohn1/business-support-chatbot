"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CompanySummary } from "@/lib/workspace/types";

interface WorkspaceSettingsProps {
  companies: readonly CompanySummary[];
  activeCompany: CompanySummary;
}

export function WorkspaceSettings({
  companies,
  activeCompany,
}: WorkspaceSettingsProps) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(activeCompany.id);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function switchCompany() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/company/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) throw new Error("Unable to switch company.");
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to switch company.");
    } finally {
      setBusy(false);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to send invitation.");
      setMessage("Invitation created. The recipient can accept it after signing in.");
      setInviteEmail("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send invitation.");
    } finally {
      setBusy(false);
    }
  }

  const canInvite = activeCompany.role === "owner" || activeCompany.role === "admin";

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-primary">{message}</p> : null}

      <section className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-foreground">Active company</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeCompany.name} · {activeCompany.displayRole}
        </p>
        {companies.length > 1 ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="font-medium text-foreground">Switch to</span>
              <select
                className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                onChange={(event) => setCompanyId(event.target.value)}
                value={companyId}
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
              disabled={busy}
              onClick={switchCompany}
              type="button"
            >
              Switch
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-foreground">Invite a member</h2>
        {canInvite ? (
          <form className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto]" onSubmit={inviteMember}>
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="colleague@example.com"
              required
              type="email"
              value={inviteEmail}
            />
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              onChange={(event) => setInviteRole(event.target.value)}
              value={inviteRole}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              Invite
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Only owners and admins can invite members.
          </p>
        )}
      </section>
    </div>
  );
}
