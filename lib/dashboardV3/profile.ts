/**
 * The v3 user fields (lib/db/coreEntities.ts User): validation for what the profile API
 * accepts, and safe readers for what the dashboard renders. Pure.
 */
import type { SolBuildProfile, SolBuildGoal } from "@/lib/ai/solBuildContext";
import { parseExperience, type Experience } from "./nav";
import { parseBusinessType } from "@/lib/onboarding/businessType";

export const BUILD_GOALS: readonly SolBuildGoal[] = ["store", "business-site", "blog", "course", "link-in-bio", "landing", "app", "explore"] as const;

export function parseBuildGoal(value: unknown): SolBuildGoal | null {
  return typeof value === "string" && (BUILD_GOALS as readonly string[]).includes(value) ? (value as SolBuildGoal) : null;
}

const LIMITS = { name: 100, about: 500, industry: 100, tone: 60, color: 32, logoUrl: 1000 } as const;
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function text(value: unknown, field: string, max: number): Result<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `Please type your ${field} as plain text.` };
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length > max) return { ok: false, error: `Your ${field} is a little long. Please keep it under ${max} characters.` };
  return { ok: true, value: v || undefined };
}

/** Accepts what onboarding sends, drops anything unknown, and explains problems in plain words. */
export function sanitizeBuildProfile(input: unknown): Result<SolBuildProfile> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "We couldn't read your answers. Please try again." };
  const raw = input as Record<string, unknown>;
  const out: SolBuildProfile = {};
  if (raw.goal !== undefined && raw.goal !== null) {
    const goal = parseBuildGoal(raw.goal);
    if (!goal) return { ok: false, error: "Please choose what you want to make from the list." };
    out.goal = goal;
  }
  if (raw.experience !== undefined && raw.experience !== null) {
    const experience = parseExperience(raw.experience);
    if (!experience) return { ok: false, error: "Please choose how much you've built before from the list." };
    out.experience = experience;
  }
  if (raw.brand !== undefined && raw.brand !== null) {
    if (typeof raw.brand !== "object" || Array.isArray(raw.brand)) return { ok: false, error: "We couldn't read your brand details. Please try again." };
    const b = raw.brand as Record<string, unknown>;
    const brand: NonNullable<SolBuildProfile["brand"]> = {};
    const fields: [keyof typeof LIMITS & keyof typeof brand, string][] = [["name", "business name"], ["about", "description"], ["industry", "industry"], ["tone", "style"], ["logoUrl", "logo link"]];
    for (const [key, label] of fields) {
      const r = text(b[key], label, LIMITS[key]);
      if (!r.ok) return r;
      if (r.value) (brand as Record<string, string>)[key] = r.value;
    }
    const bt = parseBusinessType(b.businessType);
    if (bt) brand.businessType = bt;
    if (brand.logoUrl && !/^https:\/\//i.test(brand.logoUrl)) return { ok: false, error: "Your logo needs to be uploaded again. Please pick the file once more." };
    if (b.colors !== undefined && b.colors !== null) {
      if (!Array.isArray(b.colors)) return { ok: false, error: "We couldn't read your colours. Please pick them again." };
      const colors = b.colors.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean);
      if (colors.length > 6 || colors.some((c) => c.length > LIMITS.color || !COLOR.test(c))) return { ok: false, error: "Please pick up to 6 colours from the colour picker." };
      if (colors.length) brand.colors = colors;
    }
    if (Object.keys(brand).length) out.brand = brand;
  }
  return { ok: true, value: out };
}

/** Reads a stored buildProfile defensively (it's a schemaless field). */
export function readBuildProfile(stored: unknown): SolBuildProfile | undefined {
  if (!stored) return undefined;
  const r = sanitizeBuildProfile(stored);
  if (r.ok) return Object.keys(r.value).length ? r.value : undefined;
  // An older or partly-invalid record: keep whatever still validates on its own.
  const raw = stored as Record<string, unknown>;
  const goal = parseBuildGoal(raw.goal);
  const experience = parseExperience(raw.experience);
  const out: SolBuildProfile = {};
  if (goal) out.goal = goal;
  if (experience) out.experience = experience;
  return Object.keys(out).length ? out : undefined;
}

/** The experience level the dashboard uses: the user's own choice, then onboarding's answer, then beginner. */
export function userExperience(user: { experience?: string | null; buildProfile?: unknown } | null | undefined): Experience {
  return parseExperience(user?.experience) ?? readBuildProfile(user?.buildProfile)?.experience ?? "beginner";
}
