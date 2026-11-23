import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  createWorkspaceProject,
  createWorkspaceTask,
  findWorkspaceProjectsByName,
  getWorkspaceProjectById,
  listWorkspaceProjects,
  listWorkspaceTasks,
  resetWorkspaceProjectRepository,
  resolveWorkspaceProjectScope,
  setWorkspaceProjectRepository,
  verifiedWorkspaceIdFromAuth,
} from "../src/lib/workspace/workspaceProjectData.ts";
import { AUTH_A, FakePersonalRepository, installPersonalRepository, resetPersonalRepository } from "./personalRepositoryStub.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  USER_A,
  USER_B,
  WORKSPACE_A,
  WORKSPACE_B,
  sharedAuth,
} from "./workspaceProjectStub.ts";

let hybrid: FakeHybridWorkspaceRepository;
let projects: FakeWorkspaceProjectRepository;

beforeEach(() => {
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  resetPersonalRepository();
  hybrid = new FakeHybridWorkspaceRepository();
  projects = new FakeWorkspaceProjectRepository();
  setHybridWorkspaceRepository(hybrid);
  setWorkspaceProjectRepository(projects);
});

test("personal contexts continue using the personal repository", async () => {
  resetWorkspaceProjectRepository();
  const personal = installPersonalRepository(new FakePersonalRepository());
  personal.projects.push({
    id: "personal-project",
    name: "Private Plan",
    status: "planned",
    progressNotes: "",
    blockers: [],
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    userId: AUTH_A.userId,
  });

  const listed = await listWorkspaceProjects(AUTH_A);
  const found = await getWorkspaceProjectById(AUTH_A, "personal-project");

  assert.deepEqual(listed.map((project) => project.name), ["Private Plan"]);
  assert.equal(listed[0].workspaceId, null);
  assert.equal(found?.id, "personal-project");
  assert.equal(projects.projects.length, 0);
});

test("personal contexts cannot carry a workspace id", async () => {
  await assert.rejects(
    resolveWorkspaceProjectScope({
      ...AUTH_A,
      workspaceId: WORKSPACE_A,
    }),
    /Personal data cannot carry a workspace id/
  );
});

test("shared reads use active membership and workspace-scoped data", async () => {
  const staff = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const viewer = sharedAuth(WORKSPACE_A, USER_B, "viewer");
  hybrid.addMembership(WORKSPACE_A, USER_B, "viewer");
  const scope = await resolveWorkspaceProjectScope(staff);
  projects.seedProject(scope, "Shared Roadmap");

  const staffProjects = await listWorkspaceProjects(staff);
  const viewerProjects = await listWorkspaceProjects(viewer);
  const byName = await findWorkspaceProjectsByName(viewer, "Shared Roadmap");

  assert.deepEqual(staffProjects.map((project) => project.name), ["Shared Roadmap"]);
  assert.deepEqual(viewerProjects.map((project) => project.name), ["Shared Roadmap"]);
  assert.equal(byName.length, 1);
  assert.equal(await verifiedWorkspaceIdFromAuth(staff), WORKSPACE_A);
});

test("viewer membership permits reads but not writes", async () => {
  const viewer = sharedAuth(WORKSPACE_A, USER_B, "viewer");
  hybrid.addMembership(WORKSPACE_A, USER_B, "viewer");

  await assert.rejects(
    createWorkspaceProject(viewer, { name: "Forbidden" }),
    /Insufficient workspace role/
  );
});

test("shared writes bind workspace and ownership to server-verified scope", async () => {
  const staff = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const created = await createWorkspaceProject(
    staff,
    {
      name: "Shared Delivery",
      ...({ workspaceId: WORKSPACE_B, userId: USER_B } as Record<string, unknown>),
    }
  );

  assert.equal(created.workspaceId, WORKSPACE_A);
  assert.equal(created.userId, USER_A);

  const task = await createWorkspaceTask(staff, {
    projectId: created.id,
    title: "Prepare launch checklist",
  });
  assert.equal(task.workspaceId, WORKSPACE_A);
  assert.equal(task.userId, USER_A);
  assert.equal((await listWorkspaceTasks(staff, created.id)).length, 1);
});

test("hybrid membership verification rejects unverified workspace ids", async () => {
  const spoofed = {
    ...sharedAuth(WORKSPACE_A, USER_B, "staff"),
    workspaceId: WORKSPACE_B,
  };

  await assert.rejects(
    createWorkspaceProject(spoofed, { name: "Spoofed" }),
    /active membership|Workspace not found|Insufficient workspace role/
  );
});
