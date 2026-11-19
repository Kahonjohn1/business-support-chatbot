// Read-only project tools exposed to the assistant.
// Tool registration and execution dispatch are handled by the central registry (@/tools/registry).

import type { ToolDefinition } from "@/lib/toolCalling";
import type { StructuredToolOutput } from "@/tools/registry";
import {
  findProjectMatches,
  getAllProjects,
  getProjectStatus,
  resolveProjectByName,
  toProjectChoice,
  toProjectDetails,
  type ProjectResolution,
} from "@/tools/projectData";

export const GET_PROJECT_STATUS_TOOL_NAME = "get_project_status";
export const LIST_PROJECTS_TOOL_NAME = "list_projects";

export const GET_PROJECT_STATUS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: GET_PROJECT_STATUS_TOOL_NAME,
    description:
      "Look up the status of a Marque Technologies project by its business name. Returns a demo project record, which is sample data and not verified company information.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "The project's business name, for example Business Support Chatbot. Use list_projects first if the name is unclear.",
        },
      },
      required: ["projectName"],
      additionalProperties: false,
    },
  },
};

export const LIST_PROJECTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_PROJECTS_TOOL_NAME,
    description:
      "List or search available Marque Technologies projects by business name. Returns demo/sample project names and statuses.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          maxLength: 120,
          description:
            "Optional project name or name fragment to search for, for example chatbot or support.",
        },
      },
      additionalProperties: false,
    },
  },
};

export const GET_PROJECT_STATUS_METADATA = {
  readOnly: true,
  destructive: false,
  requiresAuth: false,
  idempotent: true,
} as const;

export const LIST_PROJECTS_METADATA = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
} as const;

/** Appended to the system prompt only when the selected model supports tools. */
export const TOOL_USE_INSTRUCTION = [
  "Available business operations and rules:",
  "- list_projects: Call when the user has not named a project, or when a project name is unclear. Optionally pass a project name fragment as query. Returns project names and statuses only.",
  "- get_project_status: Call when the user asks about the status of a named project. Pass the project name.",
  "- list_project_tasks: Call when the user asks to view or list tasks for a named project. Pass the project name. Optionally pass a task name to find a specific task by its title.",
  "- create_project_task: Call when the user asks to create or add a task in a named project. Requires a project name and a task title. This is a protected action that requires explicit user confirmation.",
  "- Use business names only. Never ask the user for a project ID, task ID, database identifier, or API identifier.",
  "- If a tool returns status: 'needs_clarification', ask the user to choose from the returned names. Do not guess which record they mean.",
  "- If a tool returns status: 'not_found', say that no matching record was found in the demo dataset and ask for a different business name if appropriate.",
  "- If exactly one project matches the name the user gave, use it automatically.",
  "- Never show project IDs, task IDs, approval IDs, database identifiers, API identifiers, raw tool arguments, or raw JSON to the user. Summarize actions with business names instead.",
  "- Never guess or invent a project name, task title, status, progress note, or blocker.",
  "- Demo data notice: Whenever a tool result says sampleData is true, explicitly tell the user that the data is demo/sample data and not verified company information.",
  "- Approval notice: When a tool returns status: 'pending_approval', inform the user that the operation has been prepared and requires their explicit confirmation to execute, summarizing the proposed task details by name.",
].join("\n");

/** Used when the selected model has no documented tool-calling support. */
export const NO_TOOL_USE_INSTRUCTION = [
  "Business project operations are unavailable for the current model:",
  "- Do not claim to look up or know any project status or task details.",
  "- Never invent a project name, task title, status, progress note, or blocker.",
  "- Never ask the user for an internal project ID or task ID.",
  "- If the user asks for project status or task management, say that those operations are unavailable right now and offer the approved human-support channels.",
].join("\n");

export const DEMO_DATA_NOTICE =
  "DEMO DATA ONLY: This project record is sample data, not verified company information.";

export const DEMO_DATA_DISCLOSURE =
  "Note: Business project and task data is demo/sample data, not verified company information.";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const MAX_TOOL_ARGUMENT_CHARS = 1_000;
const MAX_PROJECT_NAME_CHARS = 120;
const SOURCE_DECLARATION_LINE =
  /^\s*(?:[*_]{1,2})?\s*sources?\s*(?:[*_]{1,2})?\s*:/i;

