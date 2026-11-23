import {
  resetPersonalProjectRepository,
  setPersonalProjectRepository,
  type CreatePersonalProjectInput,
  type CreatePersonalTaskInput,
  type PersonalProjectRecord,
  type PersonalProjectRepository,
  type PersonalTaskRecord,
  type UpdatePersonalProjectInput,
  type UpdatePersonalTaskInput,
} from "../src/lib/personalProjectData.ts";

export const USER_A = "user-a";
export const USER_B = "user-b";

export const AUTH_A = {
  userId: USER_A,
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;
export const AUTH_B = {
  userId: USER_B,
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;
export const ADMIN_AUTH = AUTH_A;

type RepositoryMethod = keyof PersonalProjectRepository;

export class FakePersonalRepository implements PersonalProjectRepository {
  readonly projects: PersonalProjectRecord[] = [];
  readonly tasks: PersonalTaskRecord[] = [];
  readonly failures = new Set<RepositoryMethod>();
  createTaskCalls = 0;

  private id(prefix: string): string {
    return `${prefix}-${this.projects.length + this.tasks.length + 1}`;
  }

  private fail(method: RepositoryMethod): void {
    if (this.failures.has(method)) {
      throw new Error("simulated database failure");
    }
  }

  async listProjects(userId: string, query?: string) {
    this.fail("listProjects");
    const needle = query?.trim().toLowerCase() ?? "";
    return this.projects.filter(
      (project) =>
        project.userId === userId &&
        (!needle || project.name.toLowerCase().includes(needle))
    );
  }

  async getProjectById(userId: string, projectId: string) {
    this.fail("getProjectById");
    return (
      this.projects.find(
        (project) =>
        project.userId === userId && project.id === projectId

      ) ?? null
    );
  }

  async getProjectsByName(userId: string, projectName: string) {
    this.fail("getProjectsByName");
    return this.projects.filter(
      (project) =>
        project.userId === userId &&
        project.name.toLowerCase() === projectName.trim().toLowerCase()
    );
  }

  async listTasks(userId: string, projectId: string) {
    this.fail("listTasks");
    return this.tasks.filter(
      (task) => task.userId === userId && task.projectId === projectId
    );
  }

  async createProject(userId: string, input: CreatePersonalProjectInput) {
    this.fail("createProject");
    const now = new Date().toISOString();
    const project: PersonalProjectRecord = {
      id: this.id("project"),
      name: input.name,
      status: input.status ?? "planned",
      progressNotes: input.progressNotes ?? "",
      blockers: input.blockers ?? [],
      createdAt: now,
      updatedAt: now,
      userId,
    };
    this.projects.push(project);
    return project;
  }

  async createTask(userId: string, input: CreatePersonalTaskInput) {
    this.fail("createTask");
    const parent = this.projects.find(
      (project) => project.id === input.projectId && project.userId === userId
    );
    if (!parent) {
      throw new Error("parent project does not belong to the authenticated user");
    }
    this.createTaskCalls += 1;
    const task: PersonalTaskRecord = {
      id: this.id("task"),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "medium",
      status: "todo",
      assignee: input.assignee?.trim() || "Unassigned",
      createdAt: new Date().toISOString(),
      userId,
    };
    this.tasks.push(task);
    return task;
  }

  async updateProject(
    userId: string,
    projectId: string,
    input: UpdatePersonalProjectInput
  ) {
    this.fail("updateProject");
    const index = this.projects.findIndex(
      (project) => project.userId === userId && project.id === projectId
    );
    if (index < 0) return null;
    const current = this.projects[index];
    const updated: PersonalProjectRecord = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.progressNotes !== undefined
        ? { progressNotes: input.progressNotes }
        : {}),
      ...(input.blockers !== undefined
        ? { blockers: [...input.blockers] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.projects[index] = updated;
    return updated;
  }

  async updateTask(
    userId: string,
    taskId: string,
    input: UpdatePersonalTaskInput
  ) {
    this.fail("updateTask");
    const index = this.tasks.findIndex(
      (task) => task.userId === userId && task.id === taskId
    );
    if (index < 0) return null;
    const current = this.tasks[index];
    const updated: PersonalTaskRecord = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    };
    this.tasks[index] = updated;
    return updated;
  }
}

export function installPersonalRepository(repository: FakePersonalRepository) {
  setPersonalProjectRepository(repository);
  return repository;
}

export function resetPersonalRepository(): void {
  resetPersonalProjectRepository();
}

export function seedProject(
  repository: FakePersonalRepository,
  userId: string,
  name: string,
  status: PersonalProjectRecord["status"] = "active",
  progressNotes = "Draft copy approved.",
  blockers: string[] = []
): PersonalProjectRecord {
  const now = new Date().toISOString();
  const project: PersonalProjectRecord = {
    id: `project-${repository.projects.length + 1}`,
    name,
    status,
    progressNotes,
    blockers,
    createdAt: now,
    updatedAt: now,
    userId,
  };
  repository.projects.push(project);
  return project;
}

export function seedTask(
  repository: FakePersonalRepository,
  userId: string,
  projectId: string,
  title: string
): PersonalTaskRecord {
  const task: PersonalTaskRecord = {
    id: `task-${repository.tasks.length + 1}`,
    projectId,
    title,
    description: "",
    priority: "medium",
    status: "todo",
    assignee: "Unassigned",
    createdAt: new Date().toISOString(),
    userId,
  };
  repository.tasks.push(task);
  return task;
}
