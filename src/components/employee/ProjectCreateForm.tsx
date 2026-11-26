"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import {
  projectStatusLabels,
  type ProjectStatus,
} from "@/lib/employee/operationalTypes";
import { suggestProjectCode } from "@/lib/employee/projectTaskInput";

const statuses: ProjectStatus[] = ["planned", "active", "blocked", "completed"];
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function ProjectCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planned");
  const [codeEdited, setCodeEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!codeEdited) setProjectCode(suggestProjectCode(value));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/employee/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, projectCode, summary, status }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "The project could not be created.");
        return;
      }

      setName("");
      setProjectCode("");
      setSummary("");
      setStatus("planned");
      setCodeEdited(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("The project service could not be reached.");
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
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New project
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(92vw,440px)] rounded-2xl border border-border bg-surface p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-selected-teal text-action-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Create a project</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Managers and admins can add a Marque Technologies project.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close project form"
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
              <span className="mb-1.5 block text-xs font-medium text-foreground">Project name</span>
              <input
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Customer support portal"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Project code</span>
              <input
                type="text"
                required
                minLength={3}
                maxLength={64}
                value={projectCode}
                onChange={(event) => {
                  setCodeEdited(true);
                  setProjectCode(event.target.value);
                }}
                placeholder="CUSTOMER-SUPPORT-PORTAL-Y9ZDW5"
                className={`${inputClass} font-mono uppercase`}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">
                Description or summary
              </span>
              <textarea
                rows={3}
                maxLength={2000}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What is this project for?"
                className={`${inputClass} h-auto py-2`}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatus)}
                className={inputClass}
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {projectStatusLabels[value]}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={pending}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {pending ? "Creating..." : "Create project"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
