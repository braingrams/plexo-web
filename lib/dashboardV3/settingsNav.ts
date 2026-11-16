/**
 * The sections of Settings, and which ones a person sees (docs/redesign/SPEC.md "Experience
 * levels"): beginners get the few they need with the rest under "More", intermediate gets
 * everything but developer tools, and developer tools sit in a collapsed "For developers"
 * group for everyone except pros. Pure.
 */
import type { Experience } from "./nav";

export type SettingsSectionId = "profile" | "plan" | "notifications" | "team" | "domains" | "connect" | "moving" | "developers";

export type SettingsSection = { id: SettingsSectionId; label: string; blurb: string; href: string };

export const SETTINGS_SECTIONS: Record<SettingsSectionId, SettingsSection> = {
  profile: { id: "profile", label: "You & how Plexo looks", blurb: "Your name, photo and how Plexo looks and feels.", href: "/dashboard/settings" },
  plan: { id: "plan", label: "Plan & billing", blurb: "What you have, what it costs and your receipts.", href: "/dashboard/settings/plan" },
  notifications: { id: "notifications", label: "Notifications", blurb: "Choose which emails Plexo sends you.", href: "/dashboard/settings/notifications" },
  team: { id: "team", label: "Team", blurb: "Invite people to help with your sites.", href: "/dashboard/settings/team" },
  domains: { id: "domains", label: "Web addresses", blurb: "Every address across your sites, and your own.", href: "/dashboard/settings/domains" },
  connect: { id: "connect", label: "Connect AI tools", blurb: "Build with Claude, ChatGPT or Cursor.", href: "/dashboard/settings/connect" },
  moving: { id: "moving", label: "Move a site", blurb: "Give a site to someone, or bring one in.", href: "/dashboard/settings/moving" },
  developers: { id: "developers", label: "Developers", blurb: "API keys, the SDK and embedding.", href: "/dashboard/settings/developers" },
};

export type SettingsLayout = {
  primary: SettingsSection[];
  /** A collapsed "More" group (beginners only). */
  more: SettingsSection[];
  /** Developer tools: part of `primary` for pros, otherwise a collapsed "For developers" group. */
  developer: SettingsSection[];
};

const S = SETTINGS_SECTIONS;

export function settingsLayout(experience: Experience): SettingsLayout {
  if (experience === "pro") return { primary: [S.profile, S.plan, S.notifications, S.team, S.domains, S.connect, S.moving, S.developers], more: [], developer: [] };
  if (experience === "intermediate") return { primary: [S.profile, S.plan, S.notifications, S.team, S.domains, S.connect, S.moving], more: [], developer: [S.developers] };
  return { primary: [S.profile, S.plan, S.notifications], more: [S.team, S.domains, S.connect, S.moving], developer: [S.developers] };
}

/** The section a path belongs to. */
export function settingsSectionOf(pathname: string): SettingsSectionId {
  const clean = pathname.replace(/\/+$/, "");
  const hit = (Object.values(SETTINGS_SECTIONS) as SettingsSection[]).find((s) => s.id !== "profile" && (clean === s.href || clean.startsWith(`${s.href}/`)));
  return hit?.id ?? "profile";
}
