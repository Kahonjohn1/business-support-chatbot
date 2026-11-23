"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  AutomationExecutionRecord,
  AutomationWorkflowDraft,
  AutomationWorkflowProposal,
  AutomationWorkflowRecord,
  AutomationWorkflowStatus,
} from "@/lib/automation/types";

interface AutomationManagerProps {
  readonly initialWorkflows: readonly AutomationWorkflowRecord[];
  readonly initialExecutions: readonly AutomationExecutionRecord[];
  readonly workspaceLabel: string;
  readonly canManage: boolean;
  readonly notice?: string;
}

interface ProposalView {
  readonly explanation: readonly string[];
  readonly missingDetails: readonly string[];
  readonly draft: AutomationWorkflowDraft | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return `The request failed (${response.status}).`;
}

function triggerLabel(workflow: AutomationWorkflowRecord): string {
  const trigger = workflow.trigger;
  if (trigger.type === "manual") return "Manual";
  if (trigger.type === "event") return trigger.eventType ?? "Event";
  if (trigger.interval === "weekly") {
    return `Weekly at ${trigger.time}`;
  }
  if (trigger.interval === "monthly") {
    return `Monthly on day ${trigger.dayOfMonth ?? 1} at ${trigger.time}`;
  }
  return `Daily at ${trigger.time}`;
}

function actionLabels(workflow: AutomationWorkflowRecord): string {
  return workflow.actions.map((action) => action.type.replace(/_/g, " ")).join(", ");
}

function outcomeSummary(execution: AutomationExecutionRecord): string {
  if (execution.error) return execution.error;
  if (!execution.result) return "Waiting for execution.";
  const outcomes = execution.result.outcomes;
  if (!outcomes.length) return "No actions ran.";
  return outcomes.map((outcome) => outcome.summary).join(" | ");
}

export function AutomationManager({
  initialWorkflows,
  initialExecutions,
  workspaceLabel,
  canManage,
  notice,
}: AutomationManagerProps) {
  const router = useRouter();
  const [workflows, setWorkflows] =
    useState<readonly AutomationWorkflowRecord[]>(initialWorkflows);
  const [executions, setExecutions] =
    useState<readonly AutomationExecutionRecord[]>(initialExecutions);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const response = await fetch("/api/automations", { cache: "no-store" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body) || !Array.isArray(body.workflows) || !Array.isArray(body.executions)) {
      setMessage("The automation list could not be refreshed.");
      return;
    }
    setWorkflows(body.workflows as readonly AutomationWorkflowRecord[]);
    setExecutions(body.executions as readonly AutomationExecutionRecord[]);
    router.refresh();
  }

  async function explain(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setProposal(null);
    try {
      const response = await fetch("/api/automations/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          description,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body)) {
        setMessage(await readError(response));
        if (isRecord(body) && Array.isArray(body.missingDetails)) {
          setProposal({
            explanation: Array.isArray(body.explanation)
              ? body.explanation.filter((item): item is string => typeof item === "string")
              : [],
            missingDetails: body.missingDetails.filter(
              (item): item is string => typeof item === "string"
            ),
            draft: null,
          });
        }
        return;
      }
      const result = body.proposal as AutomationWorkflowProposal;
      setProposal({
        explanation: result.explanation,
        missingDetails: result.missingDetails,
        draft: result.draft,
      });
      setMessage(
        result.draft
          ? "Review the preview, then save and enable it."
          : "Add the missing details and explain it again."
      );
    } catch {
      setMessage("The automation could not be explained.");
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!proposal?.draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(proposal.draft),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setDescription("");
      setName("");
      setProposal(null);
      setMessage("Automation saved and enabled.");
      await refresh();
    } catch {
      setMessage("The automation could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: AutomationWorkflowStatus): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/automations/${id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setMessage(`Automation ${status}.`);
      await refresh();
    } catch {
      setMessage("The automation status could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/automations/${id}/run`, {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setMessage("Manual run completed. Check execution history for details.");
      await refresh();
    } catch {
      setMessage("The automation could not be run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">
          Automations are scoped to <span className="font-medium text-foreground">{workspaceLabel}</span>.
          Triggers, conditions, and actions are validated on the server. Only bounded internal actions
          are supported; no arbitrary code is executed.
        </p>
      </div>

      {message ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm" role="status">
          {message}
        </div>
      ) : null}

      {canManage ? (
        <section className="rounded-2xl border border-border bg-surface p-5" aria-label="Create automation">
          <h2 className="text-lg font-semibold text-foreground">Describe an automation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For example: every Monday at 9am, summarize open tasks and notify me.
          </p>
          <div className="mt-4 grid gap-3">
            <input
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional name"
              maxLength={120}
            />
            <textarea
              className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the trigger, conditions, and action"
              maxLength={500}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={explain}
                disabled={busy || !description.trim()}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                Explain and preview
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !proposal?.draft}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Save and enable
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {proposal ? (
        <section className="rounded-2xl border border-border bg-surface p-5" aria-label="Automation preview">
          <h2 className="text-lg font-semibold text-foreground">Preview</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {proposal.explanation.map((item, index) => (
              <li key={`explanation-${index}`}>{item}</li>
            ))}
            {proposal.missingDetails.map((item, index) => (
              <li key={`missing-${index}`} className="text-foreground">
                Needed: {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {workflows.map((workflow) => (
        <section
          key={workflow.id}
          className="rounded-2xl border border-border bg-surface p-5"
          aria-label={workflow.name}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{workflow.name}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {workflow.description || "No description."}
              </p>
            </div>
            <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              {workflow.status}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium text-foreground">Trigger</dt>
              <dd className="mt-1 text-muted-foreground">{triggerLabel(workflow)}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Conditions</dt>
              <dd className="mt-1 text-muted-foreground">
                {workflow.conditions.length
                  ? workflow.conditions
                      .map((condition) => `${condition.field} ${condition.operator}`)
                      .join(", ")
                  : "None"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Actions</dt>
              <dd className="mt-1 text-muted-foreground">{actionLabels(workflow)}</dd>
            </div>
          </dl>
          {canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatus(workflow.id, "enabled")}
                disabled={busy || workflow.status === "enabled"}
                className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                Enable
              </button>
              <button
                type="button"
                onClick={() => setStatus(workflow.id, "paused")}
                disabled={busy || workflow.status === "paused"}
                className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => setStatus(workflow.id, "disabled")}
                disabled={busy || workflow.status === "disabled"}
                className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                Disable
              </button>
              <button
                type="button"
                onClick={() => runNow(workflow.id)}
                disabled={busy}
                className="rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Run now
              </button>
            </div>
          ) : null}
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-surface p-5" aria-label="Execution history">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Execution history</h2>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {executions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No runs recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {executions.slice(0, 50).map((execution) => (
              <li key={execution.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {execution.triggerType} · {execution.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(execution.scheduledFor).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{outcomeSummary(execution)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
