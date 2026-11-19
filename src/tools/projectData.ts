import { findNameMatches } from "@/lib/resourceMatching";

export type ProjectStatus = {
  projectId: string;
  name: string;
  status: "planned" | "active" | "blocked" | "completed";
  updatedAt: string;
  progressNotes: string;
  blockers: string[];
};

export type ProjectResolution =
  | { status: "resolved"; project: ProjectStatus }
  | { status: "ambiguous"; matches: ProjectStatus[] }
  | { status: "not_found" };

export type ProjectChoice = {
  name: string;
  status: ProjectStatus["status"];
};

export type ProjectDetails = {
  name: string;
  status: ProjectStatus["status"];
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

export function getAllProjects(): readonly ProjectStatus[] {
  return demoProjects;
}

export function findProjectMatches(
  query: string,
  projects: readonly ProjectStatus[] = demoProjects
): ProjectStatus[] {
  return findNameMatches(query, projects, (project) => project.name);
}

export function resolveProjectByName(
  name: string,
  projects: readonly ProjectStatus[] = demoProjects
): ProjectResolution {
  const matches = findProjectMatches(name, projects);
  if (matches.length === 1) {
    return { status: "resolved", project: matches[0] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "not_found" };
}

export function toProjectChoice(project: ProjectStatus): ProjectChoice {
  return { name: project.name, status: project.status };
}

export function toProjectDetails(project: ProjectStatus): ProjectDetails {
  return {
    name: project.name,
    status: project.status,
    updatedAt: project.updatedAt,
    progressNotes: project.progressNotes,
    blockers: project.blockers,
  };
}
