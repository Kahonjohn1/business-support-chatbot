import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolCall } from "../src/lib/toolCalling.ts";
import {
  EMPLOYEE_ASSISTANT_TOOLS,
  assertToolExecutionAllowed,
  authorizeAssistantTool,
  buildApprovalRequest,
  companyResourceAllowed,
  parseAssistantToolArguments,
  requiresApproval,
  type AssistantToolContext,
} from "../src/lib/employee/assistantTools.ts";
import {
  runEmployeeToolLoop,
  type AssistantToolLoopMessage,
} from "../src/lib/employee/assistantToolLoop.ts";

const COMPANY_ID = "3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80";
const OTHER_COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function context(
  role: AssistantToolContext["role"] = "staff",
  companyRole: AssistantToolContext["companyRole"] = "operator"
): AssistantToolContext {
  return { userId: USER_ID, role, companyId: COMPANY_ID, companyRole };
}

function call(id: string, name: string, args: string): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function toolMessage(message: {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string;
}): AssistantToolLoopMessage {
  return {
    role: "tool",
    content: message.content,
    tool_call_id: message.tool_call_id,
    name: message.name,
  };
}

test("assistant registry only exposes narrow, company-scoped tools", () => {
  const names = EMPLOYEE_ASSISTANT_TOOLS.map((tool) => tool.function.name);
  assert.deepEqual(names, [
    "search_projects",
    "get_project_details",
    "list_tasks",
    "get_task_details",
    "check_approvals",
    "request_task_status_change",
  ]);

  for (const tool of EMPLOYEE_ASSISTANT_TOOLS) {
    const parameters = tool.function.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    assert.equal(parameters.additionalProperties, false, `${tool.function.name} rejects extra keys`);
    const keys = Object.keys(parameters.properties ?? {});
    for (const forbidden of ["companyId", "company_id", "userId", "user_id", "role"]) {
      assert.equal(keys.includes(forbidden), false, `${tool.function.name} rejects ${forbidden}`);
    }
  }
});

test("tool authorization follows employee and company permissions", () => {
  assert.equal(authorizeAssistantTool(context("viewer"), "search_projects").ok, true);
  assert.equal(authorizeAssistantTool(context("staff"), "list_tasks").ok, true);
  assert.equal(authorizeAssistantTool(context("staff"), "check_approvals").ok, false);
  assert.equal(authorizeAssistantTool(context("manager"), "check_approvals").ok, true);
  assert.equal(authorizeAssistantTool(context("manager", "viewer"), "check_approvals").ok, true);

  assert.equal(
    authorizeAssistantTool(context("staff", "viewer"), "request_task_status_change").ok,
    false
  );
  assert.equal(
    authorizeAssistantTool(context("viewer", "owner"), "request_task_status_change").ok,
    false
  );
  assert.equal(
    authorizeAssistantTool(context("staff", "operator"), "request_task_status_change").ok,
    true
  );
  assert.equal(
    authorizeAssistantTool(context("admin", "owner"), "request_task_status_change").ok,
    true
  );
  assert.equal(authorizeAssistantTool(context("admin", "customer"), "delete_project").ok, false);
});

test("approval-required tools need an approved request before execution", () => {
  assert.equal(requiresApproval("request_task_status_change"), true);
  assert.equal(requiresApproval("list_tasks"), false);
  assert.equal(
    assertToolExecutionAllowed(context("admin", "owner"), "request_task_status_change").ok,
    false
  );
  assert.equal(
    assertToolExecutionAllowed(context("admin", "owner"), "request_task_status_change", "pending").ok,
    false
  );
  assert.equal(
    assertToolExecutionAllowed(context("admin", "owner"), "request_task_status_change", "approved").ok,
    true
  );
});

test("resource company checks reject cross-company access", () => {
  assert.equal(companyResourceAllowed(context(), COMPANY_ID), true);
  assert.equal(companyResourceAllowed(context(), OTHER_COMPANY_ID), false);
  assert.equal(companyResourceAllowed(context(), null), false);
});

