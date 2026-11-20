/**
 * The sections of Settings, grouped by what a person came to do (docs/redesign/SETTINGS_IA.md):
 * YOU, YOUR PLAN, YOUR WORKSPACE, CONNECT. Developer tools sit in a collapsed "For developers"
 * drawer for everyone except pros. Pure.
 */
import type { Experience } from "./nav";

export type SettingsSectionId = "profile" | "plan" | "team" | "domains" | "brand" | "notifications" | "connect" | "developers" | "moving" | "migration";

export type SettingsSection = { id: SettingsSectionId; label: string; blurb: string; href: string; /** A small hint under the tab for people who can ignore it. */ hint?: string };

export const SETTINGS_SECTIONS: Record<SettingsSectionId, SettingsSection> = {
  profile: { id: "profile", label: "Profile", blurb: "Your name, photo, and how Plexo looks and feels.", href: "/dashboard/settings" },
  plan: { id: "plan", label: "Plan & billing", blurb: "What you have, what you use and your receipts.", href: "/dashboard/settings/plan" },
  team: { id: "team", label: "Team", blurb: "Invite people to help with your sites.", href: "/dashboard/settings/team" },
  domains: { id: "domains", label: "Domains", blurb: "Every web address across your sites, and your own.", href: "/dashboard/settings/domains" },
  brand: { id: "brand", label: "Branding", blurb: "Your own name, logo and colour across Plexo.", href: "/dashboard/settings/branding" },
  notifications: { id: "notifications", label: "Notifications", blurb: "Choose which emails Plexo sends you.", href: "/dashboard/settings/notifications" },
  connect: { id: "connect", label: "AI tools", blurb: "Build with Claude, ChatGPT or Cursor.", href: "/dashboard/settings/connect" },
  developers: { id: "developers", label: "Developers", blurb: "API keys, the SDK and embedding.", href: "/dashboard/settings/developers", hint: "For developers" },
  moving: { id: "moving", label: "Move a site", blurb: "Give a site to someone, or bring one in.", href: "/dashboard/settings/moving" },
  migration: { id: "migration", label: "WordPress moves", blurb: "Every site you moved from WordPress, what came across, and run it again.", href: "/dashboard/settings/migration" },
};

/**
 * The one row of tabs, in the order people need them (most often first). Every section is always
 * visible: nothing hides behind a "More" menu. Experience only changes the first tab's neighbours:
 * pros see Developers right after AI tools, everyone else sees it near the end.
 */
export function settingsTabs(experience: Experience): SettingsSection[] {
  const S = SETTINGS_SECTIONS;
  const base = [S.profile, S.plan, S.team, S.domains, S.brand, S.notifications, S.connect];
  return experience === "pro" ? [...base, S.developers, S.moving, S.migration] : [...base, S.moving, S.migration, S.developers];
}

/** The section a path belongs to ("/dashboard/settings" itself is Profile). */
export function settingsSectionOf(pathname: string): SettingsSectionId {
  const clean = pathname.replace(/\/+$/, "");
  const hit = (Object.values(SETTINGS_SECTIONS) as SettingsSection[]).find((s) => s.id !== "profile" && (clean === s.href || clean.startsWith(`${s.href}/`)));
  return hit?.id ?? "profile";
}
