import Link from "next/link";
import { AppShell } from "@/components/workspace/AppShell";
import {
  TaskCreateForm,
  TaskEditForm,
} from "@/components/workspace/ProjectManagementForms";
import type { WorkspaceTaskRecord } from "@/lib/workspace/workspaceProjectData";
import {
  listWorkspaceProjects,
  listWorkspaceTasks,
} from "@/lib/workspace/workspaceProjectData";
import { getActiveWorkspaceContext, toWorkspaceSwitcherView } from "@/lib/workspace/workspaceSelection";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";
import { listWorkspaceAssignees } from "@/lib/workspace/workspaceTeamData";

export const instant = false;

const TASK_PRIORITY_LABELS: Record<WorkspaceTaskRecord["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const TASK_PRIORITY_CLASSES: Record<WorkspaceTaskRecord["priority"], string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-accent text-accent-foreground",
  high: "bg-danger-subtle text-danger",
};

const TASK_STATUS_LABELS: Record<WorkspaceTaskRecord["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const TASK_STATUS_CLASSES: Record<WorkspaceTaskRecord["status"], string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-accent text-accent-foreground",
  done: "bg-muted text-foreground",
};

export default async function TasksPage() {
  const context = await requireUserPage("/tasks");
  const { selection, auth } = await getActiveWorkspaceContext(context);
  const canManage = auth.role !== "viewer";
  const isShared =
    selection.active.kind === "shared" &&
    auth.workspaceKind === "shared" &&
    auth.source === "verified_membership" &&
    Boolean(auth.workspaceId);
  const [conversations, groups, assignees] = await Promise.all([
    getConversationList(context),
    listWorkspaceProjects(auth)
      .then((projects) =>
        Promise.all(
          projects.map(async (project) => ({
            project,
            tasks: await listWorkspaceTasks(auth, project.id),
          }))
        )
      )
      .catch(() => null),
    isShared ? listWorkspaceAssignees(auth).catch(() => []) : Promise.resolve([]),
  ]);
  const assigneeOptions = assignees.map((assignee) => ({
    id: assignee.id,
    label: assignee.label,
  }));
  const loadError =
    groups === null ? "Saved tasks could not be loaded right now." : null;
  const visibleGroups = groups ?? [];

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <div className="w-full max-w-5xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tasks in {selection.active.name}, grouped by project.
            </p>
          </div>
          <Link
            className="inline-flex w-fit items-center rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            href="/projects"
          >
            View projects
          </Link>
        </div>

        {canManage && !loadError ? (
          <div className="mt-6">
            <TaskCreateForm
              projects={visibleGroups.map(({ project }) => ({
                id: project.id,
                name: project.name,
              }))}
              assignees={assigneeOptions}
            />
          </div>
        ) : null}

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
              <p className="font-medium">
                No projects with tasks in {selection.active.name} yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {canManage
                  ? "Create a project first, then add tasks with the form above or ask Marque AI."
                  : "Ask a workspace manager to add projects and tasks in this workspace, or ask Marque AI if your role allows it."}
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
                          <div className="flex flex-wrap items-center gap-2">
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
                            {canManage ? (
                              <TaskEditForm task={task} assignees={assigneeOptions} />
                            ) : null}
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
