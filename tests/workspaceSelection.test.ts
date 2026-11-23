import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleActiveWorkspacePost } from "../src/app/api/workspace/active/route.ts";
import type { HybridWorkspaceRepository } from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  listWorkspaceProjects,
  resetWorkspaceProjectRepository,
  resolveWorkspaceProjectScope,
  setWorkspaceProjectRepository,
} from "../src/lib/workspace/workspaceProjectData.ts";
import {
  ACTIVE_WORKSPACE_COOKIE,
  findWorkspaceOption,
  getWorkspaceAuthForSelection,
  listWorkspaceOptions,
  resolveWorkspaceSelection,
} from "../src/lib/workspace/workspaceSelection.ts";
import type { WorkspaceContext } from "../src/lib/workspace/types.ts";
import { AUTH_A } from "./personalRepositoryStub.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  USER_A,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./workspaceProjectStub.ts";

let hybrid: FakeHybridWorkspaceRepository;
let projects: FakeWorkspaceProjectRepository;

function workspaceContext(userId: string): WorkspaceContext {
  return {
    user: {
      id: userId,
      email: `${userId}@example.test`,
      displayName: userId,
    },
    companies: [],
    activeCompany: null,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/workspace/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  hybrid = new FakeHybridWorkspaceRepository();
  projects = new FakeWorkspaceProjectRepository();
  setHybridWorkspaceRepository(hybrid);
  setWorkspaceProjectRepository(projects);
});

test("workspace options include only the personal workspace and active memberships", async () => {
  hybrid.addMembership(WORKSPACE_B, USER_A, "viewer", "inactive");

  const selection = await listWorkspaceOptions(workspaceContext(USER_A).user);

  assert.deepEqual(
    selection.options.map((option) => option.id).sort(),
    ["personal", WORKSPACE_A].sort()
  );
  assert.equal(findWorkspaceOption(selection.options, WORKSPACE_B), null);
  assert.equal(findWorkspaceOption(selection.options, WORKSPACE_A)?.role, "staff");
});

test("the selection route validates membership before setting the cookie", async () => {
  hybrid.addMembership(WORKSPACE_B, USER_A, "viewer", "inactive");
  const context = workspaceContext(USER_A);

  const allowed = await handleActiveWorkspacePost(
    jsonRequest({ workspaceId: WORKSPACE_A }),
    context
  );
  assert.equal(allowed.status, 200);
  const cookie = allowed.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${ACTIVE_WORKSPACE_COOKIE}=${WORKSPACE_A}`));
  assert.match(cookie, /HttpOnly/i);

  const denied = await handleActiveWorkspacePost(
    jsonRequest({ workspaceId: WORKSPACE_B }),
    context
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("set-cookie"), null);
});

test("an unavailable selection falls back to personal workspace data", async () => {
  const unavailable: HybridWorkspaceRepository = {
    async listWorkspaces() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async getWorkspace() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async getMembership() {
      return null;
    },
    async ensurePersonalWorkspace() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async createBusinessWorkspace() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async listMembers() {
      return [];
    },
    async listInvitations() {
      return [];
    },
    async listMyInvitations() {
      return [];
    },
    async inviteMember() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async acceptInvitation() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async declineInvitation() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async updateMemberRole() {
      throw new Error("relation \"workspaces\" does not exist");
    },
    async removeMember() {
      throw new Error("relation \"workspaces\" does not exist");
    },
  };
  setHybridWorkspaceRepository(unavailable);

  const available = await listWorkspaceOptions(workspaceContext(USER_A).user);
  const selection = resolveWorkspaceSelection(WORKSPACE_A, available);

  assert.equal(selection.active.id, "personal");
  assert.equal(selection.options.length, 1);
  assert.match(selection.unavailableReason ?? "", /pending workspace migration/);
});

test("shared project lists stay isolated by the selected workspace", async () => {
  const context = workspaceContext(USER_A);
  const available = await listWorkspaceOptions(context.user);
  const selectionA = resolveWorkspaceSelection(WORKSPACE_A, available);
  const selectionB = resolveWorkspaceSelection(WORKSPACE_B, available);
  const authA = await getWorkspaceAuthForSelection(context, selectionA);
  const authB = await getWorkspaceAuthForSelection(context, selectionB);
  const scopeA = await resolveWorkspaceProjectScope(authA);
  projects.seedProject(scopeA, "Workspace A only");

  const projectsA = await listWorkspaceProjects(authA);
  const projectsB = await listWorkspaceProjects(authB);

  assert.equal(projectsA.length, 1);
  assert.equal(projectsA[0].workspaceId, WORKSPACE_A);
  assert.equal(projectsB.length, 0);
});

test("personal project access remains unchanged when personal is selected", async () => {
  const context = workspaceContext(AUTH_A.userId);
  const available = await listWorkspaceOptions(context.user);
  const selection = resolveWorkspaceSelection("personal", available);
  const auth = await getWorkspaceAuthForSelection(context, selection);
  projects.seedProject(
    { kind: "personal", userId: AUTH_A.userId },
    "Private Project",
    "active"
  );

  const results = await listWorkspaceProjects(auth);

  assert.equal(auth.workspaceKind, "personal");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Private Project");
  assert.equal(results[0].workspaceId, null);
});
