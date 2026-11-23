import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createWorkspaceMembershipAuthorization,
  hasWorkspaceMemberRole,
  toWorkspaceToolRole,
} from "../src/lib/workspace/authorization.ts";
import {
  ensurePersonalHybridWorkspace,
  getHybridWorkspaceRepository,
  hybridWorkspaceUserIdFromAuth,
  requireHybridWorkspaceAccess,
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
  type HybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import type {
  HybridWorkspaceRecord,
  WorkspaceInvitationResult,
  WorkspaceInvitationView,
  WorkspaceMemberRole,
  WorkspaceMemberView,
  WorkspaceMembershipRecord,
} from "../src/lib/workspace/types.ts";

const USER_ID = "user-a";
const OTHER_USER_ID = "user-b";
const WORKSPACE_ID = "workspace-a";
const OTHER_WORKSPACE_ID = "workspace-b";

const AUTH = {
  userId: USER_ID,
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;

function workspace(
  id: string,
  type: HybridWorkspaceRecord["type"] = "business"
): HybridWorkspaceRecord {
  return {
    id,
    type,
    name: type === "personal" ? "Personal workspace" : "Acme",
    ownerUserId: type === "personal" ? USER_ID : null,
    createdBy: USER_ID,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
}

function membership(
  workspaceId: string,
  role: WorkspaceMemberRole,
  status: WorkspaceMembershipRecord["status"] = "active",
  userId = USER_ID
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

class FakeHybridWorkspaceRepository implements HybridWorkspaceRepository {
  readonly workspaces = new Map<string, HybridWorkspaceRecord>();
  readonly memberships = new Map<string, WorkspaceMembershipRecord>();
  ensureCalls = 0;

  constructor() {
    this.workspaces.set(WORKSPACE_ID, workspace(WORKSPACE_ID));
    this.workspaces.set(OTHER_WORKSPACE_ID, workspace(OTHER_WORKSPACE_ID));
    this.memberships.set(WORKSPACE_ID, membership(WORKSPACE_ID, "viewer"));
  }

  async listWorkspaces(userId: string) {
    return [...this.workspaces.values()].filter((record) => {
      const member = this.memberships.get(record.id);
      return record.ownerUserId === userId || member?.userId === userId;
    });
  }

  async getWorkspace(userId: string, workspaceId: string) {
    const record = this.workspaces.get(workspaceId);
    if (!record) return null;
    const member = this.memberships.get(workspaceId);
    if (record.ownerUserId !== userId && member?.userId !== userId) return null;
    return record;
  }

  async getMembership(userId: string, workspaceId: string) {
    const record = this.memberships.get(workspaceId);
    return record?.userId === userId ? record : null;
  }

  private memberView(
    workspaceId: string,
    membership: WorkspaceMembershipRecord
  ): WorkspaceMemberView {
    const workspace = this.workspaces.get(workspaceId);
    return {
      id: membership.id,
      userId: membership.userId,
      email: `${membership.userId}@example.test`,
      displayName: membership.userId,
      role: membership.role,
      status: membership.status,
      isOwner:
        workspace?.ownerUserId === membership.userId ||
        workspace?.createdBy === membership.userId,
    };
  }

  async createBusinessWorkspace(userId: string, name: string) {
    const record = workspace(`business-${this.workspaces.size + 1}`);
    const workspaceRecord: HybridWorkspaceRecord = {
      ...record,
      name,
      ownerUserId: userId,
      createdBy: userId,
    };
    this.workspaces.set(workspaceRecord.id, workspaceRecord);
    this.memberships.set(
      workspaceRecord.id,
      membership(workspaceRecord.id, "manager", "active", userId)
    );
    return workspaceRecord;
  }

  async listMembers(
    _userId: string,
    workspaceId: string
  ): Promise<readonly WorkspaceMemberView[]> {
    const record = this.memberships.get(workspaceId);
    return record ? [this.memberView(workspaceId, record)] : [];
  }

  async listInvitations(): Promise<readonly WorkspaceInvitationView[]> {
    return [];
  }

  async listMyInvitations(): Promise<readonly WorkspaceInvitationView[]> {
    return [];
  }

  async inviteMember(): Promise<WorkspaceInvitationView> {
    throw new Error("Not implemented in this fake repository.");
  }

  async acceptInvitation(): Promise<WorkspaceInvitationResult> {
    throw new Error("Not implemented in this fake repository.");
  }

  async declineInvitation(): Promise<void> {
    throw new Error("Not implemented in this fake repository.");
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceMemberRole
  ): Promise<WorkspaceMemberView> {
    const current = this.memberships.get(workspaceId);
    if (!current || current.userId !== memberUserId || current.userId !== userId) {
      throw new Error("Workspace member not found.");
    }
    const updated = { ...current, role };
    this.memberships.set(workspaceId, updated);
    return this.memberView(workspaceId, updated);
  }

  async removeMember(
    _userId: string,
    workspaceId: string,
    memberUserId: string
  ): Promise<void> {
    const current = this.memberships.get(workspaceId);
    if (current?.userId === memberUserId) this.memberships.delete(workspaceId);
  }

  async ensurePersonalWorkspace(userId: string) {
    this.ensureCalls += 1;
    const personal = workspace("personal-workspace", "personal");
    this.workspaces.set(personal.id, personal);
    this.memberships.set(personal.id, membership(personal.id, "manager", "active", userId));
    return personal;
  }
}

function installRepository(): FakeHybridWorkspaceRepository {
  const repository = new FakeHybridWorkspaceRepository();
  setHybridWorkspaceRepository(repository);
  return repository;
}

test("workspace member roles map without silently granting manager", () => {
  assert.equal(toWorkspaceToolRole("viewer"), "viewer");
  assert.equal(toWorkspaceToolRole("staff"), "operator");
  assert.equal(toWorkspaceToolRole("manager"), "admin");

  assert.equal(hasWorkspaceMemberRole("viewer", "viewer"), true);
  assert.equal(hasWorkspaceMemberRole("viewer", "staff"), false);
  assert.equal(hasWorkspaceMemberRole("staff", "manager"), false);
  assert.equal(hasWorkspaceMemberRole("manager", "staff"), true);
});

test("verified membership authorization rejects mismatched or inactive records", () => {
  const active = createWorkspaceMembershipAuthorization(
    { id: USER_ID, email: "a@example.test", displayName: "A" },
    workspace(WORKSPACE_ID),
    membership(WORKSPACE_ID, "staff")
  );
  assert.deepEqual(active, {
    userId: USER_ID,
    role: "operator",
    workspaceKind: "shared",
    workspaceId: WORKSPACE_ID,
    source: "verified_membership",
    isDemo: false,
  });

  assert.equal(
    createWorkspaceMembershipAuthorization(
      { id: USER_ID, email: "a@example.test", displayName: "A" },
      workspace(WORKSPACE_ID),
      membership(WORKSPACE_ID, "manager", "inactive")
    ),
    null
  );
  assert.equal(
    createWorkspaceMembershipAuthorization(
      { id: USER_ID, email: "a@example.test", displayName: "A" },
      workspace(WORKSPACE_ID),
      membership(WORKSPACE_ID, "manager", "active", OTHER_USER_ID)
    ),
    null
  );
  assert.equal(
    createWorkspaceMembershipAuthorization(
      { id: USER_ID, email: "a@example.test", displayName: "A" },
      workspace(WORKSPACE_ID),
      membership(OTHER_WORKSPACE_ID, "manager")
    ),
    null
  );
});

test("workspace repository wrappers use server-verified identity only", () => {
  const repository = installRepository();
  try {
    assert.equal(hybridWorkspaceUserIdFromAuth(AUTH), USER_ID);
    assert.throws(
      () => hybridWorkspaceUserIdFromAuth({ userId: "   " }),
      /Authentication required/
    );
    assert.equal(getHybridWorkspaceRepository(), repository);
  } finally {
    resetHybridWorkspaceRepository();
  }
});

test("workspace access requires active membership and the requested role", async () => {
  const repository = installRepository();
  try {
    await assert.rejects(
      requireHybridWorkspaceAccess(AUTH, OTHER_WORKSPACE_ID),
      /Workspace not found/
    );

    const viewer = await requireHybridWorkspaceAccess(AUTH, WORKSPACE_ID);
    assert.equal(viewer.membership.role, "viewer");

    await assert.rejects(
      requireHybridWorkspaceAccess(AUTH, WORKSPACE_ID, "staff"),
      /Insufficient workspace role/
    );

    repository.memberships.set(
      WORKSPACE_ID,
      membership(WORKSPACE_ID, "viewer", "inactive")
    );
    await assert.rejects(
      requireHybridWorkspaceAccess(AUTH, WORKSPACE_ID),
      /active membership/
    );

    repository.memberships.set(WORKSPACE_ID, membership(WORKSPACE_ID, "staff"));
    const staff = await requireHybridWorkspaceAccess(AUTH, WORKSPACE_ID, "staff");
    assert.equal(staff.membership.status, "active");
  } finally {
    resetHybridWorkspaceRepository();
  }
});

test("personal workspace creation goes through the repository boundary", async () => {
  const repository = installRepository();
  try {
    const created = await ensurePersonalHybridWorkspace(AUTH);
    assert.equal(created.type, "personal");
    assert.equal(created.ownerUserId, USER_ID);
    assert.equal(repository.ensureCalls, 1);

    const personalMembership = await repository.getMembership(
      USER_ID,
      created.id
    );
    assert.equal(personalMembership?.role, "manager");
    assert.equal(personalMembership?.status, "active");
  } finally {
    resetHybridWorkspaceRepository();
  }
});
