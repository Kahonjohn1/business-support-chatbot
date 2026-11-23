import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleAcceptTeamInvitation } from "../src/app/api/team/invitations/accept/route.ts";
import { handleCreateTeamInvitation } from "../src/app/api/team/invitations/route.ts";
import {
  handleRemoveTeamMember,
  handleUpdateTeamMember,
} from "../src/app/api/team/members/[userId]/route.ts";
import { handleCreateTask } from "../src/app/api/tasks/route.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import { requireWorkspaceAssignee } from "../src/lib/workspace/workspaceTeamData.ts";
import {
  resetWorkspaceProjectRepository,
  setWorkspaceProjectRepository,
} from "../src/lib/workspace/workspaceProjectData.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  USER_A,
  USER_B,
  WORKSPACE_A,
  sharedAuth,
} from "./workspaceProjectStub.ts";

const OWNER_USER = USER_A;
const OTHER_MANAGER = "manager-b";
const PERSONAL_AUTH_B = {
  userId: USER_B,
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/team", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

let hybrid: FakeHybridWorkspaceRepository;
let projects: FakeWorkspaceProjectRepository;

beforeEach(() => {
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  hybrid = new FakeHybridWorkspaceRepository();
  hybrid.addUser(USER_B);
  hybrid.addUser(OTHER_MANAGER);
  hybrid.addMembership(WORKSPACE_A, OTHER_MANAGER, "manager");
  projects = new FakeWorkspaceProjectRepository();
  projects.assigneeResolver = (scope, assigneeId) => {
    if (scope.kind !== "shared") {
      throw new Error("A shared workspace is required.");
    }
    return requireWorkspaceAssignee(
      sharedAuth(scope.workspaceId, scope.userId, "staff"),
      assigneeId
    );
  };
  setHybridWorkspaceRepository(hybrid);
  setWorkspaceProjectRepository(projects);
});

test("team invitations are accepted only by the invited identity", async () => {
  const managerAuth = sharedAuth(WORKSPACE_A, OTHER_MANAGER, "manager");
  const invitationResponse = await handleCreateTeamInvitation(
    jsonRequest({ email: `${USER_B}@example.test`, role: "viewer" }),
    managerAuth
  );
  assert.equal(invitationResponse.status, 200);
  const invitationBody = (await invitationResponse.json()) as {
    invitation: { token: string; role: string };
  };
  assert.ok(invitationBody.invitation.token);
  assert.equal(invitationBody.invitation.role, "viewer");

  const acceptedResponse = await handleAcceptTeamInvitation(
    jsonRequest({ token: invitationBody.invitation.token }),
    PERSONAL_AUTH_B
  );
  assert.equal(acceptedResponse.status, 200);
  const membership = await hybrid.getMembership(USER_B, WORKSPACE_A);
  assert.equal(membership?.role, "viewer");
  assert.equal(membership?.status, "active");

  const duplicateResponse = await handleAcceptTeamInvitation(
    jsonRequest({ token: invitationBody.invitation.token }),
    PERSONAL_AUTH_B
  );
  assert.equal(duplicateResponse.status, 400);
});

test("team management protects owners and limits manager changes to owners", async () => {
  const nonOwnerManagerAuth = sharedAuth(WORKSPACE_A, OTHER_MANAGER, "manager");
  hybrid.addMembership(WORKSPACE_A, OTHER_MANAGER, "manager");
  hybrid.addMembership(WORKSPACE_A, USER_B, "staff");

  const ownerResponse = await handleUpdateTeamMember(
    jsonRequest({ role: "viewer" }),
    nonOwnerManagerAuth,
    OWNER_USER
  );
  assert.equal(ownerResponse.status, 403);

  const managerResponse = await handleUpdateTeamMember(
    jsonRequest({ role: "staff" }),
    nonOwnerManagerAuth,
    USER_B
  );
  assert.equal(managerResponse.status, 200);

  const appointResponse = await handleUpdateTeamMember(
    jsonRequest({ role: "manager" }),
    nonOwnerManagerAuth,
    USER_B
  );
  assert.equal(appointResponse.status, 403);

  const removeResponse = await handleRemoveTeamMember(
    nonOwnerManagerAuth,
    USER_B
  );
  assert.equal(removeResponse.status, 200);
  assert.equal(await hybrid.getMembership(USER_B, WORKSPACE_A), null);
});

test("task assignment accepts active members and rejects non-members", async () => {
  hybrid.addMembership(WORKSPACE_A, USER_B, "viewer");
  projects.seedProject(
    {
      kind: "shared",
      userId: USER_A,
      workspaceId: WORKSPACE_A,
      workspace: hybrid.workspaces.get(WORKSPACE_A)!,
      membership: hybrid.memberships.get(`${WORKSPACE_A}:${USER_A}`)!,
    },
    "Shared Launch"
  );
  const auth = sharedAuth(WORKSPACE_A, USER_A, "staff");

  const assignedResponse = await handleCreateTask(
    jsonRequest({
      projectId: "project-1",
      title: "Assign teammate",
      assigneeId: USER_B,
    }),
    auth
  );
  assert.equal(assignedResponse.status, 200);
  assert.equal(projects.tasks[0]?.assigneeId, USER_B);
  assert.equal(projects.tasks[0]?.assignee, USER_B);

  const invalidResponse = await handleCreateTask(
    jsonRequest({
      projectId: "project-1",
      title: "Invalid teammate",
      assigneeId: "not-a-member",
    }),
    auth
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(projects.tasks.length, 1);

  const personalResponse = await handleCreateTask(
    jsonRequest({
      projectId: "project-1",
      title: "Personal assignment",
      assigneeId: USER_B,
    }),
    PERSONAL_AUTH_B
  );
  assert.equal(personalResponse.status, 400);
});
