import {
  createWorkspaceMembershipAuthorization,
} from "../src/lib/workspace/authorization.ts";
import type {
  HybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import type {
  CreateWorkspaceProjectInput,
  CreateWorkspaceTaskInput,
  UpdateWorkspaceProjectInput,
  UpdateWorkspaceTaskInput,
  WorkspaceProjectRecord,
  WorkspaceProjectRepository,
  WorkspaceProjectScope,
  WorkspaceTaskRecord,
} from "../src/lib/workspace/workspaceProjectData.ts";
import type {
  HybridWorkspaceRecord,
  WorkspaceInvitationResult,
  WorkspaceInvitationStatus,
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
  WorkspaceMembershipRecord,
  WorkspaceMembershipStatus,
} from "../src/lib/workspace/types.ts";

export const WORKSPACE_A = "workspace-a";
export const WORKSPACE_B = "workspace-b";
export const USER_A = "user-a";
export const USER_B = "user-b";

export function workspaceRecord(id: string): HybridWorkspaceRecord {
  return {
    id,
    type: "business",
    name: id === WORKSPACE_A ? "Workspace A" : "Workspace B",
    ownerUserId: null,
    createdBy: USER_A,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
}

export function membershipRecord(
  workspaceId: string,
  userId: string,
  role: WorkspaceMemberRole,
  status: WorkspaceMembershipStatus = "active"
): WorkspaceMembershipRecord {
  return {
    id: `${workspaceId}-${userId}-membership`,
    workspaceId,
    userId,
    role,
    status,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
}

export function sharedAuth(
  workspaceId: string,
  userId: string,
  role: WorkspaceMemberRole
) {
  const authorization = createWorkspaceMembershipAuthorization(
    { id: userId, email: `${userId}@example.test`, displayName: userId },
    workspaceRecord(workspaceId),
    membershipRecord(workspaceId, userId, role)
  );
  if (!authorization) {
    throw new Error("Unable to create shared authorization context.");
  }
  return authorization;
}

type MembershipKey = string;

interface InvitationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly role: WorkspaceMemberRole;
  readonly token: string;
  status: WorkspaceInvitationStatus;
  readonly expiresAt: string;
  readonly invitedAt: string;
  readonly invitedBy: string;
  invitedUserId: string | null;
}

function membershipKey(workspaceId: string, userId: string): MembershipKey {
  return `${workspaceId}:${userId}`;
}

export class FakeHybridWorkspaceRepository implements HybridWorkspaceRepository {
  readonly workspaces = new Map<string, HybridWorkspaceRecord>();
  readonly memberships = new Map<MembershipKey, WorkspaceMembershipRecord>();
  readonly users = new Map<string, { email: string; displayName: string }>();
  readonly invitations: InvitationRecord[] = [];

  constructor() {
    this.workspaces.set(WORKSPACE_A, workspaceRecord(WORKSPACE_A));
    this.workspaces.set(WORKSPACE_B, workspaceRecord(WORKSPACE_B));
    this.users.set(USER_A, {
      email: `${USER_A}@example.test`,
      displayName: USER_A,
    });
    this.users.set(USER_B, {
      email: `${USER_B}@example.test`,
      displayName: USER_B,
    });
    this.memberships.set(
      membershipKey(WORKSPACE_A, USER_A),
      membershipRecord(WORKSPACE_A, USER_A, "staff")
    );
    this.memberships.set(
      membershipKey(WORKSPACE_B, USER_A),
      membershipRecord(WORKSPACE_B, USER_A, "staff")
    );
  }

  addMembership(
    workspaceId: string,
    userId: string,
    role: WorkspaceMemberRole,
    status: WorkspaceMembershipStatus = "active"
  ): void {
    this.memberships.set(
      membershipKey(workspaceId, userId),
      membershipRecord(workspaceId, userId, role, status)
    );
  }

  addUser(userId: string, email = `${userId}@example.test`): void {
    this.users.set(userId, { email, displayName: userId });
  }

  private memberView(
    workspaceId: string,
    membership: WorkspaceMembershipRecord
  ): WorkspaceMemberView {
    const workspace = this.workspaces.get(workspaceId);
    const user = this.users.get(membership.userId);
    return {
      id: membership.id,
      userId: membership.userId,
      email: user?.email ?? null,
      displayName: user?.displayName ?? membership.userId,
      role: membership.role,
      status: membership.status,
      isOwner:
        workspace?.ownerUserId === membership.userId ||
        workspace?.createdBy === membership.userId,
    };
  }

  private invitationView(
    invitation: InvitationRecord,
    includeToken = false
  ): WorkspaceInvitationView {
    const workspace = this.workspaces.get(invitation.workspaceId);
    const inviter = this.users.get(invitation.invitedBy);
    return {
      id: invitation.id,
      workspaceId: invitation.workspaceId,
      workspaceName: workspace?.name,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      ...(includeToken ? { token: invitation.token } : {}),
      expiresAt: invitation.expiresAt,
      invitedAt: invitation.invitedAt,
      invitedBy: invitation.invitedBy,
      invitedByName: inviter?.displayName ?? null,
    };
  }

  async listWorkspaces(userId: string) {
    return [...this.workspaces.values()].filter((workspace) =>
      this.memberships.has(membershipKey(workspace.id, userId))
    );
  }

  async getWorkspace(_userId: string, workspaceId: string) {
    return this.workspaces.get(workspaceId) ?? null;
  }

  async getMembership(userId: string, workspaceId: string) {
    return this.memberships.get(membershipKey(workspaceId, userId)) ?? null;
  }

  async createBusinessWorkspace(userId: string, name: string) {
    const id = `business-${this.workspaces.size + 1}-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}`;
    const workspace: HybridWorkspaceRecord = {
      ...workspaceRecord(id),
      name,
      ownerUserId: userId,
      createdBy: userId,
    };
    this.workspaces.set(id, workspace);
    this.memberships.set(
      membershipKey(id, userId),
      membershipRecord(id, userId, "manager")
    );
    return workspace;
  }

  async listMembers(userId: string, workspaceId: string) {
    const actor = await this.getMembership(userId, workspaceId);
    if (!actor || actor.status !== "active") return [];
    return [...this.memberships.values()]
      .filter((membership) => membership.workspaceId === workspaceId)
      .map((membership) => this.memberView(workspaceId, membership));
  }

  async listInvitations(userId: string, workspaceId: string) {
    const actor = await this.getMembership(userId, workspaceId);
    if (!actor || actor.status !== "active") return [];
    return this.invitations
      .filter((invitation) => invitation.workspaceId === workspaceId)
      .map((invitation) => this.invitationView(invitation));
  }

  async listMyInvitations(userId: string) {
    const email = this.users.get(userId)?.email.toLowerCase() ?? "";
    return this.invitations
      .filter(
        (invitation) =>
          invitation.status === "pending" &&
          (invitation.invitedUserId === userId || invitation.email === email)
      )
      .map((invitation) => this.invitationView(invitation, true));
  }

  async inviteMember(
    userId: string,
    workspaceId: string,
    email: string,
    role: WorkspaceMemberRole
  ) {
    const invitation: InvitationRecord = {
      id: `invitation-${this.invitations.length + 1}`,
      workspaceId,
      email: email.toLowerCase(),
      role,
      token: `token-${this.invitations.length + 1}`,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invitedAt: new Date().toISOString(),
      invitedBy: userId,
      invitedUserId: null,
    };
    this.invitations.push(invitation);
    return this.invitationView(invitation, true);
  }

  async acceptInvitation(
    userId: string,
    token: string
  ): Promise<WorkspaceInvitationResult> {
    const invitation = this.invitations.find(
      (candidate) => candidate.token === token && candidate.status === "pending"
    );
    if (!invitation || Date.parse(invitation.expiresAt) < Date.now()) {
      throw new Error("Invitation not found or expired.");
    }
    const email = this.users.get(userId)?.email.toLowerCase() ?? "";
    if (
      invitation.invitedUserId !== userId &&
      (!email || invitation.email !== email)
    ) {
      throw new Error("Invitation does not belong to this user.");
    }
    invitation.invitedUserId = userId;
    invitation.status = "accepted";
    this.memberships.set(
      membershipKey(invitation.workspaceId, userId),
      membershipRecord(invitation.workspaceId, userId, invitation.role)
    );
    const workspace = this.workspaces.get(invitation.workspaceId);
    if (!workspace) throw new Error("Invitation workspace not found.");
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      role: invitation.role,
    };
  }

  async declineInvitation(userId: string, token: string) {
    const invitation = this.invitations.find(
      (candidate) => candidate.token === token && candidate.status === "pending"
    );
    if (!invitation) throw new Error("Invitation not found.");
    const email = this.users.get(userId)?.email.toLowerCase() ?? "";
    if (
      invitation.invitedUserId !== userId &&
      (!email || invitation.email !== email)
    ) {
      throw new Error("Invitation does not belong to this user.");
    }
    invitation.status = "declined";
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceMemberRole
  ) {
    const key = membershipKey(workspaceId, memberUserId);
    const current = this.memberships.get(key);
    if (!current || !this.memberships.has(membershipKey(workspaceId, userId))) {
      throw new Error("Workspace member not found.");
    }
    const updated: WorkspaceMembershipRecord = { ...current, role };
    this.memberships.set(key, updated);
    return this.memberView(workspaceId, updated);
  }

  async removeMember(
    _userId: string,
    workspaceId: string,
    memberUserId: string
  ) {
    this.memberships.delete(membershipKey(workspaceId, memberUserId));
  }

  async ensurePersonalWorkspace(userId: string) {
    const id = `personal-${userId}`;
    const record: HybridWorkspaceRecord = {
      ...workspaceRecord(id),
      type: "personal",
      ownerUserId: userId,
      createdBy: userId,
    };
    this.workspaces.set(id, record);
    this.memberships.set(
      membershipKey(id, userId),
      membershipRecord(id, userId, "manager")
    );
    return record;
  }
}

function scopeWorkspaceId(scope: WorkspaceProjectScope): string | null {
  return scope.kind === "shared" ? scope.workspaceId : null;
}

export class FakeWorkspaceProjectRepository implements WorkspaceProjectRepository {
  readonly projects: WorkspaceProjectRecord[] = [];
  readonly tasks: WorkspaceTaskRecord[] = [];
  assigneeResolver?: (
    scope: WorkspaceProjectScope,
    assigneeId: string
  ) => Promise<{ readonly id: string; readonly label: string }>;
  createTaskCalls = 0;

  seedProject(
    scope: WorkspaceProjectScope,
    name: string,
    status: WorkspaceProjectRecord["status"] = "active"
  ): WorkspaceProjectRecord {
    const now = new Date().toISOString();
    const project: WorkspaceProjectRecord = {
      id: `project-${this.projects.length + 1}`,
      name,
      status,
      progressNotes: "Approved copy.",
      blockers: [],
      createdAt: now,
      updatedAt: now,
      userId: scope.userId,
      workspaceId: scopeWorkspaceId(scope),
    };
    this.projects.push(project);
    return project;
  }

  private visibleProjects(scope: WorkspaceProjectScope) {
    if (scope.kind === "personal") {
      return this.projects.filter(
        (project) =>
          project.workspaceId === null && project.userId === scope.userId
      );
    }
    return this.projects.filter(
      (project) => project.workspaceId === scope.workspaceId
    );
  }

  async listProjects(
    scope: WorkspaceProjectScope,
    query?: string
  ): Promise<readonly WorkspaceProjectRecord[]> {
    const needle = query?.trim().toLowerCase() ?? "";
    return this.visibleProjects(scope).filter(
      (project) =>
        !needle || project.name.toLowerCase().includes(needle)
    );
  }

  async getProjectById(
    scope: WorkspaceProjectScope,
    projectId: string
  ): Promise<WorkspaceProjectRecord | null> {
    return (
      this.visibleProjects(scope).find((project) => project.id === projectId) ??
      null
    );
  }

  async getProjectsByName(
    scope: WorkspaceProjectScope,
    projectName: string
  ): Promise<readonly WorkspaceProjectRecord[]> {
    return this.visibleProjects(scope).filter(
      (project) =>
        project.name.toLowerCase() === projectName.trim().toLowerCase()
    );
  }

  async listTasks(
    scope: WorkspaceProjectScope,
    projectId: string
  ): Promise<readonly WorkspaceTaskRecord[]> {
    if (scope.kind === "personal") {
      return this.tasks.filter(
        (task) =>
          task.workspaceId === null &&
          task.projectId === projectId &&
          task.userId === scope.userId
      );
    }
    return this.tasks.filter(
      (task) =>
        task.workspaceId === scope.workspaceId && task.projectId === projectId
    );
  }

  async createProject(
    scope: WorkspaceProjectScope,
    input: CreateWorkspaceProjectInput
  ): Promise<WorkspaceProjectRecord> {
    const now = new Date().toISOString();
    const project: WorkspaceProjectRecord = {
      id: `project-${this.projects.length + 1}`,
      name: input.name,
      status: input.status ?? "planned",
      progressNotes: input.progressNotes ?? "",
      blockers: [...(input.blockers ?? [])],
      createdAt: now,
      updatedAt: now,
      userId: scope.userId,
      workspaceId: scopeWorkspaceId(scope),
    };
    this.projects.push(project);
    return project;
  }

  async createTask(
    scope: WorkspaceProjectScope,
    input: CreateWorkspaceTaskInput
  ): Promise<WorkspaceTaskRecord> {
    const parent = this.visibleProjects(scope).find(
      (project) => project.id === input.projectId
    );
    if (!parent) {
      throw new Error("Parent project is not in this workspace.");
    }
    this.createTaskCalls += 1;
    const resolvedAssignee =
      scope.kind === "shared" && input.assigneeId && this.assigneeResolver
        ? await this.assigneeResolver(scope, input.assigneeId)
        : null;
    const task: WorkspaceTaskRecord = {
      id: `task-${this.tasks.length + 1}`,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "medium",
      status: "todo",
      assigneeId: resolvedAssignee?.id ?? input.assigneeId ?? null,
      assignee: resolvedAssignee?.label ?? (input.assignee?.trim() || "Unassigned"),
      createdAt: new Date().toISOString(),
      userId: scope.userId,
      workspaceId: scopeWorkspaceId(scope),
    };
    this.tasks.push(task);
    return task;
  }

  async updateProject(
    scope: WorkspaceProjectScope,
    projectId: string,
    input: UpdateWorkspaceProjectInput
  ): Promise<WorkspaceProjectRecord | null> {
    const index = this.projects.findIndex(
      (project) =>
        project.id === projectId &&
        (scope.kind === "personal"
          ? project.workspaceId === null && project.userId === scope.userId
          : project.workspaceId === scope.workspaceId)
    );
    if (index < 0) return null;
    const current = this.projects[index];
    const updated: WorkspaceProjectRecord = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.progressNotes !== undefined
        ? { progressNotes: input.progressNotes }
        : {}),
      ...(input.blockers !== undefined
        ? { blockers: [...input.blockers] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.projects[index] = updated;
    return updated;
  }

  async updateTask(
    scope: WorkspaceProjectScope,
    taskId: string,
    input: UpdateWorkspaceTaskInput
  ): Promise<WorkspaceTaskRecord | null> {
    const index = this.tasks.findIndex(
      (task) =>
        task.id === taskId &&
        (scope.kind === "personal"
          ? task.workspaceId === null && task.userId === scope.userId
          : task.workspaceId === scope.workspaceId)
    );
    if (index < 0) return null;
    const current = this.tasks[index];
    const resolvedAssignee =
      scope.kind === "shared" && input.assigneeId && this.assigneeResolver
        ? await this.assigneeResolver(scope, input.assigneeId)
        : null;
    const updated: WorkspaceTaskRecord = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      ...(input.assigneeId !== undefined
        ? {
            assigneeId: input.assigneeId,
            assignee:
              input.assigneeId === null
                ? "Unassigned"
                : resolvedAssignee?.label ?? input.assignee ?? current.assignee,
          }
        : {}),
    };
    this.tasks[index] = updated;
    return updated;
  }
}
