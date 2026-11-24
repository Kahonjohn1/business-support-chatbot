export type ProjectStatus = "On track" | "At risk" | "Blocked" | "Completed";

export interface Project {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  progress: number;
  owner: string;
  dueDate: string;
  taskCount: number;
  team: string[];
  summary: string;
}

export type TaskStatus = "Todo" | "In progress" | "In review" | "Blocked" | "Done";
export type TaskPriority = "Urgent" | "High" | "Medium" | "Low";

export interface Task {
  id: string;
  code: string;
  title: string;
  project: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string;
  dueDate: string;
  updated: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  team: string;
  email: string;
  status: "Active" | "Invited";
  location: string;
}

export interface Approval {
  id: string;
  title: string;
  type: string;
  requestedBy: string;
  submitted: string;
  project: string;
  impact: string;
  status: "Pending" | "Approved" | "Rejected";
  detail: string;
}

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  cadence: string;
  status: "Active" | "Paused" | "Needs review";
  lastRun: string;
  successRate: number;
  owner: string;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  status: "Connected" | "Available" | "Needs attention";
  connectedBy?: string;
  lastSync?: string;
  description: string;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
  group: "Today" | "Yesterday" | "Earlier";
  kind: "project" | "task" | "approval" | "team" | "automation";
}

export interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  time: string;
}

export const currentUser = {
  name: "Jordan Blake",
  role: "Operations Manager",
  initials: "JB",
};

export const overviewMetrics = [
  {
    label: "Active projects",
    value: "08",
    hint: "2 due this month",
    tone: "teal",
  },
  {
    label: "Open tasks",
    value: "34",
    hint: "7 marked urgent",
    tone: "blue",
  },
  {
    label: "Pending approvals",
    value: "05",
    hint: "Oldest request: 2 days",
    tone: "amber",
  },
  {
    label: "Team members",
    value: "18",
    hint: "3 invitations outstanding",
    tone: "violet",
  },
] as const;

export const projects: Project[] = [
  {
    id: "p1",
    code: "MRQ-104",
    name: "Marque Contact rollout",
    status: "On track",
    progress: 78,
    owner: "Amara Nwosu",
    dueDate: "18 Dec 2026",
    taskCount: 24,
    team: ["AN", "JB", "TK", "RL"],
    summary: "Customer-facing contact experience and NFC handoff release.",
  },
  {
    id: "p2",
    code: "MRQ-118",
    name: "Operations console",
    status: "At risk",
    progress: 54,
    owner: "Theo Kim",
    dueDate: "09 Dec 2026",
    taskCount: 31,
    team: ["TK", "MS", "DV", "JB"],
    summary: " Unified internal workspace for delivery, approvals, and reporting.",
  },
  {
    id: "p3",
    code: "MRQ-121",
    name: "Support automation phase 2",
    status: "On track",
    progress: 62,
    owner: "Rina Laurent",
    dueDate: "22 Dec 2026",
    taskCount: 18,
    team: ["RL", "AN", "PK"],
    summary: "Expand workflow coverage for recurring support operations.",
  },
  {
    id: "p4",
    code: "MRQ-097",
    name: "Knowledge base refresh",
    status: "Completed",
    progress: 100,
    owner: "Maya Shah",
    dueDate: "28 Nov 2026",
    taskCount: 12,
    team: ["MS", "DV"],
    summary: "Approved service, pricing, and support documentation update.",
  },
  {
    id: "p5",
    code: "MRQ-126",
    name: "Partner onboarding kit",
    status: "Blocked",
    progress: 28,
    owner: "Daniel Voss",
    dueDate: "15 Jan 2027",
    taskCount: 9,
    team: ["DV", "PK", "JB"],
    summary: "Standardized enablement material for new delivery partners.",
  },
];

