import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { GET_PROJECT_STATUS_TOOL_NAME } from "../src/tools/projectStatusTool.ts";
import {
  REGISTERED_TOOLS,
  ToolRegistry,
  executeRegisteredTool as executeBase,
  formatToolResultForModel,
  toolRegistry,
  validateToolHandlerResult,
  type StructuredToolOutput,
  type ToolExecutionContext,
} from "../src/tools/registry.ts";
import {
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";

const VIEWER_AUTH = {
  userId: "user_test",
  role: "viewer",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;

function execute(
  toolName: string,
  rawArguments: string,
  context: ToolExecutionContext = { requestId: "req_registry_test" }
) {
  return executeBase(toolName, rawArguments, {
    auth: context.auth ?? VIEWER_AUTH,
    ...context,
  });
}

beforeEach(() => {
  resetPersonalRepository();
  const repository = installPersonalRepository(new FakePersonalRepository());
  seedProject(repository, "user_test", "Website Redesign", "active");
});

test("central tool registry keeps the personal project tools", () => {
  assert.equal(toolRegistry.has(GET_PROJECT_STATUS_TOOL_NAME), true);

  const tool = toolRegistry.get(GET_PROJECT_STATUS_TOOL_NAME);
  assert.ok(tool, "Tool must be found in registry");
  assert.equal(tool.definition.function.name, GET_PROJECT_STATUS_TOOL_NAME);
  assert.equal(typeof tool.handler, "function");
  assert.deepEqual(tool.metadata, {
    readOnly: true,
    destructive: false,
    requiresAuth: true,
    idempotent: true,
  });
});

test("personal tools are model-facing after their database implementation", () => {
  assert.equal(REGISTERED_TOOLS.length, 16);
  assert.ok(Object.isFrozen(REGISTERED_TOOLS));
  const names = REGISTERED_TOOLS.map((tool) => tool.function.name);
  assert.ok(names.includes(GET_PROJECT_STATUS_TOOL_NAME));
  assert.ok(names.includes("create_project"));
  assert.ok(names.includes("create_project_task"));
});

test("successful async execution returns structured result and metadata", async () => {
  const context: ToolExecutionContext = {
    requestId: "req_test_success_123",
    toolCallId: "call_abc",
    timestamp: Date.now(),
  };

  const result = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Website Redesign" }),
    context
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected tool execution to succeed");

  const data = result.data as {
    found: boolean;
    project: { name: string };
  };
  assert.equal(data.found, true);
  assert.equal(data.project.name, "Website Redesign");

  const payload = JSON.parse(result.content);
  assert.equal(payload.found, true);
  assert.equal(payload.project.name, "Website Redesign");
  assert.equal("projectId" in payload.project, false);

  assert.ok(result.meta);
  assert.equal(result.meta.requestId, "req_test_success_123");
  assert.equal(result.meta.toolCallId, "call_abc");
  assert.ok(typeof result.meta.durationMs === "number" && result.meta.durationMs >= 0);
  assert.ok(typeof result.meta.timestamp === "number" && result.meta.timestamp > 0);
});

test("unknown tool names return UNKNOWN_TOOL and run no handler", async () => {
  let executed = false;
  const customRegistry = new ToolRegistry();
  customRegistry.register({
    definition: {
      type: "function",
      function: {
        name: "sample_tool",
        description: "A sample tool",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: () => {
      executed = true;
      return { ok: true, data: "ok" };
    },
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  const context: ToolExecutionContext = { requestId: "req_test_unknown_tool" };
  const result = await customRegistry.execute("non_existent_tool", "{}", context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Unknown tool should fail");
  assert.equal(result.code, "UNKNOWN_TOOL");
  assert.equal(executed, false);

  const centralResult = await execute("unregistered_tool", "{}", context);
  assert.equal(centralResult.ok, false);
  if (centralResult.ok) assert.fail("Unknown tool should fail");
  assert.equal(centralResult.code, "UNKNOWN_TOOL");
});

test("invalid arguments return INVALID_ARGUMENTS", async () => {
  const context: ToolExecutionContext = { requestId: "req_test_invalid_args" };

  const malformed = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    "{ invalid json }",
    context
  );
  assert.equal(malformed.ok, false);
  if (malformed.ok) assert.fail("Malformed JSON should be rejected");
  assert.equal(malformed.code, "INVALID_ARGUMENTS");

  const typeMismatch = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: 12345 }),
    context
  );
  assert.equal(typeMismatch.ok, false);
  if (typeMismatch.ok) assert.fail("Non-string projectId should be rejected");
  assert.equal(typeMismatch.code, "INVALID_ARGUMENTS");

  const extraKeys = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Website Redesign", extra: true }),
    context
  );
  assert.equal(extraKeys.ok, false);
  if (extraKeys.ok) assert.fail("Extra arguments should be rejected");
  assert.equal(extraKeys.code, "INVALID_ARGUMENTS");
});

test("invalid result structures return INVALID_RESULT", async () => {
  const invalidOutputs: unknown[] = [
    null,
    undefined,
    "plain string",
    12345,
    {},
    { ok: "not-a-boolean" },
    { ok: true },
    { ok: true, data: undefined },
    { ok: false },
    { ok: false, error: "" },
  ];

  for (const invalidOutput of invalidOutputs) {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        type: "function",
        function: {
          name: "bad_tool",
          description: "Returns invalid output",
          parameters: { type: "object", properties: {} },
        },
      },
      handler: () => invalidOutput as unknown as StructuredToolOutput,
      metadata: {
        readOnly: true,
        destructive: false,
        requiresAuth: false,
        idempotent: true,
      },
    });

    const result = await registry.execute("bad_tool", "{}");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("Invalid output must fail");
    assert.equal(result.code, "INVALID_RESULT");
  }
});

