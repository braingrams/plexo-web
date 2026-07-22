"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type LayoutMode = "CLASSIC" | "MODERN";

type LayoutModeContextValue = {
  mode: LayoutMode;
  /** Optimistically switches the mode and persists it. Resolves to false if the save failed (state is reverted). */
  setMode: (mode: LayoutMode) => Promise<boolean>;
  saving: boolean;
  error: string | null;
};

const LayoutModeContext = createContext<LayoutModeContextValue | null>(null);

export function LayoutModeProvider({
  initialMode,
  children,
}: {
  initialMode: LayoutMode;
  children: React.ReactNode;
}) {
  const [mode, setModeState] = useState<LayoutMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = useCallback(async (next: LayoutMode): Promise<boolean> => {
    const previous = mode;
    if (next === previous) return true;

    setModeState(next);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutMode: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to save layout preference.");
      }
      return true;
    } catch (updateError) {
      setModeState(previous);
      setError(updateError instanceof Error ? updateError.message : "Unable to save layout preference.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode, saving, error }), [mode, setMode, saving, error]);

  return (
    <div data-layout={mode.toLowerCase()} style={{ minHeight: "100vh" }}>
      <LayoutModeContext.Provider value={value}>{children}</LayoutModeContext.Provider>
    </div>
  );
}

export function useLayoutMode(): LayoutModeContextValue {
  const ctx = useContext(LayoutModeContext);
  if (!ctx) {
    throw new Error("useLayoutMode must be used within a LayoutModeProvider");
  }
  return ctx;
}
