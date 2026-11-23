import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_PROJECT_TOOL,
  CREATE_PROJECT_TOOL_NAME,
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
  LIST_PROJECTS_TOOL_NAME,
  TOOL_USE_INSTRUCTION,
} from "../src/tools/projectStatusTool.ts";
import {
  clearApprovals,
  getApprovalRequest,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import {
  REGISTERED_TOOLS,
  executeRegisteredTool as executeBase,
  type ToolExecutionContext,
} from "../src/tools/registry.ts";
import {
  AUTH_A,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";

let repository: FakePersonalRepository;

function execute(
  toolName: string,
  rawArguments: string,
  context: ToolExecutionContext = { requestId: "req_project_status_test" }
) {
  return executeBase(toolName, rawArguments, { auth: AUTH_A, ...context });
}

async function parseContent(result: Awaited<ReturnType<typeof executeBase>>) {
  if (!result.ok) assert.fail(result.error);
  return JSON.parse(result.content) as Record<string, unknown>;
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetPersonalRepository();
  repository = installPersonalRepository(new FakePersonalRepository());
  seedProject(repository, AUTH_A.userId, "Website Redesign", "active");
});

const NEW_PROJECT_ARGS = {
  name: "Mobile App",
  status: "active",
  progressNotes: "Kickoff notes",
  blockers: ["Waiting on brand assets"],
};

async function prepareProjectApproval() {
  const rawArguments = JSON.stringify(NEW_PROJECT_ARGS);
  const result = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_A,
  });
  if (!result.ok) assert.fail(result.error);
  const data = result.data as { status: string; approvalId?: string };
  assert.equal(data.status, "pending_approval");
  assert.ok(data.approvalId);
  return { rawArguments, approvalId: data.approvalId as string };
}

test("personal tools are registered and model-facing", () => {
  const names = REGISTERED_TOOLS.map((tool) => tool.function.name);
  assert.deepEqual(names.sort(), [
    "check_integration_calendar_availability",
    "create_project",
    "create_project_task",
    "get_project_status",
    "list_automation_workflows",
    "list_integration_calendar_events",
    "list_project_tasks",
    "list_projects",
    "prepare_automation_workflow",
    "prepare_integration_calendar_event",
    "prepare_integration_email_draft",
    "propose_automation_workflow",
    "read_integration_email",
    "search_integration_email",
    "update_project",
    "update_project_task",
  ]);
  assert.ok(Object.isFrozen(REGISTERED_TOOLS));
  assert.equal(
    GET_PROJECT_STATUS_TOOL.function.name,
    GET_PROJECT_STATUS_TOOL_NAME
  );
});

test("tool-use instructions map explicit save and task requests to tools", () => {
  assert.match(TOOL_USE_INSTRUCTION, /Save this as a project/);
  assert.match(TOOL_USE_INSTRUCTION, /Store this in my workspace/);
  assert.match(TOOL_USE_INSTRUCTION, /Turn this plan into a project/);
  assert.match(TOOL_USE_INSTRUCTION, /Create a project for this plan/);
  assert.match(TOOL_USE_INSTRUCTION, /Do not only write a plan and imply that it has been saved/i);
  assert.match(TOOL_USE_INSTRUCTION, /Create the associated tasks/);
  assert.match(TOOL_USE_INSTRUCTION, /Add these tasks to the project/);
  assert.match(TOOL_USE_INSTRUCTION, /Break this project into tasks and save them/);
  assert.match(TOOL_USE_INSTRUCTION, /automatically displays an approval prompt/i);
  assert.match(
    TOOL_USE_INSTRUCTION,
    /instead of merely asking for approval in ordinary text/i
  );
  assert.match(
    TOOL_USE_INSTRUCTION,
    /First prepare the project-creation operation/i
  );
  assert.match(TOOL_USE_INSTRUCTION, /Wait for the user to approve it/i);
  assert.match(
    TOOL_USE_INSTRUCTION,
    /Never create tasks against a project that is still pending approval or does not exist/i
  );
  assert.match(
    TOOL_USE_INSTRUCTION,
    /Never claim a project or task was created until an execution result confirms it/i
  );
});

test("get_project_status reads the authenticated user's real record", async () => {
  const result = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "website redesign" })
  );
  const payload = await parseContent(result);
  const project = payload.project as Record<string, unknown>;

  assert.equal(payload.found, true);
  assert.equal(payload.status, "ok");
  assert.equal(project.name, "Website Redesign");
  assert.equal(project.status, "active");
  assert.equal(project.progressNotes, "Draft copy approved.");
  assert.equal("sampleData" in payload, false);
  assert.equal("sampleData" in project, false);
  assert.equal("projectId" in project, false);
  assert.equal("userId" in project, false);
});

test("list_projects returns only names and statuses from the database", async () => {
  const result = await execute(LIST_PROJECTS_TOOL_NAME, JSON.stringify({}));
  const payload = await parseContent(result);
  const projects = payload.projects as Array<Record<string, unknown>>;

  assert.equal(payload.total, 1);
  assert.equal(projects[0].name, "Website Redesign");
  assert.equal(projects[0].status, "active");
  assert.equal("projectId" in projects[0], false);
  assert.equal("userId" in projects[0], false);
});

