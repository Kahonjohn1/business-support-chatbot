import { test } from "node:test";
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

const VIEWER_AUTH = { userId: "user_test", role: "viewer", isDemo: false } as const;

function execute(
  toolName: string,
  rawArguments: string,
  context: ToolExecutionContext = { requestId: "req_registry_test" }
): ReturnType<typeof executeBase> {
  return executeBase(toolName, rawArguments, { auth: VIEWER_AUTH, ...context });
}

test("central tool registry retains the demo tool implementation", () => {
  assert.equal(toolRegistry.has(GET_PROJECT_STATUS_TOOL_NAME), true);

  const tool = toolRegistry.get(GET_PROJECT_STATUS_TOOL_NAME);
  assert.ok(tool, "Tool must be found in registry");
  assert.equal(tool.definition.function.name, GET_PROJECT_STATUS_TOOL_NAME);
  assert.equal(typeof tool.handler, "function");
  assert.deepEqual(tool.metadata, {
    readOnly: true,
    destructive: false,
    requiresAuth: false,
    idempotent: true,
  });
});

test("unsafe demo tools are not exposed to the model", () => {
  assert.deepEqual(REGISTERED_TOOLS, []);
  assert.ok(Object.isFrozen(REGISTERED_TOOLS), "REGISTERED_TOOLS should be frozen");
});

test("successful execution: returns structured result, safe content, and execution metadata", () => {
  const context: ToolExecutionContext = {
    requestId: "req_test_success_123",
    toolCallId: "call_abc",
    timestamp: Date.now(),
  };

  const result = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectName: "Business Support Chatbot" }),
    context
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected tool execution to succeed");

  // Structured payload
  const data = result.data as {
    found: boolean;
    sampleData: boolean;
    project: { name: string };
  };
  assert.equal(data.found, true);
  assert.equal(data.sampleData, true);
  assert.equal(data.project.name, "Business Support Chatbot");

  // Model-facing content
  const payload = JSON.parse(result.content);
  assert.equal(payload.found, true);
  assert.equal(payload.sampleData, true);
  assert.equal(payload.project.name, "Business Support Chatbot");
  assert.equal("projectId" in payload.project, false);

  // Metadata / tracing (not in content)
  assert.ok(result.meta);
  assert.equal(result.meta.requestId, "req_test_success_123");
  assert.equal(result.meta.toolCallId, "call_abc");
  assert.ok(typeof result.meta.durationMs === "number" && result.meta.durationMs >= 0);
  assert.ok(typeof result.meta.timestamp === "number" && result.meta.timestamp > 0);
});

test("known tool failure: unknown tool name returns UNKNOWN_TOOL error code", () => {
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

  const context: ToolExecutionContext = {
    requestId: "req_test_unknown_tool",
  };

  const result = customRegistry.execute("non_existent_tool", "{}", context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Unknown tool should fail");
  assert.equal(result.code, "UNKNOWN_TOOL");
  assert.match(result.error, /unknown tool/i);
  assert.ok(result.meta);
  assert.equal(result.meta.requestId, "req_test_unknown_tool");
  assert.equal(executed, false, "No tool handler should be invoked");

  // Central executeRegisteredTool also returns UNKNOWN_TOOL
  const centralResult = execute("unregistered_tool", "{}", context);
  assert.equal(centralResult.ok, false);
  if (centralResult.ok) assert.fail("Unknown tool should fail");
  assert.equal(centralResult.code, "UNKNOWN_TOOL");
  assert.match(centralResult.error, /unknown tool/i);
  assert.ok(centralResult.meta);
  assert.equal(centralResult.meta.requestId, "req_test_unknown_tool");
});

test("known tool failure: invalid arguments return INVALID_ARGUMENTS error code", () => {
  const context: ToolExecutionContext = {
    requestId: "req_test_invalid_args",
  };

  const malformedJsonResult = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    "{ invalid json }",
    context
  );
  assert.equal(malformedJsonResult.ok, false);
  if (malformedJsonResult.ok) assert.fail("Malformed JSON should be rejected");
  assert.equal(malformedJsonResult.code, "INVALID_ARGUMENTS");
  assert.match(malformedJsonResult.error, /json/i);
  assert.ok(malformedJsonResult.meta);
  assert.equal(malformedJsonResult.meta.requestId, "req_test_invalid_args");

  const typeMismatchResult = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: 12345 }),
    context
  );
  assert.equal(typeMismatchResult.ok, false);
  if (typeMismatchResult.ok) assert.fail("Non-string projectId should be rejected");
  assert.equal(typeMismatchResult.code, "INVALID_ARGUMENTS");
  assert.match(typeMismatchResult.error, /string/i);

  const extraKeysResult = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: "PRJ-104", extra: true }),
    context
  );
  assert.equal(extraKeysResult.ok, false);
  if (extraKeysResult.ok) assert.fail("Extra arguments should be rejected");
  assert.equal(extraKeysResult.code, "INVALID_ARGUMENTS");
});

