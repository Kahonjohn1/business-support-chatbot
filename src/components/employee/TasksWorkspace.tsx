"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { AvatarWithName } from "./Avatar";
import { StatusBadge } from "./StatusBadge";
import {
  taskPriorityLabels,
  taskPriorityTone,
  taskStatusLabels,
  taskStatusTone,
  type EmployeeTask,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/employee/operationalTypes";

const statusFilters: Array<TaskStatus | "All"> = ["All", "todo", "in_progress", "done"];
const priorityFilters: Array<TaskPriority | "All"> = ["All", "high", "medium", "low"];

function statusName(value: TaskStatus | "All"): string {
  return value === "All" ? "All" : taskStatusLabels[value];
}

function priorityName(value: TaskPriority | "All"): string {
  return value === "All" ? "All" : taskPriorityLabels[value];
}

export function TasksWorkspace({ tasks }: { tasks: EmployeeTask[] }) {
  const [status, setStatus] = useState<TaskStatus | "All">("All");
  const [priority, setPriority] = useState<TaskPriority | "All">("All");

  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (status === "All" || task.status === status) &&
          (priority === "All" || task.priority === priority)
      ),
    [tasks, status, priority]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              aria-pressed={status === item}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                status === item
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {statusName(item)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="priority-filter" className="text-xs font-medium text-muted-foreground">
            Priority
          </label>
          <select
            id="priority-filter"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority | "All")}
            className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {priorityFilters.map((item) => (
              <option key={item} value={item}>
                {priorityName(item)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Priority</th>
              <th className="px-3 py-2.5 font-semibold">Assignee</th>
              <th className="px-3 py-2.5 font-semibold">Updated</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task) => (
              <tr key={task.id} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-3">
                  <p className="text-xs font-medium text-muted-foreground">{task.code}</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{task.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{task.project}</p>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge tone={taskStatusTone(task.status)}>{task.statusLabel}</StatusBadge>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge tone={taskPriorityTone(task.priority)}>{task.priorityLabel}</StatusBadge>
                </td>
                <td className="px-3 py-3">
                  <AvatarWithName name={task.assignee} />
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{task.updated}</td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-lg p-1.5 text-muted-foreground opacity-60"
                    aria-label={`Actions for ${task.code}`}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleTasks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No tasks match these filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
