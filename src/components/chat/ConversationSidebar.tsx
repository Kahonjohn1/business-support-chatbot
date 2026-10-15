"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { Conversation } from "@/types/chat";
import {
  formatConversationTime,
  groupConversationsByDate,
} from "@/lib/conversations";
import { useIsHydrated } from "@/hooks/useIsHydrated";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeConversationId,
  isOpen,
  onClose,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
}) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isHydrated = useIsHydrated();
  const now = useMemo(() => (isHydrated ? new Date() : null), [isHydrated]);

  const groups = useMemo(
    () => (now ? groupConversationsByDate(conversations, now) : []),
    [conversations, now]
  );

  useEffect(() => {
    if (openMenuId === null) return;

    const handleDocumentClick = () => setOpenMenuId(null);
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [openMenuId]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (conversation: Conversation) => {
    setOpenMenuId(null);
    setRenamingId(conversation.id);
    setRenameValue(conversation.title);
  };

  const commitRename = () => {
    if (renamingId === null) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameConversation(renamingId, trimmed);
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const handleSelect = (id: string) => {
    onSelectConversation(id);
    onClose();
  };

  const handleNewConversation = () => {
    onNewConversation();
    onClose();
  };

  const handleDelete = (id: string) => {
    setOpenMenuId(null);
    onDeleteConversation(id);
  };

  return (
    <aside
      aria-label="Conversation history"
      className={`absolute inset-y-0 left-0 z-40 flex w-72 max-w-[82%] flex-col bg-surface border-r border-border transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 ${
        isOpen ? "translate-x-0 shadow-lg lg:shadow-none" : "-translate-x-full"
      }`}
    >
      {/* New chat action pinned to the top of the sidebar */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 shrink-0">
        <button
          type="button"
          onClick={handleNewConversation}
          className="inline-flex flex-1 items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-medium rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-hover text-primary-foreground shadow-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          aria-label="New Chat"
          title="New Chat"
        >
          <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />
          <span>New Chat</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-lg transition-colors lg:hidden shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Close conversation history"
          title="Close conversation history"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Chat history section, below the new chat action */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 shrink-0">
        <h3 className="text-sm font-semibold text-foreground leading-tight truncate">
          Chat history
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {conversations.length === 0 ? (
          isHydrated ? (
            <div className="flex flex-col items-center justify-center h-full px-4 py-10 text-center">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-background border border-border mb-3">
                <svg
                  className="w-5 h-5 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 6.75h7.5M8.25 12h4.5m-8.25 8.25l2.4-1.6a2.25 2.25 0 011.25-.38h11.1a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 6v10.5c0 .34.076.663.212.953z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground">
                No saved conversations
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Start a new chat and it will appear here.
              </p>
            </div>
          ) : null
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <h3 className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h3>
                <ul className="space-y-0.5">
                  {group.conversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const isRenaming = renamingId === conversation.id;

                    return (
                      <li key={conversation.id} className="relative">
                        {isRenaming ? (
                          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-background border border-primary/40">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitRename();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              onBlur={commitRename}
                              aria-label="Conversation title"
                              className="flex-1 min-w-0 bg-transparent text-sm text-foreground focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div
                            className={`group flex items-center gap-1 rounded-lg transition-colors ${
                              isActive
                                ? "bg-accent border border-primary/30"
                                : "border border-transparent hover:bg-background"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelect(conversation.id)}
                              className="flex flex-col items-start flex-1 min-w-0 px-3 py-2 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
                              aria-current={isActive ? "true" : undefined}
                            >
                              <span
                                className={`block w-full truncate text-sm ${
                                  isActive
                                    ? "font-semibold text-accent-foreground"
                                    : "font-medium text-foreground"
                                }`}
                              >
                                {conversation.title}
                              </span>
                              <span className="block mt-0.5 text-[11px] text-muted-foreground">
                                {now
                                  ? formatConversationTime(
                                      conversation.updatedAt,
                                      now
                                    )
                                  : ""}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((current) =>
                                  current === conversation.id
                                    ? null
                                    : conversation.id
                                );
                              }}
                              className={`p-1.5 mr-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${
                                openMenuId === conversation.id
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                              }`}
                              aria-label={`More options for ${conversation.title}`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === conversation.id}
                              title="More options"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                                aria-hidden="true"
                              >
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                          </div>
                        )}

                        {openMenuId === conversation.id && (
                          <div
                            role="menu"
                            aria-label={`Options for ${conversation.title}`}
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-2 top-full z-50 mt-1 w-36 py-1 bg-surface border border-border rounded-lg shadow-md"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => startRename(conversation)}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-foreground hover:bg-background transition-colors cursor-pointer focus:outline-none focus:bg-background"
                            >
                              <svg
                                className="w-4 h-4 text-muted-foreground"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                                />
                              </svg>
                              <span>Rename</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => handleDelete(conversation.id)}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger-subtle transition-colors cursor-pointer focus:outline-none focus:bg-danger-subtle"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                                />
                              </svg>
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
