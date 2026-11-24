import type { Metadata } from "next";
import { CheckCircle2, ListTodo, Plus, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { TasksWorkspace } from "@/components/employee/TasksWorkspace";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work queue"
        title="Tasks"
        description="Review assignments, priority, status, and recent updates across all preview workstreams."
        actions={
          <>
            <PreviewButton icon={SlidersHorizontal} variant="secondary">
              Saved views
            </PreviewButton>
            <PreviewButton icon={Plus}>New task</PreviewButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Open tasks</p>
            <ListTodo className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">34</p>
          <p className="mt-2 text-[11px] text-muted-foreground">7 marked urgent</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">In review</p>
            <CheckCircle2 className="h-4 w-4 text-[#6B3FA0]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">09</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Awaiting reviewer sign-off</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Due this week</p>
            <ListTodo className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">12</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Across four projects</p>
        </div>
      </div>

      <SectionCard
        title="Task list"
        description="Filters are interactive; records remain illustrative preview data."
        bodyClassName="p-4 sm:p-5"
      >
        <TasksWorkspace />
      </SectionCard>
    </div>
  );
}
