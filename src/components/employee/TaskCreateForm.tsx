"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LoaderCircle, Plus, X } from "lucide-react";
import {
  taskPriorityLabels,
  type TaskPriority,
} from "@/lib/employee/operationalTypes";

interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

interface AssigneeOption {
  id: string;
  name: string;
}

interface TaskCreateFormProps {
  projects: ProjectOption[];
  assignees: AssigneeOption[];
}

const priorities: TaskPriority[] = ["low", "medium", "high"];
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function TaskCreateForm({ projects, assignees }: TaskCreateFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = projects.length > 0 && assignees.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/employee/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          description,
          assigneeId,
          priority,
          dueDate: dueDate || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "The task could not be created.");
        return;
      }

      setProjectId("");
      setTitle("");
      setDescription("");
      setAssigneeId("");
      setPriority("medium");
      setDueDate("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The task service could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!canCreate}
        title={canCreate ? undefined : "Add a project and active employees first"}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New task
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-[80vh] w-[min(92vw,480px)] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-selected-teal text-action-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Assign a task</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Task codes are generated automatically.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close task form"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-[#F1C7C7] bg-[#FFF5F5] px-3 py-2.5 text-xs text-[#8A1F1F] dark:border-[#5A2929] dark:bg-[#2A1717] dark:text-[#F5B5B5]"
            >
              {error}
            </div>
          ) : null}

          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Project</span>
              <select
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className={inputClass}
              >
                <option value="">Choose a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Task title</span>
              <input
                type="text"
                required
                minLength={3}
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Prepare the delivery timeline"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Description</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Give the assignee enough detail to start"
                className={`${inputClass} h-auto py-2`}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Assign to</span>
              <select
                required
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className={inputClass}
              >
                <option value="">Choose an employee</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">Priority</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                  className={inputClass}
                >
                  {priorities.map((value) => (
                    <option key={value} value={value}>
                      {taskPriorityLabels[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">Deadline</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={pending || !canCreate}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {pending ? "Assigning..." : "Assign task"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
