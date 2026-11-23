import { AppShell } from "@/components/workspace/AppShell";
import { TeamManagement } from "@/components/workspace/TeamManagement";
import { getHybridWorkspace } from "@/lib/workspace/hybridWorkspaceData";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";
import {
  getActiveWorkspaceContext,
  toWorkspaceSwitcherView,
} from "@/lib/workspace/workspaceSelection";
import {
  isWorkspaceOwner,
  listMyWorkspaceInvitations,
  listTeamWorkspaceInvitations,
  listTeamWorkspaceMembers,
} from "@/lib/workspace/workspaceTeamData";
import type {
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
} from "@/lib/workspace/types";

export const instant = false;

export default async function TeamPage() {
  const context = await requireUserPage("/team");
  const { selection, auth } = await getActiveWorkspaceContext(context);
  const isShared =
    selection.active.kind === "shared" &&
    auth.workspaceKind === "shared" &&
    auth.source === "verified_membership" &&
    Boolean(auth.workspaceId);
  const canManage = isShared && auth.role === "admin";

  const [conversations, myInvitationsResult, teamResult] = await Promise.all([
    getConversationList(context),
    listMyWorkspaceInvitations(auth).catch(() => null),
    isShared && auth.workspaceId
      ? Promise.all([
          listTeamWorkspaceMembers(auth).catch(() => null),
          canManage
            ? listTeamWorkspaceInvitations(auth).catch(() => [])
            : Promise.resolve([] as readonly WorkspaceInvitationView[]),
          getHybridWorkspace(auth, auth.workspaceId).catch(() => null),
        ])
      : Promise.resolve(null),
  ]);

  const members: readonly WorkspaceMemberView[] = teamResult?.[0] ?? [];
  const invitations: readonly WorkspaceInvitationView[] = teamResult?.[1] ?? [];
  const workspace = teamResult?.[2] ?? null;
  const loadError =
    (isShared && teamResult?.[0] === null) || myInvitationsResult === null
      ? "Team data could not be loaded right now."
      : null;
  const isOwner = Boolean(
    workspace && isWorkspaceOwner(workspace, context.user.id)
  );

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold text-foreground">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isShared
            ? `Members and invitations for ${selection.active.name}.`
            : "Create a business workspace or respond to an invitation."}
        </p>

        {loadError ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center">
            <p className="font-medium">{loadError}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Verify the workspace migrations are applied, then try again.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <TeamManagement
              workspace={{
                id: selection.active.id,
                name: selection.active.name,
                kind: selection.active.kind,
                ...(selection.active.role
                  ? { role: selection.active.role as WorkspaceMemberRole }
                  : {}),
              }}
              members={members}
              invitations={invitations}
              myInvitations={myInvitationsResult ?? []}
              canManage={canManage}
              isOwner={isOwner}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