test("list_projects searches personal data by name fragment", async () => {
  seedProject(repository, AUTH_A.userId, "Mobile App", "planned");
  const result = await execute(
    LIST_PROJECTS_TOOL_NAME,
    JSON.stringify({ query: "mobile" })
  );
  const payload = await parseContent(result);
  const projects = payload.projects as Array<Record<string, unknown>>;

  assert.equal(payload.total, 1);
  assert.equal(projects[0].name, "Mobile App");
});

test("the get_project_status schema asks for a name, not an ID or user ID", () => {
  const properties = GET_PROJECT_STATUS_TOOL.function.parameters
    .properties as Record<string, unknown>;

  assert.equal("projectName" in properties, true);
  assert.equal("projectId" in properties, false);
  assert.equal("userId" in properties, false);
});

test("unknown project name returns not found without inventing a record", async () => {
  const result = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Mobile App" })
  );
  const payload = await parseContent(result);

  assert.equal(payload.found, false);
  assert.equal(payload.status, "not_found");
  assert.equal(payload.projectName, "Mobile App");
  assert.equal("sampleData" in payload, false);
  assert.equal("project" in payload, false);
});

test("malformed tool arguments are rejected before lookup", async () => {
  const invalidArguments = [
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ projectName: 104 }),
    JSON.stringify({ projectName: "" }),
    JSON.stringify({ projectName: "   " }),
    JSON.stringify({ projectName: "P".repeat(121) }),
    JSON.stringify({ projectName: "Website Redesign", extra: true }),
    JSON.stringify({ projectId: 104 }),
    JSON.stringify({ projectId: "" }),
    JSON.stringify({ projectId: "PRJ 104" }),
    JSON.stringify({ projectId: "PRJ-104", extra: true }),
  ];

  for (const rawArguments of invalidArguments) {
    const result = await execute(GET_PROJECT_STATUS_TOOL_NAME, rawArguments);
    assert.equal(result.ok, false, `expected rejection for ${rawArguments}`);
  }
});

test("unregistered tools are rejected and never executed", async () => {
  const result = await execute(
    "delete_project",
    JSON.stringify({ projectName: "Website Redesign" })
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("unregistered tool must not run");
  assert.match(result.error, /unknown tool/i);
});

test("database errors fail closed instead of returning success", async () => {
  repository.failures.add("getProjectsByName");

  const result = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Website Redesign" })
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("database failure must not return data");
  assert.equal(result.code, "EXECUTION_FAILED");
});

test("create_project is registered, model-facing, and accepts no identity arguments", () => {
  assert.ok(
    REGISTERED_TOOLS.some((tool) => tool.function.name === CREATE_PROJECT_TOOL_NAME)
  );
  const properties = CREATE_PROJECT_TOOL.function.parameters
    .properties as Record<string, unknown>;

  assert.equal("name" in properties, true);
  assert.equal("userId" in properties, false);
  assert.equal("user_id" in properties, false);
  assert.equal("approvalId" in properties, false);
  assert.deepEqual(CREATE_PROJECT_TOOL.function.parameters.required, ["name"]);
  assert.equal(CREATE_PROJECT_TOOL.function.parameters.additionalProperties, false);
});

test("create_project requires a verified user identity", async () => {
  const result = await execute(CREATE_PROJECT_TOOL_NAME, JSON.stringify(NEW_PROJECT_ARGS), {
    requestId: "req_create_project_test",
    auth: undefined,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("missing identity must be denied");
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.equal(repository.projects.length, 1);
});

test("create_project prepares an approval without writing a project", async () => {
  const { approvalId } = await prepareProjectApproval();
  const approval = getApprovalRequest(approvalId);

  assert.equal(approval?.status, "pending");
  assert.equal(approval?.toolName, CREATE_PROJECT_TOOL_NAME);
  assert.equal(approval?.userId, AUTH_A.userId);
  assert.equal(approval?.details.name, NEW_PROJECT_ARGS.name);
  assert.equal("userId" in (approval?.details ?? {}), false);
  assert.equal("projectId" in (approval?.details ?? {}), false);
  assert.equal(repository.projects.length, 1);
});

test("create_project rejects model-supplied identity and approval arguments", async () => {
  const rawArguments = JSON.stringify({ name: "Mobile App", userId: AUTH_B.userId });
  const result = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_A,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("model-supplied userId must be rejected");
  assert.equal(result.code, "INVALID_ARGUMENTS");
  assert.equal(repository.projects.length, 1);
});

test("create_project validation failures never create an approval", async () => {
  const invalidArguments = [
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ name: "" }),
    JSON.stringify({ name: "   " }),
    JSON.stringify({ name: "P".repeat(121) }),
    JSON.stringify({ name: "Mobile App", status: "unknown" }),
    JSON.stringify({ name: "Mobile App", progressNotes: "x".repeat(501) }),
    JSON.stringify({ name: "Mobile App", blockers: "not an array" }),
    JSON.stringify({ name: "Mobile App", blockers: [42] }),
    JSON.stringify({ name: "Mobile App", blockers: ["x".repeat(201)] }),
    JSON.stringify({ name: "Mobile App", blockers: new Array(11).fill("blocker") }),
    JSON.stringify({ name: "Mobile App", approvalId: "appr_forged" }),
    JSON.stringify({ name: "Mobile App", user_id: AUTH_B.userId }),
  ];

  for (const rawArguments of invalidArguments) {
    const result = await execute(CREATE_PROJECT_TOOL_NAME, rawArguments);
    assert.equal(result.ok, false, `expected rejection for ${rawArguments}`);
    assert.equal(repository.projects.length, 1);
  }
  assert.equal(getApprovalRequest("appr_forged"), undefined);
});

test("an existing personal project name prevents a duplicate approval", async () => {
  const result = await execute(
    CREATE_PROJECT_TOOL_NAME,
    JSON.stringify({ name: "Website Redesign" })
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected an already_exists result");
  assert.equal((result.data as { status: string }).status, "already_exists");
  assert.equal(repository.projects.length, 1);
  assert.equal(getApprovalRequest("appr_nonexistent"), undefined);
});

test("an approved create_project creates the real project and replays are idempotent", async () => {
  const { rawArguments, approvalId } = await prepareProjectApproval();
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);

  const executionContext = { requestId: "req_create_project_test", auth: AUTH_A, approvalId };
  const result = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, executionContext);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected approved creation to succeed");

  const data = result.data as {
    status: string;
    project: { name: string; status: string; progressNotes: string; blockers: string[] };
  };
  assert.equal(data.status, "executed");
  assert.equal(data.project.name, NEW_PROJECT_ARGS.name);
  assert.equal(data.project.status, NEW_PROJECT_ARGS.status);
  assert.equal(data.project.progressNotes, NEW_PROJECT_ARGS.progressNotes);
  assert.deepEqual(data.project.blockers, NEW_PROJECT_ARGS.blockers);
  assert.equal("projectId" in data.project, false);
  assert.equal("userId" in data.project, false);
  assert.equal(repository.projects.length, 2);
  assert.equal(repository.projects[1].userId, AUTH_A.userId);

  const replay = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, executionContext);
  assert.equal(replay.ok, true);
  if (!replay.ok) assert.fail("expected idempotent replay");
  assert.deepEqual(replay.data, data);
  assert.equal(repository.projects.length, 2);
  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
});

