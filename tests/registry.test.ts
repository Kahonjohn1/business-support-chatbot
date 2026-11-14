import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolDefinition } from "../src/lib/toolCalling.ts";
import {
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
} from "../src/tools/projectStatusTool.ts";
import {
  REGISTERED_TOOLS,
  ToolRegistry,
  executeRegisteredTool,
  toolRegistry,
} from "../src/tools/registry.ts";

test("central tool registry registers get_project_status", () => {
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

test("model-facing REGISTERED_TOOLS is derived directly from the registry", () => {
  const definitions = toolRegistry.getDefinitions();
  assert.equal(REGISTERED_TOOLS.length, definitions.length);
  assert.equal(REGISTERED_TOOLS.length, 1);
  assert.equal(REGISTERED_TOOLS[0], GET_PROJECT_STATUS_TOOL);
  assert.equal(REGISTERED_TOOLS[0].function.name, GET_PROJECT_STATUS_TOOL_NAME);
  assert.ok(Object.isFrozen(REGISTERED_TOOLS), "REGISTERED_TOOLS should be frozen");
});

test("registered get_project_status executes successfully via the registry", () => {
  const result = executeRegisteredTool(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: "PRJ-104" })
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected tool execution to succeed");

  const payload = JSON.parse(result.content);
  assert.equal(payload.found, true);
  assert.equal(payload.sampleData, true);
  assert.equal(payload.project.projectId, "PRJ-104");
  assert.equal(payload.project.name, "Business Support Chatbot");
});

test("unknown tool names return a safe error without executing anything", () => {
  let executed = false;
  const customRegistry = new ToolRegistry();
  customRegistry.register({
    definition: {
      type: "function",
      function: {
        name: "test_tool",
        description: "A test tool",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: () => {
      executed = true;
      return { ok: true, content: "ok" };
    },
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  const result = customRegistry.execute("non_existent_tool", "{}");
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Unknown tool should fail");
  assert.match(result.error, /unknown tool/i);
  assert.equal(executed, false, "No tool handler should be invoked");

  // Also verify through the central executeRegisteredTool function
  const centralResult = executeRegisteredTool("unregistered_tool", "{}");
  assert.equal(centralResult.ok, false);
  if (centralResult.ok) assert.fail("Unknown tool should fail");
  assert.match(centralResult.error, /unknown tool/i);
});

test("invalid tool arguments are safely rejected", () => {
  const result = executeRegisteredTool(
    GET_PROJECT_STATUS_TOOL_NAME,
    "{ invalid json }"
  );
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Malformed JSON should be rejected");
  assert.match(result.error, /json/i);

  const typeMismatch = executeRegisteredTool(
    GET_PROJECT_STATUS_TOOL_NAME,
    JSON.stringify({ projectId: 12345 })
  );
  assert.equal(typeMismatch.ok, false);
  if (typeMismatch.ok) assert.fail("Non-string projectId should be rejected");
  assert.match(typeMismatch.error, /string/i);
});

test("ToolRegistry rejects duplicate registrations", () => {
  const registry = new ToolRegistry();
  const sampleDef: ToolDefinition = {
    type: "function",
    function: {
      name: "sample_tool",
      description: "sample",
      parameters: { type: "object", properties: {} },
    },
  };

  registry.register({
    definition: sampleDef,
    handler: () => ({ ok: true, content: "" }),
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  assert.throws(
    () =>
      registry.register({
        definition: sampleDef,
        handler: () => ({ ok: true, content: "" }),
        metadata: {
          readOnly: true,
          destructive: false,
          requiresAuth: false,
          idempotent: true,
        },
      }),
    /already registered/i
  );
});

test("ToolRegistry safely catches unhandled handler exceptions", () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      type: "function",
      function: {
        name: "buggy_tool",
        description: "throws",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: () => {
      throw new Error("Internal handler failure");
    },
    metadata: {
      readOnly: true,
      destructive: false,
      requiresAuth: false,
      idempotent: true,
    },
  });

  const result = registry.execute("buggy_tool", "{}");
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Exception should result in failure");
  assert.equal(result.error, "Internal handler failure");
});
