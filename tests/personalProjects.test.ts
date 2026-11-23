import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PersonalDataError,
  createPersonalProject,
  createPersonalTask,
  getPersonalProjectById,
  listPersonalProjects,
  listPersonalTasks,
  personalUserIdFromAuth,
} from "../src/lib/personalProjectData.ts";
import {
  AUTH_A,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
  seedTask,
} from "./personalRepositoryStub.ts";

let repository: FakePersonalRepository;

beforeEach(() => {
  resetPersonalRepository();
  repository = installPersonalRepository(new FakePersonalRepository());
  seedProject(repository, AUTH_A.userId, "Website Redesign", "active");
  seedProject(repository, AUTH_B.userId, "Private Roadmap", "planned");
});

test("personal user IDs come only from server authorization contexts", () => {
  assert.equal(personalUserIdFromAuth(AUTH_A), AUTH_A.userId);
  assert.throws(() => personalUserIdFromAuth(undefined), PersonalDataError);
  assert.throws(() => personalUserIdFromAuth({}), PersonalDataError);
  assert.throws(() => personalUserIdFromAuth({ userId: "   " }), PersonalDataError);
});

test("users can list only their own projects", async () => {
  const forA = await listPersonalProjects(AUTH_A);
  const forB = await listPersonalProjects(AUTH_B);

  assert.deepEqual(
    forA.map((project) => project.name),
    ["Website Redesign"]
  );
  assert.deepEqual(
    forB.map((project) => project.name),
    ["Private Roadmap"]
  );
});

test("direct project access never crosses user boundaries", async () => {
  const owned = await getPersonalProjectById(
    AUTH_A,
    repository.projects[0].id
  );
  const foreign = await getPersonalProjectById(
    AUTH_A,
    repository.projects[1].id
  );

  assert.equal(owned?.name, "Website Redesign");
  assert.equal(owned?.userId, AUTH_A.userId);
  assert.equal(foreign, null);
});

test("project creation derives ownership from auth, not model input", async () => {
  const created = await createPersonalProject(AUTH_A, {
    name: "New personal project",
    status: "planned",
    ...({ userId: AUTH_B.userId } as Record<string, unknown>),
  });

  assert.equal(created.userId, AUTH_A.userId);
  assert.equal(repository.projects.length, 3);
});

test("task creation and listing stay inside the authenticated owner", async () => {
  const projectA = repository.projects[0];
  const projectB = repository.projects[1];
  seedTask(repository, AUTH_B.userId, projectB.id, "Foreign task");

  const created = await createPersonalTask(AUTH_A, {
    projectId: projectA.id,
    title: "Owner task",
  });
  const tasksA = await listPersonalTasks(AUTH_A, projectA.id);
  const tasksB = await listPersonalTasks(AUTH_B, projectB.id);

  assert.equal(created.userId, AUTH_A.userId);
  assert.deepEqual(
    tasksA.map((task) => task.title),
    ["Owner task"]
  );
  assert.deepEqual(
    tasksB.map((task) => task.title),
    ["Foreign task"]
  );
});

test("a task cannot be created against another user's project", async () => {
  await assert.rejects(
    createPersonalTask(AUTH_A, {
      projectId: repository.projects[1].id,
      title: "Cross-user task",
    }),
    /parent project does not belong/i
  );
  assert.equal(repository.tasks.length, 0);
});

test("the personal repository never queries company_id", () => {
  const source = readFileSync(
    new URL("../src/lib/personalProjectData.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /company_id/);
  assert.doesNotMatch(source, /companyId/);
});
