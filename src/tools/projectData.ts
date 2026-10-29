
export type ProjectStatus = {
  projectId: string;
  name: string;
  status: "planned" | "active" | "blocked" | "completed";
  updatedAt: string;
  progressNotes: string;
  blockers: string[];
};

const demoProjects: ProjectStatus[] = [
  {
    projectId: "PRJ-104",
    name: "Business Support Chatbot",
    status: "active",
    updatedAt: "2026-10-29",
    progressNotes: "Building the chatbot's controlled tool-calling workflow.",
    blockers: [],
  },
];

export function getProjectStatus(
  projectId: string
): ProjectStatus | null {
  const normalizedId = projectId.trim().toUpperCase();

  return (
    demoProjects.find(
      (project) => project.projectId === normalizedId
    ) ?? null
  );
}