test("assistant operational reads rely on session RLS instead of removed company_id columns", async () => {
  const runtimeSource = await readFile(
    new URL("../src/lib/employee/assistantToolRuntime.ts", import.meta.url),
    "utf8"
  );

  assert.equal(/\.eq\(["']company_id["']/.test(runtimeSource), false);
  assert.equal(/\.in\(["']company_id["']/.test(runtimeSource), false);
  assert.equal(runtimeSource.includes('.select("id, company_id'), false);
  assert.equal(runtimeSource.includes('"id, company_id, status, task_code"'), false);
});

test("tool argument parsing rejects identifier injection and unsupported arguments", () => {
  const valid = parseAssistantToolArguments(
    "search_projects",
    JSON.stringify({ query: "rollout", status: "active", limit: 10 })
  );
  assert.equal(valid.ok, true);

  const companyInjection = parseAssistantToolArguments(
    "search_projects",
    JSON.stringify({ companyId: OTHER_COMPANY_ID })
  );
  assert.equal(companyInjection.ok, false);

  const userInjection = parseAssistantToolArguments(
    "list_tasks",
    JSON.stringify({ userId: USER_ID, assignedToMe: true })
  );
  assert.equal(userInjection.ok, false);

  const badLimit = parseAssistantToolArguments("list_tasks", JSON.stringify({ limit: 51 }));
  assert.equal(badLimit.ok, false);

  const bothProjectIds = parseAssistantToolArguments(
    "get_project_details",
    JSON.stringify({ projectId: PROJECT_ID, projectCode: "PRJ-104" })
  );
  assert.equal(bothProjectIds.ok, false);

  const missingTask = parseAssistantToolArguments("get_task_details", JSON.stringify({}));
  assert.equal(missingTask.ok, false);

  const badTask = parseAssistantToolArguments(
    "request_task_status_change",
    JSON.stringify({ taskId: "not-a-uuid", status: "done" })
  );
  assert.equal(badTask.ok, false);

  const invalidJson = parseAssistantToolArguments("search_projects", "{");
  assert.equal(invalidJson.ok, false);
});

test("approval drafts are pending, session-owned, and never apply the status change", () => {
  const now = new Date("2026-11-24T10:00:00.000Z");
  const args = parseAssistantToolArguments(
    "request_task_status_change",
    JSON.stringify({ taskId: TASK_ID, status: "done", reason: "Client sign-off received" })
  );
  assert.equal(args.ok, true);
  if (!args.ok || args.args.tool !== "request_task_status_change") return;

  const draft = buildApprovalRequest(context(), args.args, {
    now,
    approvalRef: "appr_test_ref",
    requestId: "request_test",
    fromStatus: "in_progress",
  });

  assert.equal(draft.status, "pending");
  assert.equal(draft.user_id, USER_ID);
  assert.equal("company_id" in draft, false);
  assert.equal(draft.requested_by, USER_ID);
  assert.equal(draft.tool_name, "request_task_status_change");
  assert.equal(draft.approval_ref, "appr_test_ref");
  assert.equal(draft.request_id, "request_test");
  assert.equal(draft.expires_at, "2026-11-25T10:00:00.000Z");
  assert.equal(draft.details.fromStatus, "in_progress");
  assert.equal(draft.details.toStatus, "done");
  assert.equal(draft.details.reason, "Client sign-off received");
  assert.equal(draft.details.source, "employee_assistant");
  assert.equal("status" in draft, true);
  assert.equal("taskId" in JSON.parse(draft.raw_arguments), true);
});

test("employee tool loop executes registered tools and returns a grounded final answer", async () => {
  const requests: Array<{ toolChoice: string }> = [];
  const executed: string[] = [];
  const events: string[] = [];
  const toolCall = call("call_1", "search_projects", JSON.stringify({ limit: 10 }));

  const result = await runEmployeeToolLoop({
    messages: [{ role: "user", content: "Which projects are active?" }],
    tools: EMPLOYEE_ASSISTANT_TOOLS,
    createToolMessage: toolMessage,
    executeTool: async (toolName, rawArguments) => {
      executed.push(`${toolName}:${rawArguments}`);
      return { ok: true, content: JSON.stringify({ count: 1 }) };
    },
    onToolResult: (event) => events.push(event.toolName),
    callModel: async (request) => {
      requests.push({ toolChoice: request.toolChoice });
      if (requests.length === 1) {
        return {
          content: null,
          toolCalls: [toolCall],
          assistantMessage: { role: "assistant", content: null, tool_calls: [toolCall] },
        };
      }
      return {
        content: "One active project was found.",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "One active project was found." },
      };
    },
  });

  assert.equal(result.content, "One active project was found.");
  assert.deepEqual(result.usedToolNames, ["search_projects"]);
  assert.deepEqual(requests, [{ toolChoice: "auto" }, { toolChoice: "auto" }]);
  assert.deepEqual(executed, ['search_projects:{"limit":10}']);
  assert.deepEqual(events, ["search_projects"]);
});

test("employee tool loop returns execution errors to the model without claiming success", async () => {
  const executed: string[] = [];
  const toolResults: string[] = [];
  const toolCall = call("call_bad", "delete_project", "{}");

  const result = await runEmployeeToolLoop({
    messages: [{ role: "user", content: "Delete the project." }],
    tools: EMPLOYEE_ASSISTANT_TOOLS,
    createToolMessage: toolMessage,
    executeTool: async (toolName) => {
      executed.push(toolName);
      return { ok: false, error: "Unknown tool. No tool was executed." };
    },
    callModel: async (request) => {
      const resultMessage = request.messages.find((message) => message.role === "tool");
      if (resultMessage && typeof resultMessage.content === "string") {
        toolResults.push(resultMessage.content);
      }
      if (toolResults.length === 0) {
        return {
          content: null,
          toolCalls: [toolCall],
          assistantMessage: { role: "assistant", content: null, tool_calls: [toolCall] },
        };
      }
      return {
        content: "That operation is not allowed.",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "That operation is not allowed." },
      };
    },
  });

  assert.equal(result.content, "That operation is not allowed.");
  assert.deepEqual(result.usedToolNames, []);
  assert.deepEqual(executed, ["delete_project"]);
  assert.deepEqual(toolResults, [JSON.stringify({ error: "Unknown tool. No tool was executed." })]);
});