test("invalid result structures: handler returning invalid structure returns INVALID_RESULT", () => {
  const invalidOutputs: unknown[] = [
    null,
    undefined,
    "plain string",
    12345,
    {},
    { ok: "not-a-boolean" },
    { ok: true }, // missing data or content
    { ok: true, data: undefined },
    { ok: false }, // missing error
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

    const result = registry.execute("bad_tool", "{}");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("Invalid output must fail");
    assert.equal(result.code, "INVALID_RESULT");
    assert.match(result.error, /invalid result structure/i);
  }
});

test("unexpected handler exceptions: caught and mapped to EXECUTION_FAILED without crashing", () => {
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

  const context: ToolExecutionContext = {
    requestId: "req_exception_test",
  };

  const result = registry.execute("throwing_tool", "{}", context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Exception should result in failure");
  assert.equal(result.code, "EXECUTION_FAILED");
  assert.equal(result.error, "Internal database connection error");
  assert.ok(result.meta);
  assert.equal(result.meta.requestId, "req_exception_test");
});

test("request ID propagation: passed through context and returned in execution metadata", () => {
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
    handler: (_args, ctx) => {
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

  const result = registry.execute("context_tool", "{}", customContext);
  assert.equal(result.ok, true);
  assert.ok(receivedContext);
  assert.equal(receivedContext.requestId, "api-trace-custom-999");
  assert.equal(receivedContext.toolCallId, "call_custom_456");
  assert.ok(result.meta);
  assert.equal(result.meta.requestId, "api-trace-custom-999");
  assert.equal(result.meta.toolCallId, "call_custom_456");
});

test("safe result formatting for the AI model: strips internal metadata and formats safely", () => {
  // Test formatting for success
  const successFormatted = formatToolResultForModel({
    ok: true,
    data: { found: true, projectId: "PRJ-104", details: "Sample details" },
    meta: { requestId: "internal-req-secret", durationMs: 42, timestamp: 12345 },
  });

  const parsedSuccess = JSON.parse(successFormatted);
  assert.equal(parsedSuccess.found, true);
  assert.equal(parsedSuccess.projectId, "PRJ-104");
  assert.equal("requestId" in parsedSuccess, false);
  assert.equal("durationMs" in parsedSuccess, false);
  assert.equal("meta" in parsedSuccess, false);

  // Test formatting for failure
  const failureFormatted = formatToolResultForModel({
    ok: false,
    error: {
      code: "INVALID_ARGUMENTS",
      message: "Tool arguments must be valid JSON.",
    },
    meta: { requestId: "internal-req-secret", durationMs: 12 },
  });

  const parsedFailure = JSON.parse(failureFormatted);
  assert.equal(parsedFailure.error, "Tool arguments must be valid JSON.");
  assert.equal(parsedFailure.code, "INVALID_ARGUMENTS");
  assert.equal("requestId" in parsedFailure, false);
  assert.equal("durationMs" in parsedFailure, false);
  assert.equal("meta" in parsedFailure, false);
});

test("validateToolHandlerResult accepts both data and string content", () => {
  const withData = validateToolHandlerResult({
    ok: true,
    data: { sample: 1 },
  });
  assert.equal(withData.ok, true);
  if (withData.ok) {
    assert.deepEqual(withData.data, { sample: 1 });
  }

  const withContent = validateToolHandlerResult({
    ok: true,
    content: '{"sample":2}',
  });
  assert.equal(withContent.ok, true);
  if (withContent.ok) {
    assert.deepEqual(withContent.data, { sample: 2 });
  }

  const withStructuredError = validateToolHandlerResult({
    ok: false,
    error: { code: "INVALID_ARGUMENTS", message: "Bad arg" },
  });
  assert.equal(withStructuredError.ok, false);
  if (!withStructuredError.ok) {
    assert.equal(withStructuredError.error.code, "INVALID_ARGUMENTS");
    assert.equal(withStructuredError.error.message, "Bad arg");
  }
});

test("permission-gated tools fail closed without a verified user identity", () => {
  const result = executeBase(
    "create_project_task",
    JSON.stringify({
      projectName: "Business Support Chatbot",
      title: "No authorization",
    }),
    { requestId: "req_no_auth" }
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Missing authorization must be denied");
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.match(result.error, /verified user identity/i);
});

test("model-supplied user ids cannot override the verified context", () => {
  const result = execute(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({
      projectName: "Business Support Chatbot",
      userId: "attacker",
    })
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Untrusted userId must be rejected");
  assert.equal(result.code, "INVALID_ARGUMENTS");
});
