import "server-only";

export type PersonalProjectStatus =
  | "planned"
  | "active"
  | "blocked"
  | "completed";

export type PersonalTaskStatus = "todo" | "in_progress" | "done";

export type PersonalTaskPriority = "low" | "medium" | "high";

export interface PersonalProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly status: PersonalProjectStatus;
  readonly progressNotes: string;
  readonly blockers: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly userId: string;
}

export interface PersonalTaskRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: PersonalTaskPriority;
  readonly status: PersonalTaskStatus;
  readonly assignee: string;
  readonly createdAt: string;
  readonly userId: string;
}

export interface CreatePersonalProjectInput {
  readonly name: string;
  readonly status?: PersonalProjectStatus;
  readonly progressNotes?: string;
  readonly blockers?: readonly string[];
}

export interface CreatePersonalTaskInput {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: PersonalTaskPriority;
  readonly assignee?: string;
}

export interface UpdatePersonalProjectInput {
  readonly name?: string;
  readonly status?: PersonalProjectStatus;
  readonly progressNotes?: string;
  readonly blockers?: readonly string[];
}

export interface UpdatePersonalTaskInput {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: PersonalTaskPriority;
  readonly status?: PersonalTaskStatus;
  readonly assignee?: string;
}

export interface PersonalProjectRepository {
  listProjects(
    userId: string,
    query?: string
  ): Promise<readonly PersonalProjectRecord[]>;
  getProjectById(
    userId: string,
    projectId: string
  ): Promise<PersonalProjectRecord | null>;
  getProjectsByName(
    userId: string,
    projectName: string
  ): Promise<readonly PersonalProjectRecord[]>;
  listTasks(
    userId: string,
    projectId: string
  ): Promise<readonly PersonalTaskRecord[]>;
  createProject(
    userId: string,
    input: CreatePersonalProjectInput
  ): Promise<PersonalProjectRecord>;
  createTask(
    userId: string,
    input: CreatePersonalTaskInput
  ): Promise<PersonalTaskRecord>;
  updateProject(
    userId: string,
    projectId: string,
    input: UpdatePersonalProjectInput
  ): Promise<PersonalProjectRecord | null>;
  updateTask(
    userId: string,
    taskId: string,
    input: UpdatePersonalTaskInput
  ): Promise<PersonalTaskRecord | null>;
}

export class PersonalDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalDataError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ownership is only ever taken from the server-verified authorization context.
 * No model argument or browser value can reach this function.
 */
export function personalUserIdFromAuth(auth: unknown): string {
  if (!isRecord(auth) || typeof auth.userId !== "string") {
    throw new PersonalDataError("A verified user identity is required.");
  }
  const userId = auth.userId.trim();
  if (!userId) {
    throw new PersonalDataError("A verified user identity is required.");
  }
  return userId;
}

function requireOwnership(userId: string): string {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new PersonalDataError("A verified user identity is required.");
  }
  return userId.trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asProjectStatus(value: unknown): PersonalProjectStatus {
  return value === "active" ||
    value === "blocked" ||
    value === "completed"
    ? value
    : "planned";
}

function asTaskPriority(value: unknown): PersonalTaskPriority {
  return value === "low" || value === "high" ? value : "medium";
}

function asTaskStatus(value: unknown): PersonalTaskStatus {
  return value === "in_progress" || value === "done" ? value : "todo";
}

function mapProject(row: unknown): PersonalProjectRecord {
  if (!isRecord(row)) {
    throw new PersonalDataError("Personal project data was malformed.");
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
  };
}

function mapTask(row: unknown): PersonalTaskRecord {
  if (!isRecord(row)) {
    throw new PersonalDataError("Personal task data was malformed.");
  }
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.title),
    description: asString(row.description),
    priority: asTaskPriority(row.priority),
    status: asTaskStatus(row.status),
    assignee:
      asString(row.assignee_label).trim() || "Unassigned",
    createdAt: asString(row.created_at),
    userId: asString(row.user_id),
  };
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
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

function throwDatabaseError(operation: string, message: string): never {
  throw new PersonalDataError(
    `Personal project ${operation} failed: ${message.slice(0, 200)}`
  );
}