test("create_project approval is bound to its request, arguments, and user", async () => {
  const { rawArguments, approvalId } = await prepareProjectApproval();
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);

  const wrongRequest = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_different",
    auth: AUTH_A,
    approvalId,
  });
  assert.equal(wrongRequest.ok, false);
  if (wrongRequest.ok) assert.fail("cross-request approval must fail");
  assert.equal(wrongRequest.code, "INVALID_ARGUMENTS");

  const wrongUser = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_B,
    approvalId,
  });
  assert.equal(wrongUser.ok, false);
  if (wrongUser.ok) assert.fail("cross-user approval must fail");
  assert.equal(wrongUser.code, "PERMISSION_DENIED");

  const tampered = await executeBase(
    CREATE_PROJECT_TOOL_NAME,
    JSON.stringify({ ...NEW_PROJECT_ARGS, name: "Tampered App" }),
    { requestId: "req_create_project_test", auth: AUTH_A, approvalId }
  );
  assert.equal(tampered.ok, false);
  if (tampered.ok) assert.fail("tampered arguments must fail");
  assert.equal(tampered.code, "INVALID_ARGUMENTS");

  const original = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_A,
    approvalId,
  });
  assert.equal(original.ok, true);
  assert.equal(repository.projects.length, 2);
});

test("unapproved create_project executions cannot create a project", async () => {
  const { rawArguments, approvalId } = await prepareProjectApproval();

  const beforeDecision = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_A,
    approvalId,
  });
  assert.equal(beforeDecision.ok, false);
  if (beforeDecision.ok) assert.fail("pending approval must not execute");
  assert.equal(beforeDecision.code, "EXECUTION_FAILED");
  assert.equal(repository.projects.length, 1);

  submitApprovalDecision(approvalId, "reject", AUTH_A.userId);
  assert.equal(getApprovalRequest(approvalId)?.status, "rejected");
  assert.equal(repository.projects.length, 1);
});

test("database failure during approved project creation marks the approval failed", async () => {
  const { rawArguments, approvalId } = await prepareProjectApproval();
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);
  repository.failures.add("createProject");

  const result = await executeBase(CREATE_PROJECT_TOOL_NAME, rawArguments, {
    requestId: "req_create_project_test",
    auth: AUTH_A,
    approvalId,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("database failure must not report success");
  assert.equal(result.code, "EXECUTION_FAILED");
  assert.equal(getApprovalRequest(approvalId)?.status, "failed");
  assert.equal(repository.projects.length, 1);
});
