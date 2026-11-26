import type { Metadata } from "next";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/employee/PageHeader";
import { SectionCard } from "@/components/employee/SectionCard";
import { TasksWorkspace } from "@/components/employee/TasksWorkspace";
import { requireEmployee } from "@/lib/employee/access";
import { getEmployeeCompanyData } from "@/lib/employee/workspaceData";

export const metadata: Metadata = {
  title: "My tasks",
};

export default async function MyTasksPage() {
  const session = await requireEmployee();
  const { tasks } = await getEmployeeCompanyData();
  const myTasks = tasks.filter((task) => task.assigneeId === session.user.id);
  const openTasks = myTasks.filter((task) => task.status !== "done").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My work"
        title="My tasks"
        description="Tasks assigned to you. You can change only the status of your own work."
      />

      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-selected-teal text-action-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Open assignments</p>
            <p className="mt-0.5 text-xl font-semibold text-foreground">
              {String(openTasks).padStart(2, "0")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-action-teal" aria-hidden="true" />
          Status updates only
        </div>
      </div>

      <SectionCard
        title="Assigned to me"
        description="Your deadline, priority and current status at a glance."
        bodyClassName="p-4 sm:p-5"
      >
        <TasksWorkspace tasks={myTasks} currentUserId={session.user.id} />
      </SectionCard>
    </div>
  );
}
