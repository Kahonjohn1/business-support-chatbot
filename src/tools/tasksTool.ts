import type { ToolDefinition } from "@/lib/toolCalling";
import type { StructuredToolOutput, ToolExecutionContext, ToolMetadata } from "@/tools/registry";
import { getProjectStatus } from "@/tools/projectData";
import {
  createTask,
  getTasksForProject,
  DEMO_TASK_NOTICE,
  type ProjectTask,
} from "@/tools/taskData";
import {
  createApprovalRequest,
  getApprovalRequest,
  markApprovalExecuted,
} from "@/lib/approvalWorkflow";

export const CREATE_PROJECT_TASK_TOOL_NAME = "create_project_task";
export const LIST_PROJECT_TASKS_TOOL_NAME = "list_project_tasks";

export const CREATE_PROJECT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_PROJECT_TASK_TOOL_NAME,
    description:
      "Create a new task in a Marque Technologies project. This is a protected write operation requiring explicit user approval. Returns a sample demo record.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project identifier, for example PRJ-104.",
        },
        title: {
          type: "string",
          description: "Clear, concise title for the task (max 100 characters).",
        },
        description: {
          type: "string",
          description: "Detailed description of the task requirements (max 500 characters).",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Task priority level. Defaults to medium.",
        },
        assignee: {
          type: "string",
          description: "Name of the person or team assigned (max 50 characters).",
        },
        approvalId: {
          type: "string",
          description: "Server-issued approval token. Omit when proposing an action for approval.",
        },
      },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
  },
};

export const LIST_PROJECT_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_PROJECT_TASKS_TOOL_NAME,
    description:
      "List all tasks associated with a Marque Technologies project by its project ID. Returns demo/sample data.",
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

export const CREATE_PROJECT_TASK_METADATA: ToolMetadata = {
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
};

export const LIST_PROJECT_TASKS_METADATA: ToolMetadata = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
  requiresApproval: false,
};

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const MAX_ARG_LENGTH = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface CreateTaskParams {
  projectId: string;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  assignee?: string;
  approvalId?: string;
}

function parseCreateTaskArguments(raw: string): CreateTaskParams {
  if (typeof raw !== "string" || raw.length > MAX_ARG_LENGTH) {
    throw new Error("Invalid tool arguments length.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  const projectId = parsed.projectId;
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId.trim())) {
    throw new Error("projectId is not a valid project identifier.");
  }

  const title = parsed.title;
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("title must be a non-empty string.");
  }
  if (title.trim().length > 100) {
    throw new Error("title must not exceed 100 characters.");
  }

  let description: string | undefined;
  if ("description" in parsed && parsed.description !== undefined) {
    if (typeof parsed.description !== "string") {
      throw new Error("description must be a string.");
    }
    description = parsed.description.trim().slice(0, 500);
  }

  let priority: "low" | "medium" | "high" = "medium";
  if ("priority" in parsed && parsed.priority !== undefined) {
    if (parsed.priority !== "low" && parsed.priority !== "medium" && parsed.priority !== "high") {
      throw new Error("priority must be 'low', 'medium', or 'high'.");
    }
    priority = parsed.priority;
  }

  let assignee: string | undefined;
  if ("assignee" in parsed && parsed.assignee !== undefined) {
    if (typeof parsed.assignee !== "string") {
      throw new Error("assignee must be a string.");
    }
    assignee = parsed.assignee.trim().slice(0, 50);
  }

  let approvalId: string | undefined;
  if ("approvalId" in parsed && parsed.approvalId !== undefined) {
    if (typeof parsed.approvalId !== "string" || !parsed.approvalId.trim()) {
      throw new Error("approvalId must be a non-empty string.");
    }
    approvalId = parsed.approvalId.trim();
  }

  return {
    projectId: projectId.trim().toUpperCase(),
    title: title.trim(),
    description,
    priority,
    assignee,
    approvalId,
  };
}

/**
 * Executes the create_project_task tool.
 * Implements two-stage approval: creates a pending approval if not yet approved,
 * or completes the task creation if a valid approved token is present.
 */
export function executeCreateProjectTask(
  rawArguments: string,
  context: ToolExecutionContext
): StructuredToolOutput {
  try {
    const params = parseCreateTaskArguments(rawArguments);

    // Verify target project exists in demo dataset
    const project = getProjectStatus(params.projectId);
    if (!project) {
      return {
        ok: true,
        data: {
          found: false,
          projectId: params.projectId,
          sampleData: true,
          notice: `Target project "${params.projectId}" not found in demo data. Task cannot be created.`,
        },
      };
    }

    // STAGE 2: If an approvalId is provided, execute the approved action
    if (params.approvalId) {
      const approval = getApprovalRequest(params.approvalId);
      if (!approval) {
        return {
          ok: false,
          error: {
            code: "INVALID_ARGUMENTS",
            message: `Approval request "${params.approvalId}" not found or expired.`,
          },
        };
      }

      if (approval.status !== "approved") {
        return {
          ok: false,
          error: {
            code: "EXECUTION_FAILED",
            message: `Operation cannot proceed because approval status is "${approval.status}".`,
          },
        };
      }

      // Mark executed (prevents duplicate execution / replay attack)
      markApprovalExecuted(approval.id);

      const task: ProjectTask = createTask({
        projectId: params.projectId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        assignee: params.assignee,
      });

      return {
        ok: true,
        data: {
          status: "executed",
          sampleData: true,
          notice: DEMO_TASK_NOTICE,
          task,
        },
      };
    }

    // STAGE 1: Protected operation requires explicit user approval
    const summary = `Create ${params.priority} priority task "${params.title}" in project ${params.projectId}`;
    const approval = createApprovalRequest({
      requestId: context.requestId,
      toolName: CREATE_PROJECT_TASK_TOOL_NAME,
      rawArguments,
      summary,
      details: {
        projectId: params.projectId,
        title: params.title,
        description: params.description ?? "",
        priority: params.priority,
        assignee: params.assignee ?? "Unassigned",
      },
    });

    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: CREATE_PROJECT_TASK_TOOL_NAME,
        summary,
        sampleData: true,
        notice: "This operation requires explicit user approval before execution.",
        details: approval.details,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message: error instanceof Error ? error.message : "Invalid tool arguments.",
      },
    };
  }
}

/**
 * Executes the list_project_tasks tool.
 */
export function executeListProjectTasks(
  rawArguments: string
): StructuredToolOutput {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArguments);
    } catch {
      throw new Error("Tool arguments must be valid JSON.");
    }

    if (!isRecord(parsed)) {
      throw new Error("Tool arguments must be a JSON object.");
    }

    const projectId = parsed.projectId;
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("projectId is required.");
    }

    const normalized = projectId.trim().toUpperCase();
    const tasks = getTasksForProject(normalized);

    return {
      ok: true,
      data: {
        projectId: normalized,
        tasks,
        totalTasks: tasks.length,
        sampleData: true,
        notice: DEMO_TASK_NOTICE,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message: error instanceof Error ? error.message : "Invalid tool arguments.",
      },
    };
  }
}
