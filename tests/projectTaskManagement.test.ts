import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createTaskCode,
  normalizeProjectCode,
  parseCreateProjectPayload,
  parseCreateTaskPayload,
  parseTaskStatusPayload,
  suggestProjectCode,
} from "../src/lib/employee/projectTaskInput.ts";
import {
  createMarqueProject,
  createMarqueTask,
  getTaskAssigneeOptions,
  updateAssignedTaskStatus,
  type ManagementContext,
} from "../src/lib/employee/projectTaskManagement.ts";
import { MARQUE_TECHNOLOGIES_COMPANY_ID } from "../src/lib/employee/companyInvitations.ts";

const actorId = "8901ff75-d21b-4c8f-84fb-d63443d27938";
const projectId = "3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80";
const assigneeId = "29d7d192-5b89-4d6f-b6e6-d91b840e6f0f";
const taskId = "6e3b1c0a-9f2d-4e18-8a6b-0c7d5e2f1a34";

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string; code?: string } };
type RpcResult<T> = { data: T; error: null } | { data: null; error: { message: string } };

interface MockOptions {
  membership?: QueryResult<{ role: string; status: string } | null>;
  projectCheck?: RpcResult<boolean>;
  assigneeCheck?: RpcResult<boolean>;
  statusResult?: RpcResult<unknown>;
  insertError?: { message: string; code?: string } | null;
  assigneeRows?: Array<{ id: string; full_name: string | null }>;
}

interface MockBuilder {
  select(): MockBuilder;
  eq(column: string, value: string): MockBuilder;
  order(): Promise<QueryResult<unknown>>;
  maybeSingle(): Promise<QueryResult<unknown>>;
  insert(
    payload: Record<string, unknown>
  ): { select(): { maybeSingle(): Promise<QueryResult<{ id: string }>> } };
}

function makeClient(options: MockOptions = {}) {
  const calls = {
    membershipFilters: [] as Array<Record<string, string>>,
    rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
    inserts: [] as Array<Record<string, unknown>>,
    codeChecks: [] as string[],
  };

  function createBuilder(table: string): MockBuilder {
    const filters: Record<string, string> = {};

    const builder: MockBuilder = {
      select: () => builder,
      eq: (column, value) => {
        filters[column] = value;
        if (table === "company_memberships" || table === "employee_profiles") {
          calls.membershipFilters.push({ [column]: value });
        }
        if (table === "tasks" && column === "task_code") {
          calls.codeChecks.push(value);
        }
        return builder;
      },
      order: async () => ({
        data: options.assigneeRows ?? [],
        error: null,
      }),
      maybeSingle: async () => {
        if (table === "company_memberships") {
          return (
            options.membership ?? {
              data: { role: "owner", status: "active" },
              error: null,
            }
          );
        }
        return { data: null, error: null };
      },
      insert: (payload) => {
        calls.inserts.push(payload);
        return {
          select: () => ({
            maybeSingle: async () =>
              ({
                data: options.insertError ? null : { id: "created-id" },
                error: options.insertError ?? null,
              }) as QueryResult<{ id: string }>,
          }),
        };
      },
    };

    return builder;
  }

  const client = {
    from: (table: string) => createBuilder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name === "is_marque_project") {
        return options.projectCheck ?? { data: true, error: null };
      }
      if (name === "can_assign_task_to") {
        return options.assigneeCheck ?? { data: true, error: null };
      }
      if (name === "update_my_marque_task_status") {
        return options.statusResult ?? { data: null, error: null };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function context(client: SupabaseClient, role: "staff" | "manager" | "admin" = "manager"): ManagementContext {
  return { sessionClient: client, actorId, actorRole: role };
}

function projectInput() {
  return {
    name: "Customer support portal",
    projectCode: "CUSTOMER-SUPPORT-PORTAL-Y9ZDW5",
    summary: "One place for support delivery.",
    status: "active" as const,
  };
}

function taskInput() {
  return {
    projectId,
    title: "Prepare delivery timeline",
    description: "Share the first draft.",
    assigneeId,
    priority: "high" as const,
    dueDate: "2026-12-01T00:00:00.000Z",
  };
}

test("project and task payload parsers normalize values and reject invalid input", () => {
  assert.equal(normalizeProjectCode(" customer_support  portal "), "CUSTOMER-SUPPORT-PORTAL");
  assert.match(suggestProjectCode("Support Portal"), /^SUPPORT-PORTAL-[A-Z0-9]{6}$/);
  assert.match(createTaskCode("abc-def-ghij"), /^TASK-ABCD.*$/);

  const project = parseCreateProjectPayload({
    name: "  Support portal ",
    projectCode: "support_portal",
    summary: "  Notes ",
    status: "active",
  });
  assert.deepEqual(project, {
    ok: true,
    value: {
      name: "Support portal",
      projectCode: "SUPPORT-PORTAL",
      summary: "Notes",
      status: "active",
    },
  });
  assert.equal(parseCreateProjectPayload({ name: "Ok", projectCode: "OK", status: "active" }).ok, false);
  assert.equal(
    parseCreateProjectPayload({ name: "Valid name", projectCode: "VALID", status: "unknown" }).ok,
    false
  );

  const task = parseCreateTaskPayload({
    projectId,
    title: "  Draft the plan ",
    description: "  Details ",
    assigneeId,
    priority: "medium",
    dueDate: "2026-12-01",
  });
  assert.equal(task.ok, true);
  if (task.ok) {
    assert.equal(task.value.title, "Draft the plan");
    assert.equal(task.value.dueDate, "2026-12-01T00:00:00.000Z");
  }
  assert.equal(
    parseCreateTaskPayload({
      projectId,
      title: "Draft the plan",
      assigneeId,
      priority: "urgent",
      dueDate: null,
    }).ok,
    false
  );
  assert.equal(
    parseCreateTaskPayload({
      projectId,
      title: "Draft the plan",
      assigneeId,
      priority: "low",
      dueDate: "2026-02-30",
    }).ok,
    false
  );
  assert.equal(parseTaskStatusPayload({ taskId, status: "in_progress" }).ok, true);
  assert.equal(parseTaskStatusPayload({ taskId: "bad-id", status: "done" }).ok, false);
});

test("project creation requires an active Marque manager and stores session ownership", async () => {
  const deniedRole = await createMarqueProject(context(makeClient().client, "staff"), projectInput());
  assert.equal(deniedRole.ok, false);
  if (!deniedRole.ok) assert.equal(deniedRole.status, 403);

  const deniedMembership = makeClient({
    membership: { data: { role: "viewer", status: "active" }, error: null },
  });
  const denied = await createMarqueProject(context(deniedMembership.client), projectInput());
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);

  const { client, calls } = makeClient();
  const result = await createMarqueProject(context(client), projectInput());
  assert.equal(result.ok, true);
  assert.deepEqual(calls.inserts[0], {
    name: "Customer support portal",
    project_code: "CUSTOMER-SUPPORT-PORTAL-Y9ZDW5",
    status: "active",
    progress_notes: "One place for support delivery.",
    user_id: actorId,
    created_by: actorId,
  });
  assert.ok(
    calls.membershipFilters.some((item) => item.company_id === MARQUE_TECHNOLOGIES_COMPANY_ID)
  );
});

test("project creation maps a duplicate code to a conflict", async () => {
  const { client } = makeClient({ insertError: { message: "duplicate key", code: "23505" } });
  const result = await createMarqueProject(context(client), projectInput());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /project code/i);
  }
});

