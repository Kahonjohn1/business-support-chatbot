import "server-only";

import { hasWorkspaceMemberRole } from "@/lib/workspace/authorization";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import type {
  HybridWorkspaceRecord,
  WorkspaceInvitationResult,
  WorkspaceInvitationStatus,
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
  WorkspaceMembershipRecord,
  WorkspaceMembershipStatus,
  WorkspaceType,
} from "@/lib/workspace/types";

export interface HybridWorkspaceRepository {
  listWorkspaces(userId: string): Promise<readonly HybridWorkspaceRecord[]>;
  getWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<HybridWorkspaceRecord | null>;
  getMembership(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMembershipRecord | null>;
  ensurePersonalWorkspace(userId: string): Promise<HybridWorkspaceRecord>;
  createBusinessWorkspace(userId: string, name: string): Promise<HybridWorkspaceRecord>;
  listMembers(
    userId: string,
    workspaceId: string
  ): Promise<readonly WorkspaceMemberView[]>;
  listInvitations(
    userId: string,
    workspaceId: string
  ): Promise<readonly WorkspaceInvitationView[]>;
  listMyInvitations(userId: string): Promise<readonly WorkspaceInvitationView[]>;
  inviteMember(
    userId: string,
    workspaceId: string,
    email: string,
    role: WorkspaceMemberRole
  ): Promise<WorkspaceInvitationView>;
  acceptInvitation(
    userId: string,
    token: string
  ): Promise<WorkspaceInvitationResult>;
  declineInvitation(userId: string, token: string): Promise<void>;
  updateMemberRole(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceMemberRole
  ): Promise<WorkspaceMemberView>;
  removeMember(
    userId: string,
    workspaceId: string,
    memberUserId: string
  ): Promise<void>;
}

export class HybridWorkspaceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HybridWorkspaceDataError";
  }
}

const WORKSPACE_COLUMNS =
  "id, workspace_type, name, owner_user_id, created_by, created_at, updated_at";
const MEMBERSHIP_COLUMNS =
  "id, workspace_id, user_id, role, status, created_at, updated_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HybridWorkspaceDataError(`Invalid workspace ${key}.`);
  }
  return value;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string
): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HybridWorkspaceDataError(`Invalid workspace ${key}.`);
  }
  return value;
}

function asWorkspaceType(value: unknown): WorkspaceType {
  if (value === "personal" || value === "business") return value;
  throw new HybridWorkspaceDataError("Invalid workspace type.");
}

function asWorkspaceMemberRole(value: unknown): WorkspaceMemberRole {
  if (value === "viewer" || value === "staff" || value === "manager") return value;
  throw new HybridWorkspaceDataError("Invalid workspace member role.");
}

function asWorkspaceMembershipStatus(value: unknown): WorkspaceMembershipStatus {
  if (value === "active" || value === "inactive") return value;
  throw new HybridWorkspaceDataError("Invalid workspace membership status.");
}

function asWorkspaceInvitationStatus(value: unknown): WorkspaceInvitationStatus {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "declined" ||
    value === "expired" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new HybridWorkspaceDataError("Invalid workspace invitation status.");
}

function optionalRowString(
  row: Record<string, unknown>,
  key: string
): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function mapWorkspaceMember(value: unknown): WorkspaceMemberView {
  if (!isRecord(value)) {
    throw new HybridWorkspaceDataError("Invalid workspace member record.");
  }
  return {
    id: readString(value, "id"),
    userId: readString(value, "user_id"),
    email: readNullableString(value, "email"),
    displayName: readString(value, "display_name"),
    role: asWorkspaceMemberRole(value.role),
    status: asWorkspaceMembershipStatus(value.status),
    isOwner: value.is_owner === true,
  };
}

function mapWorkspaceInvitation(value: unknown): WorkspaceInvitationView {
  if (!isRecord(value)) {
    throw new HybridWorkspaceDataError("Invalid workspace invitation record.");
  }
  return {
    id: readString(value, "id"),
    workspaceId: readString(value, "workspace_id"),
    ...(optionalRowString(value, "workspace_name")
      ? { workspaceName: optionalRowString(value, "workspace_name") }
      : {}),
    email: readString(value, "email"),
    role: asWorkspaceMemberRole(value.role),
    status: asWorkspaceInvitationStatus(value.status),
    ...(optionalRowString(value, "token") ? { token: optionalRowString(value, "token") } : {}),
    expiresAt: readString(value, "expires_at"),
    invitedAt: readString(value, "invited_at"),
    invitedBy: readNullableString(value, "invited_by"),
    invitedByName: readNullableString(value, "invited_by_name"),
  };
}

