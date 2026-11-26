"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { taskStatusLabels, type TaskStatus } from "@/lib/employee/operationalTypes";

interface TaskStatusControlProps {
  taskId: string;
  status: TaskStatus;
}

const statuses: TaskStatus[] = ["todo", "in_progress", "done"];

export function TaskStatusControl({ taskId, status }: TaskStatusControlProps) {
  const router = useRouter();
  const [value, setValue] = useState<TaskStatus>(status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value as TaskStatus;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/employee/tasks/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status: nextStatus }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setValue(status);
        setError(payload.error ?? "The status could not be updated.");
        return;
      }

      setValue(nextStatus);
      router.refresh();
    } catch {
      setValue(status);
      setError("The task status service could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label="Update my task status"
        value={value}
        onChange={handleChange}
        disabled={pending}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-[11px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
      >
        {statuses.map((item) => (
          <option key={item} value={item}>
            {taskStatusLabels[item]}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="max-w-[150px] text-right text-[10px] text-[#A15C0B]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
