"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Bell, Code2, CreditCard, Globe, Palette, Plug, Repeat2, User, Users, type LucideIcon } from "lucide-react";
import { SETTINGS_SECTIONS, settingsTabs, type SettingsSection, type SettingsSectionId } from "@/lib/dashboardV3/settingsNav";
import type { Experience } from "@/lib/dashboardV3/nav";
import "./settings.css";

const ICONS: Record<SettingsSectionId, LucideIcon> = { profile: User, plan: CreditCard, team: Users, domains: Globe, brand: Palette, notifications: Bell, connect: Plug, developers: Code2, moving: Repeat2 };

/**
 * The Settings frame: "Settings" and ONE row of tabs (every section visible, scrolls sideways on
 * a phone), then the page using the full width. No second sidebar.
 */
export function SettingsFrame({ current, experience, base = "/dashboard/settings", children }: { current: SettingsSectionId; experience: Experience; base?: string; children: React.ReactNode }) {
  const tabs = settingsTabs(experience);
  const href = (s: SettingsSection) => s.href.replace("/dashboard/settings", base);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = rail.current;
    if (el && box) box.scrollLeft = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
  }, [current]);
  return (
    <div className="plx-set" data-tour="settings-main">
      <div className="plx-set__top">
        <h1 className="plx-h1 plx-set__title">Settings</h1>
        <nav className="plx-set__tabs" aria-label="Settings sections" data-tour="settings-nav">
          <div className="plx-set__rail" ref={rail}>
            {tabs.map((s) => {
              const Icon = ICONS[s.id];
              return (
                <Link key={s.id} href={href(s)} className="plx-set__tab" aria-current={s.id === current ? "page" : undefined} data-tour={`settings-${s.id}`}>
                  <Icon size={18} aria-hidden />
                  <span>{s.label}</span>
                  {s.hint ? <small>{s.hint}</small> : null}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
      <div className="plx-set__body">{children}</div>
    </div>
  );
}

export { SETTINGS_SECTIONS };
