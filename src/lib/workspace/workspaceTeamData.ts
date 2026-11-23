import { checkPermission, TEAM_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import {
  acceptHybridWorkspaceInvitation,
  createHybridBusinessWorkspace,
  createHybridWorkspaceInvitation,
  declineHybridWorkspaceInvitation,
  listHybridWorkspaceInvitations,
  listHybridWorkspaceMembers,
  listMyHybridWorkspaceInvitations,
  removeHybridWorkspaceMember,
  requireHybridWorkspaceAccess,
  updateHybridWorkspaceMemberRole,
} from "@/lib/workspace/hybridWorkspaceData";
import type { AuthorizationContext } from "@/lib/permissions";
import type {
  HybridWorkspaceRecord,
  WorkspaceInvitationResult,
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
} from "@/lib/workspace/types";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface TeamWorkspaceAccess {
  readonly workspace: HybridWorkspaceRecord;
  readonly auth: AuthorizationContext;
}

export interface WorkspaceAssignee {
  readonly id: string;
  readonly label: string;
  readonly role: WorkspaceMemberRole;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new WorkspaceAccessError(400, `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new WorkspaceAccessError(
      400,
      `${field} must be between 1 and ${max} characters.`
    );
  }
  return trimmed;
}

function requireWorkspaceId(auth: AuthorizationContext): string {
  if (
    auth.workspaceKind !== "shared" ||
    auth.source !== "verified_membership" ||
    typeof auth.workspaceId !== "string" ||
    !auth.workspaceId.trim()
  ) {
    throw new WorkspaceAccessError(
      403,
      "An active business workspace membership is required."
    );
  }
  return auth.workspaceId.trim();
}

function requirePermission(
  permissionToolName: string,
  auth: AuthorizationContext
): void {
  const check = checkPermission(permissionToolName, auth);
  if (!check.permitted) {
    throw new WorkspaceAccessError(
      403,
      check.reason ?? "That team operation is not permitted."
    );
  }
}

export function isWorkspaceOwner(
  workspace: HybridWorkspaceRecord,
  userId: string
): boolean {
  return workspace.ownerUserId === userId || workspace.createdBy === userId;
}

export async function requireTeamWorkspace(
  auth: unknown,
  requiredRole: WorkspaceMemberRole,
  permissionToolName: string
): Promise<TeamWorkspaceAccess> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const authorization = auth as unknown as AuthorizationContext;
  const workspaceId = requireWorkspaceId(authorization);
  requirePermission(permissionToolName, authorization);
  const { workspace } = await requireHybridWorkspaceAccess(
    authorization,
    workspaceId,
    requiredRole
  );
  if (workspace.type !== "business") {
    throw new WorkspaceAccessError(
      403,
      "Team management is available only in business workspaces."
    );
  }
  return { workspace, auth: authorization };
}

export async function listTeamWorkspaceMembers(
  auth: unknown
): Promise<readonly WorkspaceMemberView[]> {
  const { auth: authorization, workspace } = await requireTeamWorkspace(
    auth,
    "viewer",
    TEAM_PERMISSION_TOOL_NAMES.listMembers
  );
  return listHybridWorkspaceMembers(authorization, workspace.id);
}

export function toWorkspaceAssignees(
  members: readonly WorkspaceMemberView[]
): readonly WorkspaceAssignee[] {
  return members
    .filter((member) => member.status === "active")
    .map((member) => ({
      id: member.userId,
      label:
        member.displayName.trim() ||
        member.email?.trim() ||
        member.userId,
      role: member.role,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listWorkspaceAssignees(
  auth: unknown
): Promise<readonly WorkspaceAssignee[]> {
  return toWorkspaceAssignees(await listTeamWorkspaceMembers(auth));
}

export async function requireWorkspaceAssignee(
  auth: unknown,
  assigneeId: string
): Promise<WorkspaceAssignee> {
  const assignees = await listWorkspaceAssignees(auth);
  const assignee = assignees.find((option) => option.id === assigneeId);
  if (!assignee) {
    throw new WorkspaceAccessError(
      400,
      "Assignee must be an active member of this workspace."
    );
  }
  return assignee;
}

export async function listTeamWorkspaceInvitations(
  auth: unknown
): Promise<readonly WorkspaceInvitationView[]> {
  const { auth: authorization, workspace } = await requireTeamWorkspace(
    auth,
    "manager",
    TEAM_PERMISSION_TOOL_NAMES.listInvitations
  );
  return listHybridWorkspaceInvitations(authorization, workspace.id);
}

export async function listMyWorkspaceInvitations(
  auth: unknown
): Promise<readonly WorkspaceInvitationView[]> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const authorization = auth as unknown as AuthorizationContext;
  requirePermission(TEAM_PERMISSION_TOOL_NAMES.listMyInvitations, authorization);
  return listMyHybridWorkspaceInvitations(authorization);
}

export async function createTeamWorkspaceInvitation(
  auth: unknown,
  rawEmail: unknown,
  rawRole: unknown
): Promise<WorkspaceInvitationView> {
  const { auth: authorization, workspace } = await requireTeamWorkspace(
    auth,
    "manager",
    TEAM_PERMISSION_TOOL_NAMES.createInvitation
  );
  const email = requireText(rawEmail, "Email", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new WorkspaceAccessError(400, "A valid email address is required.");
  }
  if (rawRole !== "viewer" && rawRole !== "staff" && rawRole !== "manager") {
    throw new WorkspaceAccessError(
      400,
      "Role must be viewer, staff, or manager."
    );
  }
  if (
    rawRole === "manager" &&
    !isWorkspaceOwner(workspace, authorization.userId)
  ) {
    throw new WorkspaceAccessError(
      403,
      "Only the workspace owner can invite managers."
    );
  }
  return createHybridWorkspaceInvitation(
    authorization,
    workspace.id,
    email,
    rawRole
  );
}

function assertManageableMember(
  workspace: HybridWorkspaceRecord,
  actorUserId: string,
  target: WorkspaceMemberView,
  nextRole?: WorkspaceMemberRole
): void {
  if (target.userId === actorUserId) {
    throw new WorkspaceAccessError(
      403,
      "You cannot change your own workspace membership."
    );
  }
  if (target.isOwner || isWorkspaceOwner(workspace, target.userId)) {
    throw new WorkspaceAccessError(403, "The workspace owner is protected.");
  }
  if (
    target.role === "manager" &&
    !isWorkspaceOwner(workspace, actorUserId)
  ) {
    throw new WorkspaceAccessError(
      403,
      "Only the workspace owner can change managers."
    );
  }
  if (
    nextRole === "manager" &&
    !isWorkspaceOwner(workspace, actorUserId)
  ) {
    throw new WorkspaceAccessError(
      403,
      "Only the workspace owner can appoint managers."
    );
  }
}

async function findTeamMember(
  authorization: AuthorizationContext,
  workspaceId: string,
  memberUserId: string
): Promise<WorkspaceMemberView> {
  const members = await listHybridWorkspaceMembers(authorization, workspaceId);
  const target = members.find((member) => member.userId === memberUserId);
  if (!target || target.status !== "active") {
    throw new WorkspaceAccessError(404, "Active workspace member not found.");
  }
  return target;
}

export async function updateTeamWorkspaceMemberRole(
  auth: unknown,
  rawMemberUserId: unknown,
  rawRole: unknown
): Promise<WorkspaceMemberView> {
  const { auth: authorization, workspace } = await requireTeamWorkspace(
    auth,
    "manager",
    TEAM_PERMISSION_TOOL_NAMES.updateMemberRole
  );
  const memberUserId = requireText(rawMemberUserId, "Member", 200);
  if (rawRole !== "viewer" && rawRole !== "staff" && rawRole !== "manager") {
    throw new WorkspaceAccessError(
      400,
      "Role must be viewer, staff, or manager."
    );
  }
  const target = await findTeamMember(
    authorization,
    workspace.id,
    memberUserId
  );
  assertManageableMember(workspace, authorization.userId, target, rawRole);
  return updateHybridWorkspaceMemberRole(
    authorization,
    workspace.id,
    memberUserId,
    rawRole
  );
}

export async function removeTeamWorkspaceMember(
  auth: unknown,
  rawMemberUserId: unknown
): Promise<void> {
  const { auth: authorization, workspace } = await requireTeamWorkspace(
    auth,
    "manager",
    TEAM_PERMISSION_TOOL_NAMES.removeMember
  );
  const memberUserId = requireText(rawMemberUserId, "Member", 200);
  const target = await findTeamMember(
    authorization,
    workspace.id,
    memberUserId
  );
  assertManageableMember(workspace, authorization.userId, target);
  await removeHybridWorkspaceMember(authorization, workspace.id, memberUserId);
}

export async function acceptTeamWorkspaceInvitation(
  auth: unknown,
  rawToken: unknown
): Promise<WorkspaceInvitationResult> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const authorization = auth as unknown as AuthorizationContext;
  requirePermission(TEAM_PERMISSION_TOOL_NAMES.acceptInvitation, authorization);
  const token = requireText(rawToken, "Invitation token", 200);
  return acceptHybridWorkspaceInvitation(authorization, token);
}

export async function declineTeamWorkspaceInvitation(
  auth: unknown,
  rawToken: unknown
): Promise<void> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const authorization = auth as unknown as AuthorizationContext;
  requirePermission(TEAM_PERMISSION_TOOL_NAMES.declineInvitation, authorization);
  const token = requireText(rawToken, "Invitation token", 200);
  await declineHybridWorkspaceInvitation(authorization, token);
}

export async function createTeamBusinessWorkspace(
  auth: unknown,
  rawName: unknown
): Promise<HybridWorkspaceRecord> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const authorization = auth as unknown as AuthorizationContext;
  if (
    authorization.workspaceKind !== "personal" ||
    authorization.source !== "personal_owner"
  ) {
    throw new WorkspaceAccessError(
      403,
      "Select Personal before creating a business workspace."
    );
  }
  requirePermission(
    TEAM_PERMISSION_TOOL_NAMES.createBusinessWorkspace,
    authorization
  );
  const name = requireText(rawName, "Workspace name", 120);
  return createHybridBusinessWorkspace(authorization, name);
}