const supabasePersonalProjectRepository: PersonalProjectRepository = {
  async listProjects(userId, query) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    let request = supabase
      .from("projects")
      .select(
        "id, user_id, name, status, progress_notes, blockers, created_at, updated_at"
      )
      .eq("user_id", owner);

    if (query?.trim()) {
      request = request.ilike("name", `%${escapeLike(query.trim())}%`);
    }

    const { data, error } = await request
      .order("name", { ascending: true })
      .limit(100);
    if (error) throwDatabaseError("listing", error.message);
    return (data ?? []).map(mapProject);
  },

  async getProjectById(userId, projectId) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, user_id, name, status, progress_notes, blockers, created_at, updated_at"
      )
      .eq("user_id", owner)
      .eq("id", projectId)
      .maybeSingle();
    if (error) throwDatabaseError("retrieval", error.message);
    return data ? mapProject(data) : null;
  },

  async getProjectsByName(userId, projectName) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, user_id, name, status, progress_notes, blockers, created_at, updated_at"
      )
      .eq("user_id", owner)
      .ilike("name", escapeLike(projectName.trim()))
      .order("name", { ascending: true })
      .limit(20);
    if (error) throwDatabaseError("retrieval", error.message);
    return (data ?? []).map(mapProject);
  },

  async listTasks(userId, projectId) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, user_id, project_id, title, description, priority, status, assignee_label, created_at"
      )
      .eq("user_id", owner)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwDatabaseError("task listing", error.message);
    return (data ?? []).map(mapTask);
  },

  async createProject(userId, input) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: owner,
        project_code: projectCode(input.name),
        name: input.name,
        status: input.status ?? "planned",
        progress_notes: input.progressNotes ?? "",
        blockers: input.blockers ?? [],
        created_by: owner,
      })
      .select(
        "id, user_id, name, status, progress_notes, blockers, created_at, updated_at"
      )
      .single();
    if (error) throwDatabaseError("creation", error.message);
    return mapProject(data);
  },

  async createTask(userId, input) {
    const owner = requireOwnership(userId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: owner,
        project_id: input.projectId,
        task_code: `TASK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        status: "todo",
        assignee_label: input.assignee?.trim() || "Unassigned",
        created_by: owner,
      })
      .select(
        "id, user_id, project_id, title, description, priority, status, assignee_label, created_at"
      )
      .single();
    if (error) throwDatabaseError("task creation", error.message);
    return mapTask(data);
  },

  async updateProject(userId, projectId, input) {
    const owner = requireOwnership(userId);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.status !== undefined) patch.status = input.status;
    if (input.progressNotes !== undefined) patch.progress_notes = input.progressNotes;
    if (input.blockers !== undefined) patch.blockers = [...input.blockers];
    if (Object.keys(patch).length === 0) {
      return this.getProjectById(owner, projectId);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("user_id", owner)
      .eq("id", projectId)
      .select(
        "id, user_id, name, status, progress_notes, blockers, created_at, updated_at"
      )
      .maybeSingle();
    if (error) throwDatabaseError("project update", error.message);
    return data ? mapProject(data) : null;
  },

  async updateTask(userId, taskId, input) {
    const owner = requireOwnership(userId);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = input.status;
    if (input.assignee !== undefined) patch.assignee_label = input.assignee;
    if (Object.keys(patch).length === 0) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, user_id, project_id, title, description, priority, status, assignee_label, created_at"
        )
        .eq("user_id", owner)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throwDatabaseError("task retrieval", error.message);
      return data ? mapTask(data) : null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("user_id", owner)
      .eq("id", taskId)
      .select(
        "id, user_id, project_id, title, description, priority, status, assignee_label, created_at"
      )
      .maybeSingle();
    if (error) throwDatabaseError("task update", error.message);
    return data ? mapTask(data) : null;
  },
};

let activeRepository: PersonalProjectRepository =
  supabasePersonalProjectRepository;

/** Replaces the repository. Used by tests; production always uses Supabase. */
export function setPersonalProjectRepository(
  repository: PersonalProjectRepository
): void {
  activeRepository = repository;
}

export function resetPersonalProjectRepository(): void {
  activeRepository = supabasePersonalProjectRepository;
}

export function getPersonalProjectRepository(): PersonalProjectRepository {
  return activeRepository;
}

export async function listPersonalProjects(
  auth: unknown,
  query?: string
): Promise<readonly PersonalProjectRecord[]> {
  return activeRepository.listProjects(personalUserIdFromAuth(auth), query);
}

export async function getPersonalProjectById(
  auth: unknown,
  projectId: string
): Promise<PersonalProjectRecord | null> {
  return activeRepository.getProjectById(personalUserIdFromAuth(auth), projectId);
}

export async function findPersonalProjectsByName(
  auth: unknown,
  projectName: string
): Promise<readonly PersonalProjectRecord[]> {
  return activeRepository.getProjectsByName(
    personalUserIdFromAuth(auth),
    projectName
  );
}

export async function listPersonalTasks(
  auth: unknown,
  projectId: string
): Promise<readonly PersonalTaskRecord[]> {
  return activeRepository.listTasks(personalUserIdFromAuth(auth), projectId);
}

export async function createPersonalProject(
  auth: unknown,
  input: CreatePersonalProjectInput
): Promise<PersonalProjectRecord> {
  return activeRepository.createProject(personalUserIdFromAuth(auth), input);
}

export async function createPersonalTask(
  auth: unknown,
  input: CreatePersonalTaskInput
): Promise<PersonalTaskRecord> {
  return activeRepository.createTask(personalUserIdFromAuth(auth), input);
}

export async function updatePersonalProject(
  auth: unknown,
  projectId: string,
  input: UpdatePersonalProjectInput
): Promise<PersonalProjectRecord | null> {
  return activeRepository.updateProject(
    personalUserIdFromAuth(auth),
    projectId,
    input
  );
}

export async function updatePersonalTask(
  auth: unknown,
  taskId: string,
  input: UpdatePersonalTaskInput
): Promise<PersonalTaskRecord | null> {
  return activeRepository.updateTask(personalUserIdFromAuth(auth), taskId, input);
}
