import "server-only";

import {
  getPersonalProjectRepository,
  personalUserIdFromAuth,
  type CreatePersonalProjectInput,
  type CreatePersonalTaskInput,
  type PersonalProjectRecord,
  type PersonalTaskRecord,
  type UpdatePersonalProjectInput,
  type UpdatePersonalTaskInput,
} from "@/lib/personalProjectData";
import { toWorkspaceToolRole } from "@/lib/workspace/authorization";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import { requireHybridWorkspaceAccess } from "@/lib/workspace/hybridWorkspaceData";
import { requireWorkspaceAssignee } from "@/lib/workspace/workspaceTeamData";
import type {
  HybridWorkspaceRecord,
  WorkspaceMemberRole,
  WorkspaceMembershipRecord,
} from "@/lib/workspace/types";

export type WorkspaceProjectScope =
  | {
      readonly kind: "personal";
      readonly userId: string;
    }
  | {
      readonly kind: "shared";
      readonly userId: string;
      readonly workspaceId: string;
      readonly workspace: HybridWorkspaceRecord;
      readonly membership: WorkspaceMembershipRecord;
    };

export type WorkspaceProjectRecord = PersonalProjectRecord & {
  readonly workspaceId: string | null;
};

export type WorkspaceTaskRecord = PersonalTaskRecord & {
  readonly workspaceId: string | null;
  readonly assigneeId?: string | null;
};

export type CreateWorkspaceProjectInput = CreatePersonalProjectInput;
export type CreateWorkspaceTaskInput = CreatePersonalTaskInput & {
  readonly assigneeId?: string | null;
};
export type UpdateWorkspaceProjectInput = UpdatePersonalProjectInput;
export type UpdateWorkspaceTaskInput = UpdatePersonalTaskInput & {
  readonly assigneeId?: string | null;
};

export interface WorkspaceProjectRepository {
  listProjects(
    scope: WorkspaceProjectScope,
    query?: string
  ): Promise<readonly WorkspaceProjectRecord[]>;
  getProjectById(
    scope: WorkspaceProjectScope,
    projectId: string
  ): Promise<WorkspaceProjectRecord | null>;
  getProjectsByName(
    scope: WorkspaceProjectScope,
    projectName: string
  ): Promise<readonly WorkspaceProjectRecord[]>;
  listTasks(
    scope: WorkspaceProjectScope,
    projectId: string
  ): Promise<readonly WorkspaceTaskRecord[]>;
  createProject(
    scope: WorkspaceProjectScope,
    input: CreateWorkspaceProjectInput
  ): Promise<WorkspaceProjectRecord>;
  createTask(
    scope: WorkspaceProjectScope,
    input: CreateWorkspaceTaskInput
  ): Promise<WorkspaceTaskRecord>;
  updateProject(
    scope: WorkspaceProjectScope,
    projectId: string,
    input: UpdateWorkspaceProjectInput
  ): Promise<WorkspaceProjectRecord | null>;
  updateTask(
    scope: WorkspaceProjectScope,
    taskId: string,
    input: UpdateWorkspaceTaskInput
  ): Promise<WorkspaceTaskRecord | null>;
}

export class WorkspaceProjectDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceProjectDataError";
  }
}

const PROJECT_COLUMNS =
  "id, user_id, workspace_id, name, status, progress_notes, blockers, created_at, updated_at";
const TASK_COLUMNS =
  "id, user_id, workspace_id, project_id, title, description, priority, status, assignee_id, assignee_label, created_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asProjectStatus(value: unknown): PersonalProjectRecord["status"] {
  return value === "active" ||
    value === "blocked" ||
    value === "completed"
    ? value
    : "planned";
}

function asTaskPriority(value: unknown): PersonalTaskRecord["priority"] {
  return value === "low" || value === "high" ? value : "medium";
}

function asTaskStatus(value: unknown): PersonalTaskRecord["status"] {
  return value === "in_progress" || value === "done" ? value : "todo";
}

function mapProject(row: unknown): WorkspaceProjectRecord {
  if (!isRecord(row)) {
    throw new WorkspaceProjectDataError("Project data was malformed.");
  }
  return {
    id: asString(row.id),
    name: asString(row.name),
    status: asProjectStatus(row.status),
    progressNotes: asString(row.progress_notes),
    blockers: asBlockers(row.blockers),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    userId: asString(row.user_id),
    workspaceId: asNullableString(row.workspace_id),
  };
}

