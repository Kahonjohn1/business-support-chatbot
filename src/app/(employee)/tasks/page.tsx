import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, ListTodo, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { TaskCreateForm } from "@/components/employee/TaskCreateForm";
import { TasksWorkspace } from "@/components/employee/TasksWorkspace";
import { requireEmployee } from "@/lib/employee/access";
import { assertMarqueAdministrator } from "@/lib/employee/companyInvitations";
import { getTaskAssigneeOptions } from "@/lib/employee/projectTaskManagement";
import { hasRoleAtLeast } from "@/lib/employee/roles";
import { createClient } from "@/lib/supabase/server";
import { getEmployeeCompanyData } from "@/lib/employee/workspaceData";

export const metadata: Metadata = {
  title: "Tasks",
};

export default async function TasksPage() {
  const session = await requireEmployee();
  const { projects, tasks } = await getEmployeeCompanyData();
  const supabase = await createClient();
  const canManage =
    hasRoleAtLeast(session.user.role, "manager") &&
    !(await assertMarqueAdministrator(supabase, session.user.id));
  const assignees = canManage ? await getTaskAssigneeOptions(supabase) : [];
  const projectOptions = projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
  }));
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress").length;
  const highPriorityTasks = tasks.filter(
    (task) => task.priority === "high" && task.status !== "done"
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work queue"
        title="Tasks"
        description="Review assignments, priority, and status across the workstreams available to your account."
        actions={
          <>
            <PreviewButton icon={SlidersHorizontal} variant="secondary">
              Saved views
            </PreviewButton>
            {canManage ? (
              <TaskCreateForm projects={projectOptions} assignees={assignees} />
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Open tasks</p>
            <ListTodo className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(openTasks).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Not marked done</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">In progress</p>
            <CheckCircle2 className="h-4 w-4 text-[#6B3FA0]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(inProgressTasks).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Currently being worked</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">High priority</p>
            <AlertTriangle className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(highPriorityTasks).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Open work marked high priority</p>
        </div>
      </div>

      <SectionCard
        title="Task list"
        description="Live records available through your company access policies."
        bodyClassName="p-4 sm:p-5"
      >
        <TasksWorkspace tasks={tasks} currentUserId={session.user.id} />
      </SectionCard>
    </div>
  );
}