export const tasks: Task[] = [
  {
    id: "t1",
    code: "MRQ-241",
    title: "Finalize approval review states",
    project: "Operations console",
    status: "In progress",
    priority: "Urgent",
    assignee: "Jordan Blake",
    dueDate: "25 Nov",
    updated: "12 min ago",
  },
  {
    id: "t2",
    code: "MRQ-238",
    title: "Validate NFC demo script",
    project: "Marque Contact rollout",
    status: "In review",
    priority: "High",
    assignee: "Amara Nwosu",
    dueDate: "26 Nov",
    updated: "1 hr ago",
  },
  {
    id: "t3",
    code: "MRQ-252",
    title: "Draft automation audit fields",
    project: "Support automation phase 2",
    status: "Todo",
    priority: "Medium",
    assignee: "Rina Laurent",
    dueDate: "28 Nov",
    updated: "3 hrs ago",
  },
  {
    id: "t4",
    code: "MRQ-229",
    title: "Resolve partner asset licensing",
    project: "Partner onboarding kit",
    status: "Blocked",
    priority: "High",
    assignee: "Daniel Voss",
    dueDate: "29 Nov",
    updated: "Yesterday",
  },
  {
    id: "t5",
    code: "MRQ-233",
    title: "Publish refreshed service KB",
    project: "Knowledge base refresh",
    status: "Done",
    priority: "Low",
    assignee: "Maya Shah",
    dueDate: "24 Nov",
    updated: "Yesterday",
  },
  {
    id: "t6",
    code: "MRQ-260",
    title: "Prepare weekly delivery report",
    project: "Operations console",
    status: "Todo",
    priority: "Medium",
    assignee: "Theo Kim",
    dueDate: "01 Dec",
    updated: "2 days ago",
  },
  {
    id: "t7",
    code: "MRQ-244",
    title: "Review integration permission map",
    project: "Support automation phase 2",
    status: "In progress",
    priority: "Urgent",
    assignee: "Jordan Blake",
    dueDate: "27 Nov",
    updated: "Today",
  },
];

export const teamMembers: TeamMember[] = [
  {
    id: "m1",
    name: "Jordan Blake",
    role: "Operations Manager",
    team: "Operations",
    email: "jordan.blake@marque.example",
    status: "Active",
    location: "Cape Town",
  },
  {
    id: "m2",
    name: "Amara Nwosu",
    role: "Product Lead",
    team: "Product",
    email: "amara.nwosu@marque.example",
    status: "Active",
    location: "London",
  },
  {
    id: "m3",
    name: "Theo Kim",
    role: "Engineering Lead",
    team: "Engineering",
    email: "theo.kim@marque.example",
    status: "Active",
    location: "Singapore",
  },
  {
    id: "m4",
    name: "Rina Laurent",
    role: "Automation Specialist",
    team: "Operations",
    email: "rina.laurent@marque.example",
    status: "Active",
    location: "Paris",
  },
  {
    id: "m5",
    name: "Maya Shah",
    role: "Knowledge Editor",
    team: "Support",
    email: "maya.shah@marque.example",
    status: "Active",
    location: "Dubai",
  },
  {
    id: "m6",
    name: "Daniel Voss",
    role: "Partnerships Manager",
    team: "Partnerships",
    email: "daniel.voss@marque.example",
    status: "Active",
    location: "Berlin",
  },
  {
    id: "m7",
    name: "Priya Kapoor",
    role: "Support Analyst",
    team: "Support",
    email: "priya.kapoor@marque.example",
    status: "Invited",
    location: "Toronto",
  },
];

export const approvals: Approval[] = [
  {
    id: "a1",
    title: "Publish updated support pricing guidance",
    type: "Knowledge base",
    requestedBy: "Maya Shah",
    submitted: "2 days ago",
    project: "Knowledge base refresh",
    impact: "Customer-facing documentation",
    status: "Pending",
    detail:
      "Approve the revised service and pricing language before it is visible in the public support assistant.",
  },
  {
    id: "a2",
    title: "Enable weekly workflow digest automation",
    type: "Automation",
    requestedBy: "Rina Laurent",
    submitted: "18 hrs ago",
    project: "Support automation phase 2",
    impact: "Internal operations",
    status: "Pending",
    detail:
      "Activate a scheduled summary of workflow runs, failures, and pending review items.",
  },
  {
    id: "a3",
    title: "Grant partner portal access to two reviewers",
    type: "Access request",
    requestedBy: "Daniel Voss",
    submitted: "6 hrs ago",
    project: "Partner onboarding kit",
    impact: "External collaboration",
    status: "Pending",
    detail:
      "Review temporary read-only access for partner-side documentation reviewers.",
  },
  {
    id: "a4",
    title: "Archive legacy contact workflow",
    type: "Workflow change",
    requestedBy: "Amara Nwosu",
    submitted: "Yesterday",
    project: "Marque Contact rollout",
    impact: "Delivery process",
    status: "Pending",
    detail:
      "Retire the previous handoff workflow after the new contact flow is verified.",
  },
];