function mapWorkspaceInvitationResult(
  value: unknown
): WorkspaceInvitationResult {
  if (!isRecord(value)) {
    throw new HybridWorkspaceDataError("Invalid invitation result.");
  }
  return {
    workspaceId: readString(value, "workspace_id"),
    workspaceName: readString(value, "workspace_name"),
    role: asWorkspaceMemberRole(value.role),
  };
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new WorkspaceAccessError(400, `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new WorkspaceAccessError(400, `${field} must be between 1 and ${max} characters.`);
  }
  return trimmed;
}

function requireToken(value: unknown): string {
  return requireText(value, "Invitation token", 200);
}

function requireInvitationRole(value: unknown): WorkspaceMemberRole {
  if (value === "viewer" || value === "staff" || value === "manager") return value;
  throw new WorkspaceAccessError(400, "Role must be viewer, staff, or manager.");
}

function mapWorkspaceMembershipRowAsMember(
  value: unknown,
  fallbackRole: WorkspaceMemberRole
): WorkspaceMemberView {
  const membership = mapMembership(value);
  return {
    id: membership.id,
    userId: membership.userId,
    email: null,
    displayName: membership.userId,
    role: fallbackRole || membership.role,
    status: membership.status,
    isOwner: false,
  };
}

function mapWorkspace(value: unknown): HybridWorkspaceRecord {
  if (!isRecord(value)) {
    throw new HybridWorkspaceDataError("Invalid workspace record.");
  }
  return {
    id: readString(value, "id"),
    type: asWorkspaceType(value.workspace_type),
    name: readString(value, "name"),
    ownerUserId: readNullableString(value, "owner_user_id"),
    createdBy: readString(value, "created_by"),
    createdAt: readString(value, "created_at"),
    updatedAt: readString(value, "updated_at"),
  };
}

function mapMembership(value: unknown): WorkspaceMembershipRecord {
  if (!isRecord(value)) {
    throw new HybridWorkspaceDataError("Invalid workspace membership record.");
  }
  return {
    id: readString(value, "id"),
    workspaceId: readString(value, "workspace_id"),
    userId: readString(value, "user_id"),
    role: asWorkspaceMemberRole(value.role),
    status: asWorkspaceMembershipStatus(value.status),
    createdAt: readString(value, "created_at"),
    updatedAt: readString(value, "updated_at"),
  };
}

export function hybridWorkspaceUserIdFromAuth(auth: unknown): string {
  if (!isRecord(auth) || typeof auth.userId !== "string") {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  const userId = auth.userId.trim();
  if (!userId) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return userId;
}

function requireWorkspaceId(workspaceId: string): string {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new WorkspaceAccessError(400, "Workspace id is required.");
  }
  return workspaceId.trim();
}

function throwDatabaseError(operation: string, message: string): never {
  throw new HybridWorkspaceDataError(
    `Workspace ${operation} failed: ${message.slice(0, 200)}`
  );
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

const supabaseHybridWorkspaceRepository: HybridWorkspaceRepository = {
  async listWorkspaces(userId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select(WORKSPACE_COLUMNS)
      .order("name", { ascending: true })
      .limit(100);
    if (error) throwDatabaseError("listing", error.message);
    return (data ?? []).map(mapWorkspace);
  },

  async getWorkspace(userId, workspaceId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select(WORKSPACE_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throwDatabaseError("retrieval", error.message);
    return data ? mapWorkspace(data) : null;
  },

  async getMembership(userId, workspaceId) {
    const owner = hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_memberships")
      .select(MEMBERSHIP_COLUMNS)
      .eq("workspace_id", id)
      .eq("user_id", owner)
      .maybeSingle();
    if (error) throwDatabaseError("membership lookup", error.message);
    return data ? mapMembership(data) : null;
  },

  async ensurePersonalWorkspace(userId) {
    const owner = hybridWorkspaceUserIdFromAuth({ userId });
    const supabase = await createClient();
    const existing = await supabase
      .from("workspaces")
      .select(WORKSPACE_COLUMNS)
      .eq("workspace_type", "personal")
      .eq("owner_user_id", owner)
      .maybeSingle();
    if (existing.error) throwDatabaseError("personal workspace lookup", existing.error.message);

    let workspaceRow: unknown = existing.data;
    if (!workspaceRow) {
      const inserted = await supabase
        .from("workspaces")
        .insert({
          workspace_type: "personal",
          name: "Personal workspace",
          owner_user_id: owner,
          created_by: owner,
        })
        .select(WORKSPACE_COLUMNS)
        .maybeSingle();
      if (inserted.error && inserted.error.code !== "23505") {
        throwDatabaseError("personal workspace creation", inserted.error.message);
      }
      workspaceRow = inserted.data;
    }

    if (!workspaceRow) {
      const retry = await supabase
        .from("workspaces")
        .select(WORKSPACE_COLUMNS)
        .eq("workspace_type", "personal")
        .eq("owner_user_id", owner)
        .maybeSingle();
      if (retry.error) throwDatabaseError("personal workspace lookup", retry.error.message);
      if (!retry.data) {
        throw new HybridWorkspaceDataError("Personal workspace was not created.");
      }
      workspaceRow = retry.data;
    }

    const workspace = mapWorkspace(workspaceRow);
    const membership = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("user_id", owner)
      .maybeSingle();
    if (membership.error) {
      throwDatabaseError("personal membership lookup", membership.error.message);
    }
    if (!membership.data) {
      const insertedMembership = await supabase
        .from("workspace_memberships")
        .insert({
          workspace_id: workspace.id,
          user_id: owner,
          role: "manager",
          status: "active",
          created_by: owner,
        });
      if (insertedMembership.error && insertedMembership.error.code !== "23505") {
        throwDatabaseError("personal membership creation", insertedMembership.error.message);
      }
    }

    return workspace;
  },

  async createBusinessWorkspace(userId, name) {
    const owner = hybridWorkspaceUserIdFromAuth({ userId });
    const workspaceName = requireText(name, "Workspace name", 120);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("create_business_workspace", { p_name: workspaceName })
      .single();
    if (error) throwDatabaseError("creation", error.message);
    if (!data) throwDatabaseError("creation", "Workspace was not created.");
    const workspace = mapWorkspace(data);
    if (workspace.type !== "business" || workspace.createdBy !== owner) {
      throw new HybridWorkspaceDataError("Created workspace failed verification.");
    }
    return workspace;
  },

  async listMembers(userId, workspaceId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_workspace_members", {
      p_workspace_id: id,
    });
    if (error) throwDatabaseError("member listing", error.message);
    return (data ?? []).map(mapWorkspaceMember);
  },

  async listInvitations(userId, workspaceId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_workspace_invitations", {
      p_workspace_id: id,
    });
    if (error) throwDatabaseError("invitation listing", error.message);
    return (data ?? []).map(mapWorkspaceInvitation);
  },

  async listMyInvitations(userId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_my_workspace_invitations");
    if (error) throwDatabaseError("invitation listing", error.message);
    return (data ?? []).map(mapWorkspaceInvitation);
  },

  async inviteMember(userId, workspaceId, email, role) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const inviteEmail = requireText(email, "Email", 254);
    const inviteRole = requireInvitationRole(role);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("create_workspace_invitation", {
        p_workspace_id: id,
        p_email: inviteEmail,
        p_role: inviteRole,
      })
      .single();
    if (error) throwDatabaseError("invitation creation", error.message);
    if (!data) throwDatabaseError("invitation creation", "Invitation was not created.");
    return mapWorkspaceInvitation(data);
  },

  async acceptInvitation(userId, token) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const invitationToken = requireToken(token);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("accept_workspace_invitation", { p_token: invitationToken })
      .single();
    if (error) throwDatabaseError("invitation acceptance", error.message);
    if (!data) throwDatabaseError("invitation acceptance", "Invitation was not accepted.");
    return mapWorkspaceInvitationResult(data);
  },

  async declineInvitation(userId, token) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const invitationToken = requireToken(token);
    const supabase = await createClient();
    const { error } = await supabase.rpc("decline_workspace_invitation", {
      p_token: invitationToken,
    });
    if (error) throwDatabaseError("invitation decline", error.message);
  },

  async updateMemberRole(userId, workspaceId, memberUserId, role) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const target = requireText(memberUserId, "Member", 200);
    const newRole = requireInvitationRole(role);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("update_workspace_member_role", {
        p_workspace_id: id,
        p_user_id: target,
        p_role: newRole,
      })
      .single();
    if (error) throwDatabaseError("member role update", error.message);
    if (!data) throwDatabaseError("member role update", "Member role was not changed.");
    return mapWorkspaceMembershipRowAsMember(data, newRole);
  },

  async removeMember(userId, workspaceId, memberUserId) {
    hybridWorkspaceUserIdFromAuth({ userId });
    const id = requireWorkspaceId(workspaceId);
    const target = requireText(memberUserId, "Member", 200);
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_workspace_member", {
      p_workspace_id: id,
      p_user_id: target,
    });
    if (error) throwDatabaseError("member removal", error.message);
  },
};

let activeRepository: HybridWorkspaceRepository = supabaseHybridWorkspaceRepository;

export function setHybridWorkspaceRepository(
  repository: HybridWorkspaceRepository
): void {
  activeRepository = repository;
}

export function resetHybridWorkspaceRepository(): void {
  activeRepository = supabaseHybridWorkspaceRepository;
}

export function getHybridWorkspaceRepository(): HybridWorkspaceRepository {
  return activeRepository;
}

export async function listHybridWorkspaces(
  auth: unknown
): Promise<readonly HybridWorkspaceRecord[]> {
  return activeRepository.listWorkspaces(hybridWorkspaceUserIdFromAuth(auth));
}

export async function getHybridWorkspace(
  auth: unknown,
  workspaceId: string
): Promise<HybridWorkspaceRecord | null> {
  return activeRepository.getWorkspace(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId)
  );
}

export async function requireHybridWorkspaceAccess(
  auth: unknown,
  workspaceId: string,
  requiredRole: WorkspaceMemberRole = "viewer"
): Promise<{
  workspace: HybridWorkspaceRecord;
  membership: WorkspaceMembershipRecord;
}> {
  const userId = hybridWorkspaceUserIdFromAuth(auth);
  const id = requireWorkspaceId(workspaceId);
  const workspace = await activeRepository.getWorkspace(userId, id);
  if (!workspace) {
    throw new WorkspaceAccessError(404, "Workspace not found.");
  }
  const membership = await activeRepository.getMembership(userId, id);
  if (!membership || membership.status !== "active") {
    throw new WorkspaceAccessError(403, "Workspace access requires active membership.");
  }
  if (!hasWorkspaceMemberRole(membership.role, requiredRole)) {
    throw new WorkspaceAccessError(403, "Insufficient workspace role.");
  }
  return { workspace, membership };
}

export async function ensurePersonalHybridWorkspace(
  auth: unknown
): Promise<HybridWorkspaceRecord> {
  return activeRepository.ensurePersonalWorkspace(hybridWorkspaceUserIdFromAuth(auth));
}

export async function createHybridBusinessWorkspace(
  auth: unknown,
  name: string
): Promise<HybridWorkspaceRecord> {
  return activeRepository.createBusinessWorkspace(
    hybridWorkspaceUserIdFromAuth(auth),
    name
  );
}

export async function listHybridWorkspaceMembers(
  auth: unknown,
  workspaceId: string
): Promise<readonly WorkspaceMemberView[]> {
  return activeRepository.listMembers(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId)
  );
}

export async function listHybridWorkspaceInvitations(
  auth: unknown,
  workspaceId: string
): Promise<readonly WorkspaceInvitationView[]> {
  return activeRepository.listInvitations(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId)
  );
}

export async function listMyHybridWorkspaceInvitations(
  auth: unknown
): Promise<readonly WorkspaceInvitationView[]> {
  return activeRepository.listMyInvitations(hybridWorkspaceUserIdFromAuth(auth));
}

export async function createHybridWorkspaceInvitation(
  auth: unknown,
  workspaceId: string,
  email: string,
  role: WorkspaceMemberRole
): Promise<WorkspaceInvitationView> {
  return activeRepository.inviteMember(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId),
    email,
    role
  );
}

export async function acceptHybridWorkspaceInvitation(
  auth: unknown,
  token: string
): Promise<WorkspaceInvitationResult> {
  return activeRepository.acceptInvitation(
    hybridWorkspaceUserIdFromAuth(auth),
    token
  );
}

export async function declineHybridWorkspaceInvitation(
  auth: unknown,
  token: string
): Promise<void> {
  return activeRepository.declineInvitation(
    hybridWorkspaceUserIdFromAuth(auth),
    token
  );
}

export async function updateHybridWorkspaceMemberRole(
  auth: unknown,
  workspaceId: string,
  memberUserId: string,
  role: WorkspaceMemberRole
): Promise<WorkspaceMemberView> {
  return activeRepository.updateMemberRole(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId),
    memberUserId,
    role
  );
}

export async function removeHybridWorkspaceMember(
  auth: unknown,
  workspaceId: string,
  memberUserId: string
): Promise<void> {
  return activeRepository.removeMember(
    hybridWorkspaceUserIdFromAuth(auth),
    requireWorkspaceId(workspaceId),
    memberUserId
  );
}
