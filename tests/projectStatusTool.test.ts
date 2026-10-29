import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_DATA_DISCLOSURE,
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
  REGISTERED_TOOLS,
  ensureDemoDataDisclosure,
  executeRegisteredTool,
} from "../src/tools/projectStatusTool.ts";

function parseContent(
  result: ReturnType<typeof executeRegisteredTool>
): Record<string, unknown> {
  if (!result.ok) assert.fail(result.error);
  return JSON.parse(result.content) as Record<string, unknown>;
}

test("registry exposes only get_project_status", () => {
  assert.equal(REGISTERED_TOOLS.length, 1);
  assert.equal(REGISTERED_TOOLS[0], GET_PROJECT_STATUS_TOOL);
  assert.equal(GET_PROJECT_STATUS_TOOL.function.name, GET_PROJECT_STATUS_TOOL_NAME);
});

test("valid project ID returns the demo record with an explicit notice", () => {
  const result = executeRegisteredTool(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: "prj-104" })
  );
  const payload = parseContent(result);
  const project = payload.project as Record<string, unknown>;

  assert.equal(payload.found, true);
  assert.equal(payload.sampleData, true);
  assert.match(String(payload.notice), /demo/i);
  assert.match(String(payload.notice), /not verified/i);
  assert.equal(project.projectId, "PRJ-104");
  assert.equal(project.name, "Business Support Chatbot");
  assert.equal(project.status, "active");
});

test("unknown project ID returns not found without inventing a record", () => {
  const result = executeRegisteredTool(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: "PRJ-999" })
  );
  const payload = parseContent(result);

  assert.equal(payload.found, false);
  assert.equal(payload.projectId, "PRJ-999");
  assert.equal(payload.sampleData, true);
  assert.equal("project" in payload, false);
  assert.match(String(payload.notice), /no matching project/i);
  assert.match(String(payload.notice), /not verified/i);
});

test("malformed tool arguments are rejected before lookup", () => {
  const invalidArguments = [
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ projectId: 104 }),
    JSON.stringify({ projectId: "" }),
    JSON.stringify({ projectId: "   " }),
    JSON.stringify({ projectId: "PRJ 104" }),
    JSON.stringify({ projectId: "PRJ-104", extra: true }),
    JSON.stringify({ projectId: "P".repeat(40) }),
  ];

  for (const rawArguments of invalidArguments) {
    const result = executeRegisteredTool(
      GET_PROJECT_STATUS_TOOL_NAME,
      rawArguments
    );
    assert.equal(result.ok, false, `expected rejection for ${rawArguments}`);
  }
});

test("unregistered tools are rejected and never executed", () => {
  const result = executeRegisteredTool(
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