export type ProjectReference =
  | { kind: "name"; value: string }
  | { kind: "id"; value: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(rawArguments: string): Record<string, unknown> {
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

  return parsed;
}

function parseProjectName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("projectName must be a string.");
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROJECT_NAME_CHARS) {
    throw new Error("projectName must be between 1 and 120 characters.");
  }

  return trimmed;
}

export function parseProjectReference(rawArguments: string): ProjectReference {
  const parsed = parseJsonObject(rawArguments);
  const keys = Object.keys(parsed);

  if (
    keys.length !== 1 ||
    (keys[0] !== "projectName" && keys[0] !== "projectId")
  ) {
    throw new Error("Tool arguments must contain only projectName.");
  }

  if (keys[0] === "projectName") {
    return { kind: "name", value: parseProjectName(parsed.projectName) };
  }

  const projectId = parsed.projectId;
  if (typeof projectId !== "string") {
    throw new Error("projectId must be a string.");
  }

  const trimmed = projectId.trim();
  if (!trimmed || !PROJECT_ID_PATTERN.test(trimmed)) {
    throw new Error("projectId is not a valid project identifier.");
  }

  return { kind: "id", value: trimmed.toUpperCase() };
}

export function resolveProjectReference(
  reference: ProjectReference
): ProjectResolution {
  if (reference.kind === "id") {
    const project = getProjectStatus(reference.value);
    return project
      ? { status: "resolved", project }
      : { status: "not_found" };
  }

  return resolveProjectByName(reference.value);
}

export function parseListProjectsArguments(rawArguments: string): {
  query?: string;
} {
  if (rawArguments.trim() === "") {
    return {};
  }

  const parsed = parseJsonObject(rawArguments);
  for (const key of Object.keys(parsed)) {
    if (key !== "query") {
      throw new Error(`Unknown argument "${key}".`);
    }
  }

  if (parsed.query === undefined) {
    return {};
  }

  if (typeof parsed.query !== "string") {
    throw new Error("query must be a string.");
  }

  const trimmed = parsed.query.trim();
  if (trimmed.length > MAX_PROJECT_NAME_CHARS) {
    throw new Error("query must not exceed 120 characters.");
  }

  return trimmed ? { query: trimmed } : {};
}

/**
 * Executes the get_project_status tool.
 * Validates arguments, resolves the project by name, and returns a structured output.
 */
export function executeGetProjectStatus(
  rawArguments: string
): StructuredToolOutput {
  try {
    const reference = parseProjectReference(rawArguments);
    const resolution = resolveProjectReference(reference);

    if (resolution.status === "ambiguous") {
      return {
        ok: true,
        data: {
          found: false,
          ambiguous: true,
          status: "needs_clarification",
          resource: "project",
          projectName: reference.value,
          choices: resolution.matches.map(toProjectChoice),
          sampleData: true,
          message:
            "More than one project matches that name. Ask the user which project they mean.",
          notice: DEMO_DATA_NOTICE,
        },
      };
    }

    if (resolution.status === "not_found") {
      return {
        ok: true,
        data: {
          found: false,
          ambiguous: false,
          status: "not_found",
          resource: "project",
          ...(reference.kind === "name"
            ? { projectName: reference.value }
            : {}),
          sampleData: true,
          message:
            "No matching project was found in the demo/sample dataset. Do not invent project details.",
          notice: DEMO_DATA_NOTICE,
        },
      };
    }

    return {
      ok: true,
      data: {
        found: true,
        status: "ok",
        sampleData: true,
        notice: DEMO_DATA_NOTICE,
        project: toProjectDetails(resolution.project),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message:
          error instanceof Error
            ? error.message
            : "The tool arguments were invalid.",
      },
    };
  }
}

export function executeListProjects(
  rawArguments: string
): StructuredToolOutput {
  try {
    const { query } = parseListProjectsArguments(rawArguments);
    const projects = (
      query ? findProjectMatches(query) : getAllProjects()
    ).map(toProjectChoice);

    return {
      ok: true,
      data: {
        status: projects.length > 0 ? "ok" : "not_found",
        ...(query ? { query } : {}),
        projects,
        total: projects.length,
        sampleData: true,
        ...(projects.length === 0
          ? {
              message:
                "No projects match that name in the demo/sample dataset.",
            }
          : {}),
        notice: DEMO_DATA_NOTICE,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message:
          error instanceof Error
            ? error.message
            : "The tool arguments were invalid.",
      },
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