test("task creation verifies the project and assignee before inserting a generated code", async () => {
  const { client, calls } = makeClient();
  const result = await createMarqueTask(context(client), taskInput());

  assert.equal(result.ok, true);
  assert.deepEqual(calls.rpc.map((call) => call.name), ["is_marque_project", "can_assign_task_to"]);
  assert.deepEqual(calls.rpc[0].args, { p_project_id: projectId });
  assert.deepEqual(calls.rpc[1].args, { p_assignee_user_id: assigneeId });

  const inserted = calls.inserts[0];
  assert.match(String(inserted.task_code), /^TASK-[A-Z0-9]{8}$/);
  assert.equal(inserted.title, "Prepare delivery timeline");
  assert.equal(inserted.project_id, projectId);
  assert.equal(inserted.assignee_id, assigneeId);
  assert.equal(inserted.user_id, actorId);
  assert.equal(inserted.created_by, actorId);
  assert.equal(inserted.status, "todo");
  assert.equal(inserted.priority, "high");
  assert.equal(inserted.due_date, "2026-12-01T00:00:00.000Z");
  assert.equal(calls.codeChecks.length, 1);
});

test("task creation rejects an employee who cannot be assigned work", async () => {
  const { client, calls } = makeClient({
    assigneeCheck: { data: false, error: null },
  });
  const result = await createMarqueTask(context(client), taskInput());

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
  assert.equal(calls.inserts.length, 0);
});

test("status updates call the assigned-task RPC and map permission failures", async () => {
  const success = makeClient();
  const updated = await updateAssignedTaskStatus(success.client, {
    taskId,
    status: "done",
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(success.calls.rpc, [
    { name: "update_my_marque_task_status", args: { p_task_id: taskId, p_status: "done" } },
  ]);

  const denied = makeClient({
    statusResult: { data: null, error: { message: "task not found or not assigned to current employee" } },
  });
  const result = await updateAssignedTaskStatus(denied.client, {
    taskId,
    status: "done",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("assignee options come from active employee profiles", async () => {
  const { client, calls } = makeClient({
    assigneeRows: [{ id: assigneeId, full_name: "  Alex Morgan  " }],
  });
  const options = await getTaskAssigneeOptions(client);

  assert.deepEqual(options, [{ id: assigneeId, name: "Alex Morgan" }]);
  assert.ok(calls.membershipFilters.some((item) => item.status === "active"));
});

test("workflow routes use only the authenticated server client", () => {
  const routes = [
    "src/app/api/employee/projects/route.ts",
    "src/app/api/employee/tasks/route.ts",
    "src/app/api/employee/tasks/status/route.ts",
  ];
  const root = process.cwd();

  for (const route of routes) {
    const source = readFileSync(`${root}/${route}`, "utf8");
    assert.equal(source.includes("createAdminClient"), false, route);
    assert.equal(source.includes("service_role"), false, route);
    assert.ok(source.includes("getEmployeeSession()"), route);
  }
});
