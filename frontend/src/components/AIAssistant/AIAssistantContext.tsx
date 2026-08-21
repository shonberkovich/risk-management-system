import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Shared open/context state for <AIAssistant/>, so any screen (e.g. PropertyDetail's
 * "נתח סיכונים באמצעות AI" button, TODO_SPEC.md §7) can open the assistant panel and
 * inject a property's context without the assistant being re-mounted per-route — it's
 * mounted once in Layout, same as the CopilotWidget it extends. */
export interface PropertyContext {
  propertyId: number;
  propertyName: string;
}

interface AIAssistantState {
  open: boolean;
  pendingPropertyContext: PropertyContext | null;
  setOpen: (open: boolean) => void;
  openWithProperty: (ctx: PropertyContext) => void;
  clearPendingPropertyContext: () => void;
}

const AIAssistantCtx = createContext<AIAssistantState | null>(null);

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingPropertyContext, setPendingPropertyContext] = useState<PropertyContext | null>(null);

  const openWithProperty = useCallback((ctx: PropertyContext) => {
    setPendingPropertyContext(ctx);
    setOpen(true);
  }, []);

  const clearPendingPropertyContext = useCallback(() => setPendingPropertyContext(null), []);

  const value = useMemo(
    () => ({ open, pendingPropertyContext, setOpen, openWithProperty, clearPendingPropertyContext }),
    [open, pendingPropertyContext, openWithProperty, clearPendingPropertyContext]
  );

  return <AIAssistantCtx.Provider value={value}>{children}</AIAssistantCtx.Provider>;
}

export function useAIAssistant(): AIAssistantState {
  const ctx = useContext(AIAssistantCtx);
  if (!ctx) {
    throw new Error("useAIAssistant must be used within an AIAssistantProvider");
  }
  return ctx;
}
