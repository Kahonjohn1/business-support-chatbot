import Link from "next/link";
import { AppShell } from "@/components/workspace/AppShell";
import { listPersonalProjects, listPersonalTasks } from "@/lib/personalProjectData";
import type { PersonalTaskRecord } from "@/lib/personalProjectData";
import { requireUserAuthorization } from "@/lib/workspace/authorization";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";

export const instant = false;

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

export default async function TasksPage() {
  const context = await requireUserPage("/tasks");
  const auth = requireUserAuthorization(context);
  const [conversations, groups] = await Promise.all([
    getConversationList(context),
    listPersonalProjects(auth)
      .then((projects) =>
        Promise.all(
          projects.map(async (project) => ({
            project,
            tasks: await listPersonalTasks(auth, project.id),
          }))
        )
      )
      .catch(() => null),
  ]);
  const loadError =
    groups === null ? "Saved tasks could not be loaded right now." : null;
  const visibleGroups = groups ?? [];

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
    >
      <div className="w-full max-w-5xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Personal tasks grouped by project.
            </p>
          </div>
          <Link
            className="inline-flex w-fit items-center rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            href="/projects"
          >
            View projects
          </Link>
        </div>

        <div className="mt-6">
          {loadError ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <p className="font-medium">{loadError}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try again later. No task data was changed.
              </p>
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
              <p className="font-medium">No projects with tasks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask Marque AI to create a project and its tasks, then they will
                appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleGroups.map(({ project, tasks }) => (
                <section
                  className="rounded-2xl border border-border bg-surface p-5 shadow-xs"
                  key={project.id}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        {project.name}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                    <Link
                      className="inline-flex w-fit items-center rounded-lg px-2 py-1 text-sm font-medium text-accent-foreground hover:bg-accent"
                      href={`/projects/${project.id}`}
                    >
                      Open project
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
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