export const automations: Automation[] = [
  {
    id: "au1",
    name: "Weekly delivery digest",
    trigger: "Schedule",
    cadence: "Fridays, 16:00",
    status: "Active",
    lastRun: "20 Nov, 16:00",
    successRate: 98,
    owner: "Rina Laurent",
  },
  {
    id: "au2",
    name: "Approval expiry reminder",
    trigger: "Timer",
    cadence: "Every 6 hours",
    status: "Active",
    lastRun: "24 Nov, 08:00",
    successRate: 100,
    owner: "Jordan Blake",
  },
  {
    id: "au3",
    name: "Knowledge review routing",
    trigger: "Task created",
    cadence: "On event",
    status: "Needs review",
    lastRun: "23 Nov, 11:42",
    successRate: 87,
    owner: "Maya Shah",
  },
  {
    id: "au4",
    name: "Partner asset sync",
    trigger: "Integration event",
    cadence: "Hourly",
    status: "Paused",
    lastRun: "18 Nov, 09:15",
    successRate: 74,
    owner: "Daniel Voss",
  },
];

export const integrations: Integration[] = [
  {
    id: "i1",
    name: "Supabase",
    category: "Data & authentication",
    status: "Connected",
    connectedBy: "Theo Kim",
    lastSync: "4 min ago",
    description: "Employee accounts, operational records, and audit storage.",
  },
  {
    id: "i2",
    name: "Groq",
    category: "AI provider",
    status: "Connected",
    connectedBy: "Jordan Blake",
    lastSync: "12 min ago",
    description: "Public support assistant and planned internal assistant runtime.",
  },
  {
    id: "i3",
    name: "Linear",
    category: "Delivery tracking",
    status: "Needs attention",
    connectedBy: "Amara Nwosu",
    lastSync: "2 days ago",
    description: "Project and issue synchronization for delivery reporting.",
  },
  {
    id: "i4",
    name: "Slack",
    category: "Communication",
    status: "Connected",
    connectedBy: "Rina Laurent",
    lastSync: "28 min ago",
    description: "Approval notifications and operational alerts.",
  },
  {
    id: "i5",
    name: "Google Drive",
    category: "Documents",
    status: "Available",
    description: "Connect approved company documents for internal operations.",
  },
  {
    id: "i6",
    name: "Zoom",
    category: "Meetings",
    status: "Available",
    description: "Link customer and delivery sessions to project records.",
  },
];

export const activities: ActivityItem[] = [
  {
    id: "ac1",
    actor: "Amara Nwosu",
    action: "moved to In review",
    target: "MRQ-238 · Validate NFC demo script",
    time: "10 min ago",
    group: "Today",
    kind: "task",
  },
  {
    id: "ac2",
    actor: "Maya Shah",
    action: "requested approval for",
    target: "Updated support pricing guidance",
    time: "42 min ago",
    group: "Today",
    kind: "approval",
  },
  {
    id: "ac3",
    actor: "Theo Kim",
    action: "updated progress on",
    target: "Operations console · 54%",
    time: "2 hrs ago",
    group: "Today",
    kind: "project",
  },
  {
    id: "ac4",
    actor: "Rina Laurent",
    action: "paused automation",
    target: "Knowledge review routing",
    time: "4 hrs ago",
    group: "Today",
    kind: "automation",
  },
  {
    id: "ac5",
    actor: "Priya Kapoor",
    action: "was invited to",
    target: "Support team",
    time: "Yesterday, 16:20",
    group: "Yesterday",
    kind: "team",
  },
  {
    id: "ac6",
    actor: "Jordan Blake",
    action: "approved",
    target: "Q4 support response template",
    time: "Yesterday, 11:05",
    group: "Yesterday",
    kind: "approval",
  },
];

export const assistantMessages: AssistantMessage[] = [
  {
    id: "am1",
    role: "user",
    content: "What needs attention before the Marque Contact rollout?",
    time: "09:41",
  },
  {
    id: "am2",
    role: "assistant",
    content:
      "Three items stand out in the preview data: one NFC demo task is awaiting review, the partner asset dependency is blocked, and an approval is pending for the updated support guidance. I would resolve the asset dependency first because it affects the partner onboarding track.",
    time: "09:41",
  },
  {
    id: "am3",
    role: "user",
    content: "Summarize project health for the leadership update.",
    time: "09:43",
  },
  {
    id: "am4",
    role: "assistant",
    content:
      "Five projects are represented in the preview. Three are on track, one is at risk, one is blocked, and one is complete. The main delivery risk is the Operations console timeline; the main external dependency is partner asset licensing.",
    time: "09:43",
  },
];

export const assistantPrompts = [
  "Summarize projects at risk",
  "List my urgent tasks",
  "Draft an approval review note",
  "Find overdue automation runs",
];
