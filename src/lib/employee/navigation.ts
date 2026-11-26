import {
  Activity,
  CheckCircle2,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Plug,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { EmployeeRole } from "./roles";

export interface EmployeeNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles?: readonly EmployeeRole[];
}

export interface EmployeeNavGroup {
  label: string;
  items: EmployeeNavItem[];
}

export const employeeNavGroups: EmployeeNavGroup[] = [
  {
    label: "Main",
    items: [
      {
        href: "/dashboard",
        label: "Home",
        description: "Overview",
        icon: LayoutDashboard,
      },
      {
        href: "/assistant",
        label: "AI Assistant",
        description: "Ask a question",
        icon: Sparkles,
      },
      {
        href: "/projects",
        label: "Projects",
        description: "What is happening",
        icon: FolderKanban,
      },
      {
        href: "/tasks",
        label: "Tasks",
        description: "What needs doing",
        icon: ListTodo,
      },
      {
        href: "/my-tasks",
        label: "My tasks",
        description: "Assigned to me",
        icon: CheckCircle2,
      },
      {
        href: "/team",
        label: "Team",
        description: "People at Marque",
        icon: Users,
      },
      {
        href: "/approvals",
        label: "Approvals",
        description: "Requests to review",
        icon: ShieldCheck,
        roles: ["manager", "admin"],
      },
    ],
  },
  {
    label: "More",
    items: [
      {
        href: "/automations",
        label: "Automations",
        description: "Saved workflows",
        icon: Workflow,
        roles: ["manager", "admin"],
      },
      {
        href: "/integrations",
        label: "Integrations",
        description: "Connected services",
        icon: Plug,
      },
      {
        href: "/activity",
        label: "Activity",
        description: "Recent changes",
        icon: Activity,
      },
      {
        href: "/admin/employees",
        label: "Employees",
        description: "Invite and manage",
        icon: UserCog,
        roles: ["admin"],
      },
    ],
  },
];

export function getEmployeeNavGroups(role: EmployeeRole): EmployeeNavGroup[] {
  return employeeNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0);
}
