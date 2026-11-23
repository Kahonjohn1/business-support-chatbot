"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
} from "@/lib/workspace/types";

interface TeamWorkspaceView {
  readonly id: string;
  readonly name: string;
  readonly kind: "personal" | "shared";
  readonly role?: WorkspaceMemberRole;
}

interface TeamManagementProps {
  readonly workspace: TeamWorkspaceView;
  readonly members: readonly WorkspaceMemberView[];
  readonly invitations: readonly WorkspaceInvitationView[];
  readonly myInvitations: readonly WorkspaceInvitationView[];
  readonly canManage: boolean;
  readonly isOwner: boolean;
}

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary";
const primaryButtonClass =
  "rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60";
const secondaryButtonClass =
  "rounded-lg border border-border px-4 py-2 font-medium text-foreground hover:bg-muted disabled:opacity-60";
const dangerButtonClass =
  "rounded-lg border border-danger px-3 py-1 text-xs font-medium text-danger hover:bg-danger-subtle disabled:opacity-60";

const ROLE_LABELS: Record<WorkspaceMemberRole, string> = {
  viewer: "Viewer",
  staff: "Staff",
  manager: "Manager",
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return body && typeof body.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

async function selectWorkspace(workspaceId: string): Promise<void> {
  await fetch("/api/workspace/active", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function TeamManagement({
  workspace,
  members,
  invitations,
  myInvitations,
  canManage,
  isOwner,
}: TeamManagementProps) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>("viewer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function beginAction(action: string): boolean {
    if (busy) return false;
    setBusy(action);
    setError(null);
    setMessage(null);
    return true;
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction("create")) return;
    try {
      const response = await fetch("/api/team/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to create workspace."));
      }
      const body = (await response.json()) as {
        workspace?: { id?: string };
      };
      if (body.workspace?.id) await selectWorkspace(body.workspace.id);
      setWorkspaceName("");
      setMessage("Business workspace created.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create workspace.");
    } finally {
      setBusy(null);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction("invite")) return;
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to send invitation."));
      }
      setInviteEmail("");
      setMessage("Invitation sent. Pending until the recipient accepts.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send invitation.");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(member: WorkspaceMemberView, role: WorkspaceMemberRole) {
    if (!beginAction(`role-${member.userId}`)) return;
    try {
      const response = await fetch(
        `/api/team/members/${encodeURIComponent(member.userId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to change role."));
      }
      setMessage("Member role updated.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change role.");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: WorkspaceMemberView) {
    if (!beginAction(`remove-${member.userId}`)) return;
    try {
      const response = await fetch(
        `/api/team/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to remove member."));
      }
      setMessage("Member removed from this workspace.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove member.");
    } finally {
      setBusy(null);
    }
  }

  async function respondToInvitation(
    invitation: WorkspaceInvitationView,
    decision: "accept" | "decline"
  ) {
    if (!beginAction(`${decision}-${invitation.id}`)) return;
    try {
      const response = await fetch(`/api/team/invitations/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: invitation.token }),
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, `Unable to ${decision} invitation.`)
        );
      }
      if (decision === "accept") {
        await selectWorkspace(invitation.workspaceId);
      }
      setMessage(
        decision === "accept"
          ? "Invitation accepted. You can now collaborate in that workspace."
          : "Invitation declined."
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `Unable to ${decision} invitation.`
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">
          {message}
        </p>
      ) : null}

      {workspace.kind === "personal" ? (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <h2 className="text-base font-semibold text-foreground">Create a business workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Business workspaces let a team share projects, tasks, and memberships.
          </p>
          <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={createWorkspace}>
            <label className="min-w-60 flex-1 text-sm">
              <span className="font-medium text-foreground">Workspace name</span>
              <input
                className={inputClass}
                maxLength={120}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="Acme Operations"
                required
                type="text"
                value={workspaceName}
              />
            </label>
            <button className={primaryButtonClass} disabled={busy !== null} type="submit">
              {busy === "create" ? "Creating..." : "Create workspace"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
            <h2 className="text-base font-semibold text-foreground">Active members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {members.length} active {members.length === 1 ? "member" : "members"} in {workspace.name}.
            </p>
            {members.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No active members to display.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {members.map((member) => (
                  <li
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    key={member.id}
                  >
                    <div className="min-w-0">
                      <p className="break-words font-medium text-foreground">
                        {member.displayName}
                        {member.isOwner ? " (owner)" : ""}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">
                        {member.email ?? "Email unavailable"} · {ROLE_LABELS[member.role]}
                      </p>
                    </div>
                    {canManage && !member.isOwner ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Role for ${member.displayName}`}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                          disabled={busy !== null}
                          onChange={(event) =>
                            changeRole(member, event.target.value as WorkspaceMemberRole)
                          }
                          value={member.role}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="staff">Staff</option>
                          {isOwner ? <option value="manager">Manager</option> : null}
                        </select>
                        <button
                          className={dangerButtonClass}
                          disabled={busy !== null}
                          onClick={() => removeMember(member)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
            <h2 className="text-base font-semibold text-foreground">Invite a member</h2>
            {canManage ? (
              <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={inviteMember}>
                <input
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                  maxLength={254}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="colleague@example.com"
                  required
                  type="email"
                  value={inviteEmail}
                />
                <select
                  aria-label="Invitation role"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  onChange={(event) => setInviteRole(event.target.value as WorkspaceMemberRole)}
                  value={inviteRole}
                >
                  <option value="viewer">Viewer</option>
                  <option value="staff">Staff</option>
                  {isOwner ? <option value="manager">Manager</option> : null}
                </select>
                <button className={primaryButtonClass} disabled={busy !== null} type="submit">
                  {busy === "invite" ? "Sending..." : "Send invitation"}
                </button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Only managers can invite members.
              </p>
            )}
          </section>

          {canManage ? (
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <h2 className="text-base font-semibold text-foreground">Pending invitations</h2>
              {invitations.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No pending invitations.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {invitations.map((invitation) => (
                    <li
                      className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      key={invitation.id}
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium text-foreground">{invitation.email}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ROLE_LABELS[invitation.role]} · Invited {formatDate(invitation.invitedAt)} · Expires {formatDate(invitation.expiresAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
        <h2 className="text-base font-semibold text-foreground">Your invitations</h2>
        {myInvitations.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">You have no pending workspace invitations.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {myInvitations.map((invitation) => (
              <li
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                key={invitation.id}
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">
                    {invitation.workspaceName ?? "Business workspace"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ROLE_LABELS[invitation.role]} · Invited by {invitation.invitedByName ?? "a workspace member"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={primaryButtonClass}
                    disabled={busy !== null || !invitation.token}
                    onClick={() => respondToInvitation(invitation, "accept")}
                    type="button"
                  >
                    {busy === `accept-${invitation.id}` ? "Accepting..." : "Accept"}
                  </button>
                  <button
                    className={secondaryButtonClass}
                    disabled={busy !== null || !invitation.token}
                    onClick={() => respondToInvitation(invitation, "decline")}
                    type="button"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
