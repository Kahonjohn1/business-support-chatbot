"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ProjectStatus = "planned" | "active" | "blocked" | "completed";
type TaskPriority = "low" | "medium" | "high";
type TaskStatus = "todo" | "in_progress" | "done";

interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

interface AssigneeOption {
  readonly id: string;
  readonly label: string;
}

interface ProjectEditValues extends ProjectOption {
  readonly status: ProjectStatus;
  readonly progressNotes: string;
  readonly blockers: readonly string[];
}

interface TaskEditValues {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignee: string;
  readonly assigneeId?: string | null;
}

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary";
const textareaClass = `${inputClass} min-h-24 resize-y`;
const primaryButtonClass =
  "rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60";
const secondaryButtonClass =
  "rounded-lg border border-border px-4 py-2 font-medium text-foreground hover:bg-muted disabled:opacity-60";

async function getResponseError(
  response: Response,
  fallback: string
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return body && typeof body.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

function FormFeedback({
  error,
  message,
}: {
  readonly error: string | null;
  readonly message: string | null;
}) {
  return (
    <>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-primary" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, progressNotes }),
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, "Unable to create project."));
      }
      setName("");
      setProgressNotes("");
      setMessage("Project created.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xs" onSubmit={handleSubmit}>
      <h2 className="text-base font-semibold text-foreground">New project</h2>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Project name</span>
        <input
          className={inputClass}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
          type="text"
          value={name}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Progress notes</span>
        <textarea
          className={textareaClass}
          maxLength={500}
          onChange={(event) => setProgressNotes(event.target.value)}
          value={progressNotes}
        />
      </label>
      <FormFeedback error={error} message={message} />
      <button className={primaryButtonClass} disabled={busy} type="submit">
        {busy ? "Creating..." : "Create project"}
      </button>
    </form>
  );
}

export function ProjectEditForm({ project }: { readonly project: ProjectEditValues }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [progressNotes, setProgressNotes] = useState(project.progressNotes);
  const [blockers, setBlockers] = useState(project.blockers.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          progressNotes,
          blockers: blockers
            .split("\n")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }),
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, "Unable to update project."));
      }
      setMessage("Project updated.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xs" onSubmit={handleSubmit}>
      <h2 className="text-base font-semibold text-foreground">Edit project</h2>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Project name</span>
        <input
          className={inputClass}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
          type="text"
          value={name}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Status</span>
        <select
          className={inputClass}
          onChange={(event) => setStatus(event.target.value as ProjectStatus)}
          value={status}
        >
          <option value="planned">Planned</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Progress notes</span>
        <textarea
          className={textareaClass}
          maxLength={500}
          onChange={(event) => setProgressNotes(event.target.value)}
          value={progressNotes}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Blockers (one per line)</span>
        <textarea
          className={textareaClass}
          onChange={(event) => setBlockers(event.target.value)}
          value={blockers}
        />
      </label>
      <FormFeedback error={error} message={message} />
      <button className={primaryButtonClass} disabled={busy} type="submit">
        {busy ? "Saving..." : "Save project"}
      </button>
    </form>
  );
}

export function TaskCreateForm({
  projects,
  defaultProjectId,
  assignees,
}: {
  readonly projects: readonly ProjectOption[];
  readonly defaultProjectId?: string;
  readonly assignees?: readonly AssigneeOption[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(
    defaultProjectId ?? projects[0]?.id ?? ""
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const selectedAssignee = assignees?.find((option) => option.id === assigneeId);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          description,
          priority,
          ...(assignees?.length
            ? {
                assigneeId: assigneeId || null,
                assignee: selectedAssignee?.label ?? "Unassigned",
              }
            : { assignee }),
        }),
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, "Unable to create task."));
      }
      setTitle("");
      setDescription("");
      setAssignee("");
      setAssigneeId("");
      setMessage("Task created.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task.");
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
        Create a project before adding tasks.
      </div>
    );
  }

  return (
    <form className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xs" onSubmit={handleSubmit}>
      <h2 className="text-base font-semibold text-foreground">New task</h2>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Project</span>
        <select
          className={inputClass}
          onChange={(event) => setProjectId(event.target.value)}
          required
          value={projectId}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Task title</span>
        <input
          className={inputClass}
          maxLength={100}
          onChange={(event) => setTitle(event.target.value)}
          required
          type="text"
          value={title}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Description</span>
        <textarea
          className={textareaClass}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-foreground">Priority</span>
          <select
            className={inputClass}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            value={priority}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">Assignee</span>
          {assignees?.length ? (
            <select
              className={inputClass}
              onChange={(event) => setAssigneeId(event.target.value)}
              value={assigneeId}
            >
              <option value="">Unassigned</option>
              {assignees.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              maxLength={50}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Unassigned"
              type="text"
              value={assignee}
            />
          )}
        </label>
      </div>
      <FormFeedback error={error} message={message} />
      <button className={primaryButtonClass} disabled={busy || !projectId} type="submit">
        {busy ? "Creating..." : "Create task"}
      </button>
    </form>
  );
}

export function TaskEditForm({
  task,
  assignees,
}: {
  readonly task: TaskEditValues;
  readonly assignees?: readonly AssigneeOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assignee, setAssignee] = useState(task.assignee);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const selectedAssignee = assignees?.find((option) => option.id === assigneeId);
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          priority,
          status,
          ...(assignees?.length
            ? {
                assigneeId: assigneeId || null,
                assignee: selectedAssignee?.label ?? "Unassigned",
              }
            : { assignee }),
        }),
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, "Unable to update task."));
      }
      setMessage("Task updated.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update task.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="inline-flex rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        onClick={() => setEditing(true)}
        type="button"
      >
        Edit task
      </button>
    );
  }

  return (
    <form className="mt-3 space-y-3 rounded-xl border border-border bg-background p-4" onSubmit={handleSubmit}>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Task title</span>
        <input
          className={inputClass}
          maxLength={100}
          onChange={(event) => setTitle(event.target.value)}
          required
          type="text"
          value={title}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Description</span>
        <textarea
          className={textareaClass}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium text-foreground">Priority</span>
          <select
            className={inputClass}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            value={priority}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">Status</span>
          <select
            className={inputClass}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
            value={status}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">Assignee</span>
          {assignees?.length ? (
            <select
              className={inputClass}
              onChange={(event) => setAssigneeId(event.target.value)}
              value={assigneeId}
            >
              <option value="">Unassigned</option>
              {assignees.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              maxLength={50}
              onChange={(event) => setAssignee(event.target.value)}
              type="text"
              value={assignee}
            />
          )}
        </label>
      </div>
      <FormFeedback error={error} message={message} />
      <div className="flex flex-wrap gap-2">
        <button className={primaryButtonClass} disabled={busy} type="submit">
          {busy ? "Saving..." : "Save task"}
        </button>
        <button
          className={secondaryButtonClass}
          disabled={busy}
          onClick={() => setEditing(false)}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
