import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TOOL_CALLS,
  ToolLoopError,
  parseToolCalls,
  runToolLoop,
  type ToolCall,
  type ToolMessage,
  type ToolModelRequest,
} from "../src/lib/toolCalling.ts";
import {
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
  executeRegisteredTool,
} from "../src/tools/projectStatusTool.ts";

interface TestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

function call(
  id: string,
  name: string,
  args: string
): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: args },
  };
}

function toolMessage(message: ToolMessage): TestMessage {
  return {
    role: "tool",
    content: message.content,
    tool_call_id: message.tool_call_id,
    name: message.name,
  };
}

test("a registered tool call executes and the loop returns the final answer", async () => {
  const requests: ToolModelRequest<TestMessage>[] = [];
  const executed: Array<{ name: string; args: string }> = [];

  const result = await runToolLoop<TestMessage>({
    messages: [{ role: "user", content: "What is the status of PRJ-104?" }],
    tools: [GET_PROJECT_STATUS_TOOL],
    executeTool: (name, args) => {
      executed.push({ name, args });
      return {
        ok: true,
        content: JSON.stringify({ found: true, sampleData: true }),
      };
    },
    createToolMessage: toolMessage,
    callModel: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        const toolCall = call(
          "call_1",
          GET_PROJECT_STATUS_TOOL_NAME,
          JSON.stringify({ projectId: "PRJ-104" })
        );
        return {
          content: null,
          toolCalls: [toolCall],
          assistantMessage: {
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          },
        };
      }
      return {
        content: "PRJ-104 is active.",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "PRJ-104 is active." },
      };
    },
  });

  assert.equal(result.content, "PRJ-104 is active.");
  assert.deepEqual(result.usedToolNames, [GET_PROJECT_STATUS_TOOL_NAME]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].toolChoice, "auto");
  assert.deepEqual(executed, [
    {
      name: GET_PROJECT_STATUS_TOOL_NAME,
      args: JSON.stringify({ projectId: "PRJ-104" }),
    },
  ]);
});

test("unregistered tools are rejected without running a handler", async () => {
  const requests: ToolModelRequest<TestMessage>[] = [];

  const result = await runToolLoop<TestMessage>({
    messages: [{ role: "user", content: "Delete the project." }],
    tools: [GET_PROJECT_STATUS_TOOL],
    executeTool: executeRegisteredTool,
    createToolMessage: toolMessage,
    callModel: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        const toolCall = call("call_bad", "delete_project", "{}");
        return {
          content: null,
          toolCalls: [toolCall],
          assistantMessage: {
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          },
        };
      }
      return {
        content: "I cannot do that.",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "I cannot do that." },
      };
    },
  });

  assert.equal(result.content, "I cannot do that.");
  assert.deepEqual(result.usedToolNames, []);
  const toolResults = requests[1].messages.filter(
    (message) => message.role === "tool"
  );
  assert.equal(toolResults.length, 1);
  assert.match(toolResults[0].content ?? "", /unknown tool/i);
});

test("the loop caps tool rounds and forces a final answer", async () => {
  const choices: Array<"auto" | "none"> = [];
  let executions = 0;

  const result = await runToolLoop<TestMessage>({
    messages: [{ role: "user", content: "Keep looking." }],
    tools: [GET_PROJECT_STATUS_TOOL],
    maxIterations: 2,
    executeTool: () => {
      executions++;
      return { ok: true, content: JSON.stringify({ found: false }) };
    },
    createToolMessage: toolMessage,
    callModel: async ({ toolChoice }) => {
      choices.push(toolChoice);
      if (toolChoice === "none") {
        return {
          content: "The final answer.",
          toolCalls: [],
          assistantMessage: {
            role: "assistant",
            content: "The final answer.",
          },
        };
      }
      const toolCall = call(
        `call_${choices.length}`,
        GET_PROJECT_STATUS_TOOL_NAME,
        JSON.stringify({ projectId: "PRJ-404" })
      );
      return {
        content: null,
        toolCalls: [toolCall],
        assistantMessage: {
          role: "assistant",
          content: null,
          tool_calls: [toolCall],
        },
      };
    },
  });

  assert.equal(result.content, "The final answer.");
  assert.deepEqual(choices, ["auto", "auto", "none"]);
  assert.equal(executions, 2);
});

test("the total tool-call cap prevents further execution", async () => {
  const requests: ToolModelRequest<TestMessage>[] = [];
  let executions = 0;

  const result = await runToolLoop<TestMessage>({
    messages: [{ role: "user", content: "Check both." }],
    tools: [GET_PROJECT_STATUS_TOOL],
    maxIterations: 1,
    maxToolCalls: 1,
    executeTool: () => {
      executions++;
      return { ok: true, content: JSON.stringify({ found: true }) };
    },
    createToolMessage: toolMessage,
    callModel: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        const first = call(
          "call_1",
          GET_PROJECT_STATUS_TOOL_NAME,
          JSON.stringify({ projectId: "PRJ-104" })
        );
        const second = call(
          "call_2",
          GET_PROJECT_STATUS_TOOL_NAME,
          JSON.stringify({ projectId: "PRJ-105" })
        );
        return {
          content: null,
          toolCalls: [first, second],
          assistantMessage: {
            role: "assistant",
            content: null,
            tool_calls: [first, second],
          },
        };
      }
      return {
        content: "Done.",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "Done." },
      };
    },
  });

  assert.equal(result.content, "Done.");
  assert.equal(executions, 1);
  const toolResults = requests[1].messages.filter(
    (message) => message.role === "tool"
  );
  assert.equal(toolResults.length, 2);
  assert.match(toolResults[1].content ?? "", /limit was reached/i);
});

test("parseToolCalls rejects malformed provider responses", () => {
  assert.deepEqual(parseToolCalls(undefined), []);
  assert.deepEqual(parseToolCalls(null), []);

  const parsed = parseToolCalls([
    { id: "call_1", type: "function", function: { name: "x", arguments: "{}" } },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "call_1");

  assert.throws(() => parseToolCalls({}), ToolLoopError);
  assert.throws(
    () => parseToolCalls([{ id: "", function: { name: "x", arguments: "{}" } }]),
    ToolLoopError
  );
  assert.throws(
    () => parseToolCalls([{ id: "call_1", function: { name: "", arguments: "{}" } }]),
    ToolLoopError
  );
  assert.throws(
    () =>
      parseToolCalls([
        { id: "call_1", type: "other", function: { name: "x", arguments: "{}" } },
      ]),
    ToolLoopError
  );
  assert.throws(
    () =>
      parseToolCalls(
        Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, index) => ({
          id: `call_${index}`,
          type: "function",
          function: { name: "x", arguments: "{}" },
        }))
      ),
    ToolLoopError
  );
});
