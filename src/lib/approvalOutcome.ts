export type ApprovalOutcomeStatus = "executed" | "rejected" | "failed";

export interface ApprovalOutcome {
  status: ApprovalOutcomeStatus;
  approvalId: string;
  result?: unknown;
  error?: string;
}

interface ExecutedTaskSummary {
  title: string;
  projectName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExecutedTask(result: unknown): ExecutedTaskSummary | null {
  if (!isRecord(result) || !isRecord(result.task)) {
    return null;
  }

  const { title } = result.task;
  const projectName = result.projectName ?? result.task.projectName;
  if (typeof title !== "string" || typeof projectName !== "string") {
    return null;
  }

  return { title, projectName };
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.\s]+$/, "");
}

export function formatApprovalOutcome(outcome: ApprovalOutcome): string {
  if (outcome.status === "rejected") {
    return "You rejected the proposed operation. No changes were made.";
  }

  if (outcome.status === "failed") {
    const error = outcome.error ? stripTrailingPunctuation(outcome.error) : "";
    return error
      ? `The approved operation could not be completed: ${error}. No changes were made.`
      : "The approved operation could not be completed. No changes were made.";
  }

  const task = readExecutedTask(outcome.result);
  if (task) {
    const sampleData =
      isRecord(outcome.result) && outcome.result.sampleData === true;
    return `The task "${task.title}" was created in project "${task.projectName}".${
      sampleData
        ? " This is sample demo data; no live project-management system was changed."
        : ""
    }`;
  }

  return "The approved operation was completed successfully.";
}
