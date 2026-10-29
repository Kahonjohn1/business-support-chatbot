// The single read-only tool exposed to the assistant. The registry is explicit:
// only functions listed in REGISTERED_TOOLS can ever be executed.

import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/lib/toolCalling";
import { getProjectStatus } from "@/tools/projectData";

export const GET_PROJECT_STATUS_TOOL_NAME = "get_project_status";

export const GET_PROJECT_STATUS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: GET_PROJECT_STATUS_TOOL_NAME,
    description:
      "Look up the status of a Marque Technologies project by its project ID. Returns a demo project record, which is sample data and not verified company information.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project identifier, for example PRJ-104.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
};

export const REGISTERED_TOOLS: readonly ToolDefinition[] = [
  GET_PROJECT_STATUS_TOOL,
];

/** Appended to the system prompt only when the selected model supports tools. */
export const TOOL_USE_INSTRUCTION = [
  "Project status tool rules:",
  "- Call get_project_status only when the user asks for the status of a specific project ID.",
  "- Never guess or invent a project ID, project name, status, progress note, or blocker.",
  "- The tool returns demo/sample data. Whenever a tool result says sampleData is true, explicitly tell the user that the project status is demo/sample data and not verified company information.",
  "- If the tool returns found: false, say that no matching project was found in the demo dataset. Do not invent details.",
].join("\n");

/** Used when the selected model has no documented tool-calling support. */
export const NO_TOOL_USE_INSTRUCTION = [
  "Project status lookup is unavailable for the current model:",
  "- Do not claim to look up or know any project status.",
  "- Never invent a project ID, project name, status, progress note, or blocker.",
  "- If the user asks for project status, say that the project status lookup is unavailable right now and offer the approved human-support channels.",
].join("\n");

export const DEMO_DATA_NOTICE =
  "DEMO DATA ONLY: This project record is sample data, not verified company information.";

export const DEMO_DATA_DISCLOSURE =
  "Note: Project status data is demo/sample data, not verified company information.";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const MAX_TOOL_ARGUMENT_CHARS = 1_000;
const SOURCE_DECLARATION_LINE =
  /^\s*(?:[*_]{1,2})?\s*sources?\s*(?:[*_]{1,2})?\s*:/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProjectId(rawArguments: string): string {
  if (
    typeof rawArguments !== "string" ||
    rawArguments.length > MAX_TOOL_ARGUMENT_CHARS
  ) {
    throw new Error("Invalid tool arguments.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("Tool arguments must contain only projectId.");
  }

  const projectId = parsed.projectId;
  if (typeof projectId !== "string") {
    throw new Error("projectId must be a string.");
  }

  const trimmed = projectId.trim();
  if (!trimmed || !PROJECT_ID_PATTERN.test(trimmed)) {
    throw new Error("projectId is not a valid project identifier.");
  }

  return trimmed;
}

/**
 * Executes a tool call against the explicit registry. Unknown tools and invalid
 * arguments are rejected without running anything; the safe error is returned
 * to the model as a tool result.
 */
export function executeRegisteredTool(
  toolName: string,
  rawArguments: string
): ToolExecutionResult {
  if (toolName !== GET_PROJECT_STATUS_TOOL_NAME) {
    return { ok: false, error: "Unknown tool. No tool was executed." };
  }

  try {
    const projectId = parseProjectId(rawArguments);
    const project = getProjectStatus(projectId);

    if (!project) {
      return {
        ok: true,
        content: JSON.stringify({
          found: false,
          projectId: projectId.toUpperCase(),
          sampleData: true,
          notice:
            "No matching project was found in the demo/sample dataset. Do not invent project details. This dataset is not verified company information.",
        }),
      };
    }

    return {
      ok: true,
      content: JSON.stringify({
        found: true,
        sampleData: true,
        notice: DEMO_DATA_NOTICE,
        project,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The tool arguments were invalid.",
    };
  }
}

/**
 * Ensures a final answer that used project status data explicitly discloses its
 * demo nature. A trailing "Sources:" declaration is kept last so the existing
 * grounding parser still recognises it.
 */
export function ensureDemoDataDisclosure(reply: string): string {
  const text = reply.trim();
  if (!text) return DEMO_DATA_DISCLOSURE;

  const alreadyDisclosed =
    /demo|sample/i.test(text) && /not verified|unverified/i.test(text);
  if (alreadyDisclosed) return text;

  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? "";
  if (SOURCE_DECLARATION_LINE.test(last)) {
    lines.splice(lines.length - 1, 0, "", DEMO_DATA_DISCLOSURE);
  } else {
    lines.push("", DEMO_DATA_DISCLOSURE);
  }
  return lines.join("\n");
}
