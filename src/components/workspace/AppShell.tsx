"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  Headphones,
  ListChecks,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { HumanSupport } from "@/components/chat/HumanSupport";
import { ThemeToggle } from "@/components/chat/ThemeToggle";
import { SupportSummaryProvider } from "@/components/workspace/SupportSummaryContext";
import { NewChatProvider, useNewChat } from "@/components/workspace/NewChatContext";
import type {
  ConversationListItem,
} from "@/lib/conversationPersistence";
import type { WorkspaceContext } from "@/lib/workspace/types";

interface AppShellProps {
  context: WorkspaceContext;
  conversations: readonly ConversationListItem[];
  currentConversationId: string | null;
  children: ReactNode;
}

interface SidebarItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  comingSoon?: boolean;
}

const WORKSPACE_ITEMS: readonly SidebarItem[] = [
  { label: "Projects", icon: Folder, comingSoon: true },
  { label: "Tasks", icon: ListChecks, comingSoon: true },
];

const COLLAPSED_KEY = "marque-support:sidebar-collapsed";

function subscribeToCollapsed(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

function getCollapsedServerSnapshot(): boolean {
  return false;
}

export function AppShell(props: AppShellProps) {
  return (
    <NewChatProvider>
      <AppShellContent {...props} />
    </NewChatProvider>
  );
}

function AppShellContent({
  context,
  conversations,
  currentConversationId,
  children,
}: AppShellProps) {
  const router = useRouter();
  const { requestNewChat } = useNewChat();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportSummary, setSupportSummary] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchedConversations, setSearchedConversations] = useState<
    readonly ConversationListItem[] | null
  >(null);
  const [conversationOverrides, setConversationOverrides] = useState<
    Record<string, ConversationListItem | null>
  >({});

  const items = useMemo(() => {
    const base = searchedConversations ?? conversations;
    return base
      .filter((item) => conversationOverrides[item.id] !== null)
      .map((item) => conversationOverrides[item.id] ?? item);
  }, [conversations, conversationOverrides, searchedConversations]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-account-menu]")) {
        return;
      }
      setAccountMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!supportOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-support-menu]")) {
        return;
      }
      setSupportOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSupportOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [supportOpen]);

  useEffect(() => {
    const searchText = query.trim();
    if (!searchText) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/conversations?q=${encodeURIComponent(searchText)}`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          conversations: ConversationListItem[];
        };
        setSearchedConversations(body.conversations);
      } catch {
        return;
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query, pathname]);

  function closeMobile() {
    setMobileOpen(false);
    setAccountMenuOpen(false);
    setSupportOpen(false);
  }

  function toggleCollapsed() {
    const nextCollapsed = !collapsed;
    window.localStorage.setItem(COLLAPSED_KEY, String(nextCollapsed));
    window.dispatchEvent(new Event("storage"));
  }

  function focusSearch() {
    setSearchOpen(true);
    setHistoryOpen(true);
    setMobileOpen(false);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function renameConversation(conversation: ConversationListItem) {
    const nextTitle = window.prompt("Conversation title", conversation.title);
    if (!nextTitle || nextTitle.trim() === conversation.title) return;

    setBusyId(conversation.id);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: nextTitle.trim() }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        conversation: ConversationListItem;
      };
      setConversationOverrides((current) => ({
        ...current,
        [conversation.id]: body.conversation,
      }));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConversation(conversation: ConversationListItem) {
    if (!window.confirm(`Delete "${conversation.title}"?`)) return;

    setBusyId(conversation.id);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      setConversationOverrides((current) => ({
        ...current,
        [conversation.id]: null,
      }));
      if (currentConversationId === conversation.id) {
        router.replace("/c/new");
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function logout() {
    setAccountMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-surface text-foreground">
      <div
        className={`flex h-16 shrink-0 items-center gap-2 border-b border-border ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MarqueLogo
            alt="Marque AI"
            className="max-h-8 w-auto shrink-0"
            height={collapsed ? 10 : 16}
            priority
            width={collapsed ? 24 : 40}
          />
        </div>
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`ml-auto rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground ${
            collapsed ? "p-1.5" : "p-2"
          }`}
          onClick={toggleCollapsed}
          type="button"
        >
          {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
        <button
          aria-label="Close navigation"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden"
          onClick={closeMobile}
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <button
          className="mb-3 flex w-full items-center gap-3 rounded-lg bg-primary px-3 py-2.5 font-medium text-primary-foreground hover:bg-primary-hover"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMobile();
            requestNewChat();
          }}
          title="New Chat"
          type="button"
        >
          <Plus size={18} />
          {!collapsed ? <span>New Chat</span> : null}
        </button>

        {searchOpen && !collapsed ? (
          <input
            aria-label="Search conversations"
            className="mb-3 w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.trim()) setSearchedConversations(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                setSearchedConversations(null);
                setSearchOpen(false);
              }
            }}
            placeholder="Search conversations"
            ref={searchRef}
            type="search"
            value={query}
          />
        ) : (
          <button
            className="mb-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={focusSearch}
            title="Search conversations"
            type="button"
          >
            <Search size={18} />
            {!collapsed ? <span>Search</span> : null}
          </button>
        )}

        <button
          className="mb-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
          onClick={() => setHistoryOpen((value) => !value)}
          title="Chat History"
          type="button"
        >
          <MessageCircle size={18} />
          {!collapsed ? <span>Chat History</span> : null}
        </button>

        {!collapsed && historyOpen ? (
          <div className="mb-5">
            <ul className="space-y-1">
              {items.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  No conversations yet.
                </li>
              ) : null}
              {items.map((conversation) => {
                const isActive =
                  pathname === `/c/${conversation.id}` ||
                  currentConversationId === conversation.id;
                return (
                  <li className="group relative" key={conversation.id}>
                    <Link
                      className={`block truncate rounded-lg px-3 py-2 pr-14 text-sm ${
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "hover:bg-muted"
                      }`}
                      href={`/c/${conversation.id}`}
                      onClick={closeMobile}
                      title={conversation.title}
                    >
                      {conversation.title}
                    </Link>
                    <div className="absolute right-1 top-1.5 hidden gap-1 group-hover:flex group-focus-within:flex">
                      <button
                        aria-label={`Rename ${conversation.title}`}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        disabled={busyId === conversation.id}
                        onClick={() => renameConversation(conversation)}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={`Delete ${conversation.title}`}
                        className="rounded p-1 text-muted-foreground hover:bg-danger-subtle hover:text-danger disabled:opacity-50"
                        disabled={busyId === conversation.id}
                        onClick={() => deleteConversation(conversation)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <nav
          aria-label="Workspace modules"
          className="mt-4 space-y-1 border-t border-border pt-4"
        >
          {!collapsed ? (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Workspace
            </p>
          ) : null}
          {WORKSPACE_ITEMS.map((item) => (
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              key={item.label}
              title={collapsed ? `${item.label} (coming soon)` : "Coming soon"}
              type="button"
            >
              <item.icon size={18} />
              {!collapsed ? <span>{item.label}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="relative mb-2" data-support-menu="">
          <button
            aria-expanded={supportOpen}
            aria-label={supportOpen ? "Hide contact support" : "Contact support"}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted ${
              supportOpen ? "bg-accent text-accent-foreground" : ""
            }`}
            onClick={() => setSupportOpen((value) => !value)}
            title="Contact Support"
            type="button"
          >
            <Headphones size={18} />
            {!collapsed ? <span>Contact Support</span> : null}
            <ChevronDown
              className={`ml-auto shrink-0 transition-transform ${
                supportOpen ? "rotate-180" : ""
              }`}
              size={16}
            />
          </button>
          {supportOpen ? (
            <HumanSupport
              className={`absolute bottom-full right-0 z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] ${
                collapsed
                  ? "lg:bottom-0 lg:left-full lg:right-auto lg:mb-0 lg:ml-2 lg:max-w-none"
                  : ""
              }`}
              onClose={() => setSupportOpen(false)}
              summary={supportSummary}
            />
          ) : null}
        </div>
        <div className="relative border-t border-border pt-2" data-account-menu="">
          <button
            aria-expanded={accountMenuOpen}
            aria-label={accountMenuOpen ? "Close account menu" : "Open account menu"}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
            onClick={() => setAccountMenuOpen((value) => !value)}
            type="button"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {context.user.displayName.slice(0, 1).toUpperCase()}
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{context.user.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {context.user.email}
                </p>
              </div>
            ) : null}
            <MoreHorizontal className="ml-auto shrink-0 text-muted-foreground" size={18} />
          </button>
          {accountMenuOpen ? (
            <div
              className="absolute bottom-full right-0 z-50 mb-2 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-1 shadow-lg"
              role="menu"
            >
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                href="/profile"
                onClick={closeMobile}
                role="menuitem"
                title="Profile"
              >
                <UserRound size={18} />
                <span>Profile</span>
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                href="/settings"
                onClick={closeMobile}
                role="menuitem"
                title="Settings"
              >
                <Settings size={18} />
                <span>Settings</span>
              </Link>
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-subtle"
                onClick={logout}
                role="menuitem"
                title="Sign out"
                type="button"
              >
                <LogOut size={18} />
                <span>Sign out</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={`hidden shrink-0 border-r border-border lg:block ${
          collapsed ? "w-20" : "w-72"
        }`}
      >
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation overlay"
            className="absolute inset-0 bg-black/40"
            onClick={closeMobile}
            type="button"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border shadow-lg">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
          <button
            aria-label="Open navigation"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1" />
          <ThemeToggle />
        </header>
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6">
          <SupportSummaryProvider value={setSupportSummary}>
            {children}
          </SupportSummaryProvider>
        </main>
      </div>
    </div>
  );
}
