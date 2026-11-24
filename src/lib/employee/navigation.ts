import {
  Activity,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface EmployeeNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
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
      },
      {
        href: "/approvals",
        label: "Approvals",
        description: "Review queue",
        icon: ShieldCheck,
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
];
