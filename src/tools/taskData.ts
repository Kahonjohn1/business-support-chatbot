export interface ProjectTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority: "low" | "medium" | "high";
  readonly status: "todo" | "in_progress" | "done";
  readonly assignee?: string;
  readonly createdAt: string;
  readonly sampleData: true;
}

export const DEMO_TASK_NOTICE =
  "DEMO DATA ONLY: This task record is sample data, not verified company information.";

const initialDemoTasks: ProjectTask[] = [
  {
    taskId: "TSK-101",
    projectId: "PRJ-104",
    title: "Implement approval workflow for business tools",
    description: "Design server-side confirmation mechanism with replay protection.",
    priority: "high",
    status: "in_progress",
    assignee: "Engineering Team",
    createdAt: "2026-11-10T10:00:00.000Z",
    sampleData: true,
  },
  {
    taskId: "TSK-102",
    projectId: "PRJ-104",
    title: "Verify demo task audit logging",
    description: "Ensure all execution events are recorded with scrubbed details.",
    priority: "medium",
    status: "todo",
    assignee: "QA Team",
    createdAt: "2026-11-12T14:30:00.000Z",
    sampleData: true,
  },
];

let demoTasks: ProjectTask[] = [...initialDemoTasks];
let taskCounter = 103;

export function getTasksForProject(projectId: string): ProjectTask[] {
  const normalized = projectId.trim().toUpperCase();
  return demoTasks.filter((task) => task.projectId === normalized);
}

export function createTask(params: {
  projectId: string;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  assignee?: string;
}): ProjectTask {
  const newTask: ProjectTask = {
    taskId: `TSK-${taskCounter++}`,
    projectId: params.projectId.trim().toUpperCase(),
    title: params.title.trim(),
    description: params.description?.trim(),
    priority: params.priority ?? "medium",
    status: "todo",
    assignee: params.assignee?.trim() || "Unassigned",
    createdAt: new Date().toISOString(),
    sampleData: true,
  };

  demoTasks.push(newTask);
  return newTask;
}

export function resetDemoTasks(): void {
  demoTasks = [...initialDemoTasks];
  taskCounter = 103;
}
