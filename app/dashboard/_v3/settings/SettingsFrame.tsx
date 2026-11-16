"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SETTINGS_SECTIONS, settingsLayout, type SettingsSection, type SettingsSectionId } from "@/lib/dashboardV3/settingsNav";
import type { Experience } from "@/lib/dashboardV3/nav";
import "./settings.css";

/** The Settings frame: a list of sections on the left (a swipeable row on phones), the section on the right. */
export function SettingsFrame({ current, experience, base = "/dashboard/settings", children }: { current: SettingsSectionId; experience: Experience; base?: string; children: React.ReactNode }) {
  const layout = settingsLayout(experience);
  const href = (s: SettingsSection) => s.href.replace("/dashboard/settings", base);
  const link = (s: SettingsSection) => (
    <Link key={s.id} href={href(s)} className="plx-set__link" aria-current={s.id === current ? "page" : undefined} data-tour={`settings-${s.id}`}>
      {s.label}
      <small>{s.blurb}</small>
    </Link>
  );
  const group = (title: string, items: SettingsSection[]) =>
    items.length ? (
      <details className="plx-set__group" open={items.some((s) => s.id === current) || undefined} key={title}>
        <summary>
          {title} <ChevronDown size={18} aria-hidden />
        </summary>
        {items.map(link)}
      </details>
    ) : null;
  return (
    <div className="plx-page">
      <div className="plx-set" data-tour="settings-main">
        <nav className="plx-set__mnav" aria-label="Settings sections">
          {[...layout.primary, ...layout.more, ...layout.developer].map((s) => (
            <Link key={s.id} href={href(s)} className="plx-set__pill" aria-current={s.id === current ? "page" : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        <nav className="plx-set__nav" aria-label="Settings" data-tour="settings-nav">
          <h2 className="plx-h3 plx-set__navtitle">Settings</h2>
          {layout.primary.map(link)}
          {group("More", layout.more)}
          {group("For developers", layout.developer)}
        </nav>
        <div className="plx-set__body">{children}</div>
      </div>
    </div>
  );
}

export { SETTINGS_SECTIONS };