test("handler exceptions map to EXECUTION_FAILED", async () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      type: "function",
      function: {
        name: "throwing_tool",
        description: "throws",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: () => {
      throw new Error("Internal database connection error");
    },
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  const result = await registry.execute("throwing_tool", "{}", {
    requestId: "req_exception_test",
  });
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Exception should result in failure");
  assert.equal(result.code, "EXECUTION_FAILED");
  assert.equal(result.error, "Internal database connection error");
});

test("request ID propagation through async execution", async () => {
  let receivedContext: ToolExecutionContext | undefined;

  const registry = new ToolRegistry();
  registry.register({
    definition: {
      type: "function",
      function: {
        name: "context_tool",
        description: "Checks context",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: async (_args, ctx) => {
      await Promise.resolve();
      receivedContext = ctx;
      return { ok: true, data: { status: "received" } };
    },
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  const customContext: ToolExecutionContext = {
    requestId: "api-trace-custom-999",
    toolCallId: "call_custom_456",
    timestamp: 1700000000000,
  };

  const result = await registry.execute("context_tool", "{}", customContext);
  assert.equal(result.ok, true);
  assert.ok(receivedContext);
  assert.equal(receivedContext.requestId, "api-trace-custom-999");
  assert.equal(receivedContext.toolCallId, "call_custom_456");
  assert.equal(result.meta?.requestId, "api-trace-custom-999");
});

test("safe result formatting strips internal metadata", () => {
  const successFormatted = formatToolResultForModel({
    ok: true,
    data: { found: true, projectId: "PRJ-104", details: "Sample details" },
    meta: { requestId: "internal-req-secret", durationMs: 42, timestamp: 12345 },
  });
  const parsedSuccess = JSON.parse(successFormatted);
  assert.equal(parsedSuccess.found, true);
  assert.equal("meta" in parsedSuccess, false);

  const failureFormatted = formatToolResultForModel({
    ok: false,
    error: {
      code: "INVALID_ARGUMENTS",
      message: "Tool arguments must be valid JSON.",
    },
  });
  const parsedFailure = JSON.parse(failureFormatted);
  assert.equal(parsedFailure.code, "INVALID_ARGUMENTS");
});

test("validateToolHandlerResult accepts both data and string content", () => {
  const withData = validateToolHandlerResult({ ok: true, data: { sample: 1 } });
  assert.equal(withData.ok, true);

  const withContent = validateToolHandlerResult({
    ok: true,
    content: '{"sample":2}',
  });
  assert.equal(withContent.ok, true);

  const withStructuredError = validateToolHandlerResult({
    ok: false,
    error: { code: "INVALID_ARGUMENTS", message: "Bad arg" },
  });
  assert.equal(withStructuredError.ok, false);
});

test("permission-gated tools fail closed without a verified user identity", async () => {
  const result = await executeBase(
    "create_project_task",
    JSON.stringify({ projectName: "Website Redesign", title: "No authorization" }),
    { requestId: "req_no_auth" }
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Missing authorization must be denied");
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.match(result.error, /verified user identity/i);
});

test("model-supplied user ids cannot override the verified context", async () => {
  const result = await execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Website Redesign", userId: "attacker" })
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Untrusted userId must be rejected");
  assert.equal(result.code, "INVALID_ARGUMENTS");
});
