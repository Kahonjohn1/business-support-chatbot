"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface NewChatContextValue {
  readonly requestId: number;
  readonly requestNewChat: () => void;
}

const NewChatContext = createContext<NewChatContextValue | null>(null);

export function NewChatProvider({ children }: { children: ReactNode }) {
  const [requestId, setRequestId] = useState(0);
  const requestNewChat = useCallback(() => {
    setRequestId((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({ requestId, requestNewChat }),
    [requestId, requestNewChat]
  );

  return (
    <NewChatContext.Provider value={value}>
      {children}
    </NewChatContext.Provider>
  );
}

export function useNewChat(): NewChatContextValue {
  const value = useContext(NewChatContext);
  if (!value) {
    throw new Error("useNewChat must be used within NewChatProvider");
  }
  return value;
}
