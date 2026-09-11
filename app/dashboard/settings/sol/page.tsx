import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { SolMemoryFact, SolPreferences } from "@/lib/db/solEntities";

import { SolSettingsClient } from "./SolSettingsClient";
import { SettingsShell } from "../../_components/SettingsShell";

export type SolTonePreset = "PROFESSIONAL" | "FRIENDLY" | "CONCISE" | "DETAILED";
export type SolModelTier = "BASIC" | "MEDIUM" | "HIGH";
export type SolResponseLength = "CONCISE" | "BALANCED" | "THOROUGH";
export type SolMemoryCategory = "PREFERENCE" | "FACT" | "TONE";
export type SolMemorySource = "USER_ADDED" | "LLM_EXTRACTED";

export type SolPreferencesData = {
  tonePreset: SolTonePreset | null;
  customInstructions: string;
  defaultModelTier: SolModelTier;
  memoryEnabled: boolean;
  responseLength: SolResponseLength;
};

export type SolMemoryItem = {
  id: string;
  text: string;
  category: SolMemoryCategory;
  source: SolMemorySource;
  sourceConversationId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Server component for /dashboard/settings/sol — SOL's own behavior settings (tone,
 * default model tier, response length, cross-conversation memory). Distinct from
 * /dashboard/settings/ai, which configures the page-builder's AI edit-in-place provider —
 * an unrelated, older feature that happens to share the word "AI".
 *
 * SolPreferences/SolMemoryFact are keyed by userId only (see lib/db/solEntities.ts), not
 * organizationId, so — like app/dashboard/profile/page.tsx — this skips
 * ensureActiveOrganization entirely; there's no org-scoped resource being read here.
 *
 * Reads Dynamo directly and passes initial data as props (same choice app/dashboard/
 * settings/ai/page.tsx and app/dashboard/profile/page.tsx both make) rather than having
 * the client fetch on mount, so the page renders with real data on first paint instead of
 * a loading flash.
 */
export default async function SolSettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/sol");
  }

  const userId = session.user.id;

  const [{ data: prefs }, { data: facts }] = await Promise.all([
    SolPreferences.get({ userId }).go(),
    SolMemoryFact.query.primary({ userId }).go({ pages: "all" }),
  ]);

  const initialPreferences: SolPreferencesData = {
    tonePreset: (prefs?.tonePreset as SolTonePreset | undefined) ?? null,
    customInstructions: prefs?.customInstructions ?? "",
    defaultModelTier: (prefs?.defaultModelTier as SolModelTier | undefined) ?? "BASIC",
    memoryEnabled: prefs?.memoryEnabled ?? true,
    responseLength: (prefs?.responseLength as SolResponseLength | undefined) ?? "BALANCED",
  };

  const initialMemories: SolMemoryItem[] = facts
    .map((f) => ({
      id: f.id,
      text: f.text,
      category: f.category as SolMemoryCategory,
      source: f.source as SolMemorySource,
      sourceConversationId: f.sourceConversationId ?? null,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <SettingsShell>
      <SolSettingsClient initialPreferences={initialPreferences} initialMemories={initialMemories} />
    </SettingsShell>
  );
}
