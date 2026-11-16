"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { effectiveTheme, themeCookieString, type ThemePreference } from "@/lib/dashboardV3/theme";
import { SegmentedControl } from "../ui/SegmentedControl";

type ThemeCtx = { preference: ThemePreference; resolved: "light" | "dark"; setPreference: (p: ThemePreference) => void };
const Ctx = createContext<ThemeCtx | null>(null);

/**
 * The v3 root element. It carries `data-theme` (rendered by the server from the saved choice,
 * so the first paint is right) and changes it instantly when the person picks another one —
 * then remembers the choice in the cookie and on their account.
 */
export function V3ThemeRoot({
  initialPreference,
  persist = true,
  className,
  style,
  children,
}: {
  initialPreference: ThemePreference;
  /** Save to the account (off in the dev preview, where there's no signed-in person). */
  persist?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [preference, setPref] = useState<ThemePreference>(initialPreference);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Mirror onto <html> so the page background behind overscroll and native controls match.
  useEffect(() => {
    const html = document.documentElement;
    const before = html.dataset.theme;
    html.dataset.theme = preference;
    return () => {
      if (before) html.dataset.theme = before;
      else delete html.dataset.theme;
    };
  }, [preference]);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      setPref(p);
      document.cookie = themeCookieString(p);
      if (persist) {
        void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ themePreference: p }) }).catch(() => {});
      }
    },
    [persist],
  );

  const value = useMemo(() => ({ preference, resolved: effectiveTheme(preference, systemDark), setPreference }), [preference, systemDark, setPreference]);

  return (
    <Ctx.Provider value={value}>
      <div data-plexo-v3="" data-theme={preference} className={className} style={style}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useV3Theme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useV3Theme must be used inside V3ThemeRoot.");
  return ctx;
}

/** Light / Dark / System. `compact` shows icons only (top bar on smaller screens). */
export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { preference, setPreference } = useV3Theme();
  return (
    <SegmentedControl<ThemePreference>
      label="Appearance"
      value={preference}
      onChange={setPreference}
      options={[
        { value: "light", label: "Light", icon: compact ? <Sun size={16} aria-hidden /> : undefined, hideLabel: compact },
        { value: "dark", label: "Dark", icon: compact ? <Moon size={16} aria-hidden /> : undefined, hideLabel: compact },
        { value: "system", label: "System", icon: compact ? <Monitor size={16} aria-hidden /> : undefined, hideLabel: compact },
      ]}
    />
  );
}
