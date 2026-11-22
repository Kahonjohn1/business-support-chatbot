import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/workspace/AppShell";
import {
  getPersonalProjectById,
  listPersonalTasks,
} from "@/lib/personalProjectData";
import type {
  PersonalProjectRecord,
  PersonalTaskRecord,
} from "@/lib/personalProjectData";
import { requireUserAuthorization } from "@/lib/workspace/authorization";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";
import { isUuid } from "@/lib/validation/uuid";

export const instant = false;

const PROJECT_STATUS_LABELS: Record<PersonalProjectRecord["status"], string> = {
  planned: "Planned",
  active: "Active",
  blocked: "Blocked",
  completed: "Completed",
};

const PROJECT_STATUS_CLASSES: Record<PersonalProjectRecord["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-accent text-accent-foreground",
  blocked: "bg-danger-subtle text-danger",
  completed: "bg-muted text-foreground",
};

const TASK_PRIORITY_LABELS: Record<PersonalTaskRecord["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const TASK_PRIORITY_CLASSES: Record<PersonalTaskRecord["priority"], string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-accent text-accent-foreground",
  high: "bg-danger-subtle text-danger",
};

const TASK_STATUS_LABELS: Record<PersonalTaskRecord["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const TASK_STATUS_CLASSES: Record<PersonalTaskRecord["status"], string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-accent text-accent-foreground",
  done: "bg-muted text-foreground",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const context = await requireUserPage(`/projects/${id}`);
  const auth = requireUserAuthorization(context);
  const [conversations, details] = await Promise.all([
    getConversationList(context),
    Promise.all([
      getPersonalProjectById(auth, id),
      listPersonalTasks(auth, id),
    ])
      .then(([project, tasks]) => ({
        project,
        tasks,
        error: null as string | null,
      }))
      .catch(() => ({
        project: null,
        tasks: [] as readonly PersonalTaskRecord[],
        error: "Project details could not be loaded right now.",
      })),
  ]);
  const { project, tasks, error: loadError } = details;
  if (!loadError && !project) notFound();

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
    >
      <div className="w-full max-w-4xl">
        <Link
          className="inline-flex items-center rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          href="/projects"
        >
          Back to projects
        </Link>

        {loadError || !project ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center">
            <p className="font-medium">
              {loadError ?? "This project could not be found."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try again later. No project data was changed.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">
                  {project.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Updated {formatDate(project.updatedAt)}
                </p>
              </div>
              <span
                className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS_CLASSES[project.status]}`}
              >
                {PROJECT_STATUS_LABELS[project.status]}
              </span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <h2 className="text-sm font-semibold text-foreground">
                  Progress notes
                </h2>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {project.progressNotes.trim() || "No progress notes yet."}
                </p>
              </section>
              <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <h2 className="text-sm font-semibold text-foreground">
                  Blockers
                </h2>
                {project.blockers.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No blockers recorded.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {project.blockers.map((blocker) => (
                      <li className="break-words" key={blocker}>
                        {blocker}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-foreground">
                  Tasks
                </h2>
                <Link
                  className="inline-flex w-fit items-center rounded-lg px-2 py-1 text-sm font-medium text-accent-foreground hover:bg-accent"
                  href="/tasks"
                >
                  View all tasks
                </Link>
              </div>
              {tasks.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No tasks in this project yet.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-border">
                  {tasks.map((task) => (
                    <li
                      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      key={task.id}
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium text-foreground">
                          {task.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Assignee: {task.assignee}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_PRIORITY_CLASSES[task.priority]}`}
                        >
                          {TASK_PRIORITY_LABELS[task.priority]}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_STATUS_CLASSES[task.status]}`}
                        >
                          {TASK_STATUS_LABELS[task.status]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