function mapTask(row: unknown): WorkspaceTaskRecord {
  if (!isRecord(row)) {
    throw new WorkspaceProjectDataError("Task data was malformed.");
  }
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.title),
    description: asString(row.description),
    priority: asTaskPriority(row.priority),
    status: asTaskStatus(row.status),
    assignee: asString(row.assignee_label).trim() || "Unassigned",
    assigneeId: asNullableString(row.assignee_id),
    createdAt: asString(row.created_at),
    userId: asString(row.user_id),
    workspaceId: asNullableString(row.workspace_id),
  };
}

function personalProject(
  record: PersonalProjectRecord
): WorkspaceProjectRecord {
  return { ...record, workspaceId: null };
}

function personalTask(record: PersonalTaskRecord): WorkspaceTaskRecord {
  return { ...record, workspaceId: null, assigneeId: null };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function projectCode(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 22);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${base || "PROJECT"}-${suffix}`.slice(0, 32);
}

function taskCode(): string {
  return `TASK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function throwDatabaseError(operation: string, message: string): never {
  throw new WorkspaceProjectDataError(
    `Workspace project ${operation} failed: ${message.slice(0, 200)}`
  );
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

function requireSharedScope(
  scope: WorkspaceProjectScope
): Extract<WorkspaceProjectScope, { kind: "shared" }> {
  if (scope.kind !== "shared") {
    throw new WorkspaceAccessError(403, "A shared workspace is required.");
  }
  if (scope.workspace.type !== "business") {
    throw new WorkspaceAccessError(403, "Shared project data requires a business workspace.");
  }
  return scope;
}

function personalTaskInput(
  input: CreateWorkspaceTaskInput | UpdateWorkspaceTaskInput
): CreatePersonalTaskInput | UpdatePersonalTaskInput {
  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    throw new WorkspaceAccessError(
      400,
      "Member assignment is available only in business workspaces."
    );
  }
  const personalInput = { ...input } as Record<string, unknown>;
  delete personalInput.assigneeId;
  return personalInput as CreatePersonalTaskInput | UpdatePersonalTaskInput;
}

async function resolveSharedAssignment(
  scope: Extract<WorkspaceProjectScope, { kind: "shared" }>,
  assigneeId: string | null | undefined,
  assigneeLabel: string | undefined
): Promise<{ assignee: string; assigneeId: string | null }> {
  if (assigneeId === undefined) {
    return {
      assignee: assigneeLabel?.trim() || "Unassigned",
      assigneeId: null,
    };
  }
  if (assigneeId === null) {
    return { assignee: "Unassigned", assigneeId: null };
  }
  const member = await requireWorkspaceAssignee(
    {
      userId: scope.userId,
      role: toWorkspaceToolRole(scope.membership.role),
      workspaceKind: "shared",
      workspaceId: scope.workspaceId,
      source: "verified_membership",
      isDemo: false,
    },
    assigneeId
  );
  return { assignee: member.label, assigneeId: member.id };
}

const supabaseWorkspaceProjectRepository: WorkspaceProjectRepository = {
  async listProjects(scope, query) {
    if (scope.kind === "personal") {
      const projects = await getPersonalProjectRepository().listProjects(
        scope.userId,
        query
      );
      return projects.map(personalProject);
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    let request = supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", shared.workspaceId);

    if (query?.trim()) {
      request = request.ilike("name", `%${escapeLike(query.trim())}%`);
    }

    const { data, error } = await request
      .order("name", { ascending: true })
      .limit(100);
    if (error) throwDatabaseError("listing", error.message);
    return (data ?? []).map(mapProject);
  },

  async getProjectById(scope, projectId) {
    if (scope.kind === "personal") {
      const project = await getPersonalProjectRepository().getProjectById(
        scope.userId,
        projectId
      );
      return project ? personalProject(project) : null;
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", shared.workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (error) throwDatabaseError("retrieval", error.message);
    return data ? mapProject(data) : null;
  },

  async getProjectsByName(scope, projectName) {
    if (scope.kind === "personal") {
      const projects = await getPersonalProjectRepository().getProjectsByName(
        scope.userId,
        projectName
      );
      return projects.map(personalProject);
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", shared.workspaceId)
      .ilike("name", escapeLike(projectName.trim()))
      .order("name", { ascending: true })
      .limit(20);
    if (error) throwDatabaseError("retrieval", error.message);
    return (data ?? []).map(mapProject);
  },

  async listTasks(scope, projectId) {
    if (scope.kind === "personal") {
      const tasks = await getPersonalProjectRepository().listTasks(
        scope.userId,
        projectId
      );
      return tasks.map(personalTask);
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("workspace_id", shared.workspaceId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwDatabaseError("task listing", error.message);
    return (data ?? []).map(mapTask);
  },

  async createProject(scope, input) {
    if (scope.kind === "personal") {
      const project = await getPersonalProjectRepository().createProject(
        scope.userId,
        input
      );
      return personalProject(project);
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: shared.userId,
        workspace_id: shared.workspaceId,
        project_code: projectCode(input.name),
        name: input.name,
        status: input.status ?? "planned",
        progress_notes: input.progressNotes ?? "",
        blockers: input.blockers ?? [],
        created_by: shared.userId,
      })
      .select(PROJECT_COLUMNS)
      .single();
    if (error) throwDatabaseError("creation", error.message);
    return mapProject(data);
  },

  async createTask(scope, input) {
    if (scope.kind === "personal") {
      const task = await getPersonalProjectRepository().createTask(
        scope.userId,
        personalTaskInput(input) as CreatePersonalTaskInput
      );
      return personalTask(task);
    }

    const shared = requireSharedScope(scope);
    const supabase = await createClient();
    const parent = await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("id", input.projectId)
      .eq("workspace_id", shared.workspaceId)
      .maybeSingle();
    if (parent.error) throwDatabaseError("parent project lookup", parent.error.message);
    if (!parent.data) {
      throw new WorkspaceProjectDataError("Parent project is not in this workspace.");
    }

    const assignment = await resolveSharedAssignment(
      shared,
      input.assigneeId,
      input.assignee
    );
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: shared.userId,
        workspace_id: shared.workspaceId,
        project_id: input.projectId,
        task_code: taskCode(),
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        status: "todo",
        assignee_id: assignment.assigneeId,
        assignee_label: assignment.assignee,
        created_by: shared.userId,
      })
      .select(TASK_COLUMNS)
      .single();
    if (error) throwDatabaseError("task creation", error.message);
    return mapTask(data);
  },

  async updateProject(scope, projectId, input) {
    if (scope.kind === "personal") {
      const project = await getPersonalProjectRepository().updateProject(
        scope.userId,
        projectId,
        input
      );
      return project ? personalProject(project) : null;
    }

    const shared = requireSharedScope(scope);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.status !== undefined) patch.status = input.status;
    if (input.progressNotes !== undefined) patch.progress_notes = input.progressNotes;
    if (input.blockers !== undefined) patch.blockers = [...input.blockers];
    if (Object.keys(patch).length === 0) {
      return this.getProjectById(scope, projectId);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("workspace_id", shared.workspaceId)
      .eq("id", projectId)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) throwDatabaseError("project update", error.message);
    return data ? mapProject(data) : null;
  },

  async updateTask(scope, taskId, input) {
    if (scope.kind === "personal") {
      const task = await getPersonalProjectRepository().updateTask(
        scope.userId,
        taskId,
        personalTaskInput(input) as UpdatePersonalTaskInput
      );
      return task ? personalTask(task) : null;
    }

    const shared = requireSharedScope(scope);
    const assignment =
      input.assigneeId !== undefined || input.assignee !== undefined
        ? await resolveSharedAssignment(
            shared,
            input.assigneeId,
            input.assignee
          )
        : null;
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = input.status;
    if (assignment) {
      patch.assignee_id = assignment.assigneeId;
      patch.assignee_label = assignment.assignee;
    }
    if (Object.keys(patch).length === 0) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("workspace_id", shared.workspaceId)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throwDatabaseError("task retrieval", error.message);
      return data ? mapTask(data) : null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("workspace_id", shared.workspaceId)
      .eq("id", taskId)
      .select(TASK_COLUMNS)
      .maybeSingle();
    if (error) throwDatabaseError("task update", error.message);
    return data ? mapTask(data) : null;
  },
};

let activeRepository: WorkspaceProjectRepository = supabaseWorkspaceProjectRepository;

export function setWorkspaceProjectRepository(
  repository: WorkspaceProjectRepository
): void {
  activeRepository = repository;
}

export function resetWorkspaceProjectRepository(): void {
  activeRepository = supabaseWorkspaceProjectRepository;
}

export function getWorkspaceProjectRepository(): WorkspaceProjectRepository {
  return activeRepository;
}

export async function resolveWorkspaceProjectScope(
  auth: unknown,
  requiredRole: WorkspaceMemberRole = "viewer"
): Promise<WorkspaceProjectScope> {
  if (!isRecord(auth)) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }

  const userId = personalUserIdFromAuth(auth);
  if (auth.workspaceKind === "personal") {
    if (auth.source !== "personal_owner") {
      throw new WorkspaceAccessError(403, "Personal workspace ownership is required.");
    }
    if (typeof auth.workspaceId === "string" && auth.workspaceId.trim()) {
      throw new WorkspaceAccessError(403, "Personal data cannot carry a workspace id.");
    }
    return { kind: "personal", userId };
  }

  if (auth.workspaceKind === "shared") {
    if (typeof auth.workspaceId !== "string" || !auth.workspaceId.trim()) {
      throw new WorkspaceAccessError(400, "A verified workspace is required.");
    }
    if (
      auth.source !== "verified_membership" &&
      auth.source !== "legacy_marque_membership"
    ) {
      throw new WorkspaceAccessError(403, "Verified workspace membership is required.");
    }

    const { workspace, membership } = await requireHybridWorkspaceAccess(
      auth,
      auth.workspaceId,
      requiredRole
    );
    return {
      kind: "shared",
      userId,
      workspaceId: auth.workspaceId.trim(),
      workspace,
      membership,
    };
  }

  throw new WorkspaceAccessError(403, "Invalid workspace scope.");
}

export async function verifiedWorkspaceIdFromAuth(
  auth: unknown
): Promise<string | undefined> {
  const scope = await resolveWorkspaceProjectScope(auth);
  return scope.kind === "shared" ? scope.workspaceId : undefined;
}

export async function listWorkspaceProjects(
  auth: unknown,
  query?: string
): Promise<readonly WorkspaceProjectRecord[]> {
  return activeRepository.listProjects(
    await resolveWorkspaceProjectScope(auth),
    query
  );
}

export async function getWorkspaceProjectById(
  auth: unknown,
  projectId: string
): Promise<WorkspaceProjectRecord | null> {
  return activeRepository.getProjectById(
    await resolveWorkspaceProjectScope(auth),
    projectId
  );
}

export async function findWorkspaceProjectsByName(
  auth: unknown,
  projectName: string
): Promise<readonly WorkspaceProjectRecord[]> {
  return activeRepository.getProjectsByName(
    await resolveWorkspaceProjectScope(auth),
    projectName
  );
}

export async function listWorkspaceTasks(
  auth: unknown,
  projectId: string
): Promise<readonly WorkspaceTaskRecord[]> {
  return activeRepository.listTasks(
    await resolveWorkspaceProjectScope(auth),
    projectId
  );
}

export async function createWorkspaceProject(
  auth: unknown,
  input: CreateWorkspaceProjectInput
): Promise<WorkspaceProjectRecord> {
  return activeRepository.createProject(
    await resolveWorkspaceProjectScope(auth, "staff"),
    input
  );
}

export async function createWorkspaceTask(
  auth: unknown,
  input: CreateWorkspaceTaskInput
): Promise<WorkspaceTaskRecord> {
  return activeRepository.createTask(
    await resolveWorkspaceProjectScope(auth, "staff"),
    input
  );
}

export async function updateWorkspaceProject(
  auth: unknown,
  projectId: string,
  input: UpdateWorkspaceProjectInput
): Promise<WorkspaceProjectRecord | null> {
  return activeRepository.updateProject(
    await resolveWorkspaceProjectScope(auth, "staff"),
    projectId,
    input
  );
}

export async function updateWorkspaceTask(
  auth: unknown,
  taskId: string,
  input: UpdateWorkspaceTaskInput
): Promise<WorkspaceTaskRecord | null> {
  return activeRepository.updateTask(
    await resolveWorkspaceProjectScope(auth, "staff"),
    taskId,
    input
  );
}
