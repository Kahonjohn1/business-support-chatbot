import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_DATA_DISCLOSURE,
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
  LIST_PROJECTS_TOOL_NAME,
  ensureDemoDataDisclosure,
} from "../src/tools/projectStatusTool.ts";
import {
  REGISTERED_TOOLS,
  executeRegisteredTool as executeBase,
  type ToolExecutionContext,
} from "../src/tools/registry.ts";

const VIEWER_AUTH = { userId: "user_test", role: "viewer", isDemo: false } as const;

function execute(
  toolName: string,
  rawArguments: string,
  context: ToolExecutionContext = { requestId: "req_project_status_test" }
): ReturnType<typeof executeBase> {
  return executeBase(toolName, rawArguments, { auth: VIEWER_AUTH, ...context });
}

function parseContent(
  result: ReturnType<typeof executeBase>
): Record<string, unknown> {
  if (!result.ok) assert.fail(result.error);
  return JSON.parse(result.content) as Record<string, unknown>;
}

test("demo tool definitions remain available internally but are not model-facing", () => {
  assert.equal(REGISTERED_TOOLS.length, 0);
  assert.equal(GET_PROJECT_STATUS_TOOL.function.name, GET_PROJECT_STATUS_TOOL_NAME);
});

test("valid project name returns the demo record with an explicit notice", () => {
  const result = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "business support chatbot" })
  );
  const payload = parseContent(result);
  const project = payload.project as Record<string, unknown>;

  assert.equal(payload.found, true);
  assert.equal(payload.sampleData, true);
  assert.match(String(payload.notice), /demo/i);
  assert.match(String(payload.notice), /not verified/i);
  assert.equal(project.name, "Business Support Chatbot");
  assert.equal(project.status, "active");
  assert.equal("projectId" in project, false);
});

test("partial project names resolve to the matching project", () => {
  const result = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "chatbot" })
  );
  const payload = parseContent(result);
  const project = payload.project as Record<string, unknown>;

  assert.equal(payload.found, true);
  assert.equal(project.name, "Business Support Chatbot");
});

test("list_projects returns names without internal identifiers", () => {
  const result = execute(
    LIST_PROJECTS_TOOL_NAME,
    JSON.stringify({})
  );
  const payload = parseContent(result);
  const projects = payload.projects as Array<Record<string, unknown>>;

  assert.equal(payload.total, 1);
  assert.equal(projects[0].name, "Business Support Chatbot");
  assert.equal(projects[0].status, "active");
  assert.equal("projectId" in projects[0], false);
});

test("list_projects searches by project name", () => {
  const result = execute(
    LIST_PROJECTS_TOOL_NAME,
    JSON.stringify({ query: "support" })
  );
  const payload = parseContent(result);
  const projects = payload.projects as Array<Record<string, unknown>>;

  assert.equal(payload.total, 1);
  assert.equal(projects[0].name, "Business Support Chatbot");
  assert.equal("projectId" in projects[0], false);
});

test("the get_project_status schema asks for a name, not an ID", () => {
  const properties = GET_PROJECT_STATUS_TOOL.function.parameters
    .properties as Record<string, unknown>;

  assert.equal("projectName" in properties, true);
  assert.equal("projectId" in properties, false);
});

test("unknown project name returns not found without inventing a record", () => {
  const result = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Mobile App" })
  );
  const payload = parseContent(result);

  assert.equal(payload.found, false);
  assert.equal(payload.status, "not_found");
  assert.equal(payload.projectName, "Mobile App");
  assert.equal("projectId" in payload, false);
  assert.equal(payload.sampleData, true);
  assert.equal("project" in payload, false);
  assert.match(String(payload.notice), /demo/i);
  assert.match(String(payload.notice), /not verified/i);
});

test("malformed tool arguments are rejected before lookup", () => {
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
    JSON.stringify({ projectName: "Business Support Chatbot", extra: true }),
    JSON.stringify({ projectId: 104 }),
    JSON.stringify({ projectId: "" }),
    JSON.stringify({ projectId: "   " }),
    JSON.stringify({ projectId: "PRJ 104" }),
    JSON.stringify({ projectId: "PRJ-104", extra: true }),
    JSON.stringify({ projectId: "P".repeat(40) }),
  ];

  for (const rawArguments of invalidArguments) {
    const result = execute(
      GET_PROJECT_STATUS_TOOL_NAME,
      rawArguments
    );
    assert.equal(result.ok, false, `expected rejection for ${rawArguments}`);
  }
});

test("unregistered tools are rejected and never executed", () => {
  const result = execute(
    "delete_project",
    JSON.stringify({ projectId: "PRJ-104" })
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("unregistered tool must not run");
  assert.match(result.error, /unknown tool/i);
});

test("final answers disclose demo data without duplicating it", () => {
  const withoutDisclosure = ensureDemoDataDisclosure(
    "PRJ-104 is active and in progress."
  );
  assert.ok(withoutDisclosure.endsWith(DEMO_DATA_DISCLOSURE));

  const alreadyDisclosed =
    "PRJ-104 is demo/sample data, not verified company information.";
  assert.equal(ensureDemoDataDisclosure(alreadyDisclosed), alreadyDisclosed);
});

test("demo disclosure is inserted before a trailing Sources line", () => {
  const reply = ensureDemoDataDisclosure("PRJ-104 is active.\n\nSources: KB-001");
  const lines = reply.split("\n");

  assert.equal(lines[lines.length - 1], "Sources: KB-001");
  assert.ok(reply.includes(DEMO_DATA_DISCLOSURE));
});
