import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  FolderKanban,
  ListTodo,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  activities,
  approvals,
  overviewMetrics,
  projects,
  tasks,
  type ProjectStatus,
} from "@/lib/employee/mockData";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { AssistantWorkspace } from "@/components/employee/AssistantWorkspace";
import { Avatar } from "@/components/employee/Avatar";
import { MetricCard } from "@/components/employee/MetricCard";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { ProgressBar } from "@/components/employee/ProgressBar";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requireEmployee } from "@/lib/employee/access";
import { hasPermission } from "@/lib/employee/roles";

export const metadata: Metadata = {
  title: "Overview",
};

const metricIcons: LucideIcon[] = [FolderKanban, ListTodo, ShieldCheck, Users];

function projectTone(status: ProjectStatus) {
  if (status === "On track") return "success" as const;
  if (status === "At risk") return "warning" as const;
  if (status === "Blocked") return "danger" as const;
  return "neutral" as const;
}

export default async function DashboardPage() {
  const { user } = await requireEmployee();
  const canReviewApprovals = hasPermission(user.role, "approvals:review");
  const myTasks = tasks.filter((task) => task.assignee === user.name).slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company overview"
        title={`Good morning, ${user.name.split(" ")[0] ?? user.name}`}
        description="A concentrated view of delivery health, work in progress, approvals, and the people keeping Marque moving."
        actions={
          <>
            <PreviewButton icon={Plus}>New project</PreviewButton>
            <Link
              href="/assistant"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Ask assistant
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overviewMetrics.map((metric, index) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
            icon={metricIcons[index] ?? FolderKanban}
            tone={metric.tone}
          />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Active projects"
          description="Delivery portfolio snapshot from the preview dataset."
          className="xl:col-span-2"
          action={
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
            >
              View all
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {projects.slice(0, 4).map((project) => (
              <div
                key={project.id}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">{project.code}</span>
                    <StatusBadge tone={projectTone(project.status)}>{project.status}</StatusBadge>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{project.name}</p>
                </div>
                <div className="flex min-w-0 items-center gap-4 sm:w-[52%]">
                  <ProgressBar value={project.progress} className="flex-1" />
                  <Avatar name={project.owner} size="sm" />
                  <span className="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                    {project.dueDate}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="AI Operations Assistant"
          description="Ask about portfolio risk, pending work, and review queues."
          bodyClassName="p-3 sm:p-3"
        >
          <AssistantWorkspace compact />
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="My tasks"
          description="Assigned to the signed-in employee in the preview dataset."
          className="xl:col-span-2"
          action={
            <Link
              href="/tasks"
              className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
            >
              Open task queue
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {myTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{task.code}</p>
                  <p className="mt-0.5 truncate text-sm font-medium text-foreground">{task.title}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge tone={task.priority === "Urgent" ? "danger" : "warning"}>
                    {task.priority}
                  </StatusBadge>
                  <span className="hidden text-xs text-muted-foreground sm:block">{task.dueDate}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Pending approvals"
          description="Requests awaiting review."
          action={
            canReviewApprovals ? (
              <Link
                href="/approvals"
                className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
              >
                Review
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {approvals.slice(0, 3).map((approval) => (
              <div key={approval.id} className="px-4 py-3 sm:px-5">
                <p className="text-sm font-medium leading-snug text-foreground">{approval.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {approval.type} · {approval.submitted}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Recent project activity"
        description="Latest illustrative updates across projects, tasks, approvals, and automations."
        action={
          <Link
            href="/activity"
            className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
          >
            Full timeline
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <ActivityTimeline items={activities.slice(0, 5)} compact />
      </SectionCard>
    </div>
  );
}
