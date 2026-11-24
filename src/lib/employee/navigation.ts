import {
  Activity,
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
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        description: "Company overview",
        icon: LayoutDashboard,
      },
      {
        href: "/projects",
        label: "Projects",
        description: "Delivery portfolio",
        icon: FolderKanban,
      },
      {
        href: "/tasks",
        label: "Tasks",
        description: "Work queue",
        icon: ListTodo,
      },
      {
        href: "/team",
        label: "Team",
        description: "Employee directory",
        icon: Users,
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        href: "/assistant",
        label: "AI Assistant",
        description: "Operations support",
        icon: Sparkles,
      },
      {
        href: "/automations",
        label: "Automations",
        description: "Workflow runs",
        icon: Workflow,
        roles: ["manager", "admin"],
      },
      {
        href: "/approvals",
        label: "Approvals",
        description: "Review queue",
        icon: ShieldCheck,
        roles: ["manager", "admin"],
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/integrations",
        label: "Integrations",
        description: "Connected services",
        icon: Plug,
      },
      {
        href: "/activity",
        label: "Activity",
        description: "Audit timeline",
        icon: Activity,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/admin/employees",
        label: "Employees",
        description: "Invite and manage roles",
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
