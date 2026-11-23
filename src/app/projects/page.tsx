import Link from "next/link";
import { AppShell } from "@/components/workspace/AppShell";
import { ProjectCreateForm } from "@/components/workspace/ProjectManagementForms";
import type { WorkspaceProjectRecord } from "@/lib/workspace/workspaceProjectData";
import { listWorkspaceProjects } from "@/lib/workspace/workspaceProjectData";
import { getActiveWorkspaceContext, toWorkspaceSwitcherView } from "@/lib/workspace/workspaceSelection";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";

export const instant = false;

const PROJECT_STATUS_LABELS: Record<WorkspaceProjectRecord["status"], string> = {
  planned: "Planned",
  active: "Active",
  blocked: "Blocked",
  completed: "Completed",
};

const PROJECT_STATUS_CLASSES: Record<WorkspaceProjectRecord["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-accent text-accent-foreground",
  blocked: "bg-danger-subtle text-danger",
  completed: "bg-muted text-foreground",
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export default async function ProjectsPage() {
  const context = await requireUserPage("/projects");
  const { selection, auth } = await getActiveWorkspaceContext(context);
  const canManage = auth.role !== "viewer";
  const [conversations, projects] = await Promise.all([
    getConversationList(context),
    listWorkspaceProjects(auth).catch(() => null),
  ]);
  const loadError =
    projects === null ? "Saved projects could not be loaded right now." : null;
  const visibleProjects = projects ?? [];

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
            <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Projects saved in {selection.active.name}.
            </p>
          </div>
          <Link
            className="inline-flex w-fit items-center rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            href="/tasks"
          >
            View tasks
          </Link>
        </div>

        {canManage ? (
          <div className="mt-6">
            <ProjectCreateForm />
          </div>
        ) : null}

        <div className="mt-6">
          {loadError ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <p className="font-medium">{loadError}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try again later. No project data was changed.
              </p>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
              <p className="font-medium">No projects in {selection.active.name} yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {canManage
                  ? "Create your first project with the form above or ask Marque AI to create one in this workspace."
                  : "Ask a workspace manager to create a project in this workspace, or ask Marque AI if your role allows it."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    className="block rounded-2xl border border-border bg-surface p-5 shadow-xs transition-colors hover:bg-accent"
                    href={`/projects/${project.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {project.name}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS_CLASSES[project.status]}`}
                      >
                        {PROJECT_STATUS_LABELS[project.status]}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {project.progressNotes.trim() || "No progress notes yet."}
                    </p>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Updated {formatUpdatedAt(project.updatedAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
