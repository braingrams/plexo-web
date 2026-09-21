import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { SolPreferences } from "@/lib/db/solEntities";

import { SolSettingsPageClient } from "./SolSettingsPageClient";

export type SolTonePreset = "PROFESSIONAL" | "FRIENDLY" | "CONCISE" | "DETAILED";
export type SolModelTier = "BASIC" | "MEDIUM" | "HIGH";
export type SolResponseLength = "CONCISE" | "BALANCED" | "THOROUGH";

export type SolPreferencesData = {
  tonePreset: SolTonePreset | null;
  customInstructions: string;
  defaultModelTier: SolModelTier;
  memoryEnabled: boolean;
  responseLength: SolResponseLength;
};

/**
 * SOL's own behavior settings — tone, default model tier, response length, and the
 * memory on/off switch (the actual memory list lives at its own dedicated
 * /dashboard/sol/memory page, not here). Lives under app/dashboard/sol/ specifically
 * (not app/dashboard/settings/) so it nests inside app/dashboard/sol/layout.tsx's SolShell —
 * the conversation sidebar stays visible and the page reads as part of SOL, not a
 * standard dashboard settings page that happens to be reachable from SOL's sidebar.
 *
 * SolPreferences is keyed by userId only (see lib/db/solEntities.ts), not organizationId,
 * so this skips org resolution entirely — there's no org-scoped resource being read.
 */
export default async function SolSettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/sol/settings");
  }

  const { data: prefs } = await SolPreferences.get({ userId: session.user.id }).go();

  const initialPreferences: SolPreferencesData = {
    tonePreset: (prefs?.tonePreset as SolTonePreset | undefined) ?? null,
    customInstructions: prefs?.customInstructions ?? "",
    defaultModelTier: (prefs?.defaultModelTier as SolModelTier | undefined) ?? "BASIC",
    memoryEnabled: prefs?.memoryEnabled ?? true,
    responseLength: (prefs?.responseLength as SolResponseLength | undefined) ?? "BALANCED",
  };

  return <SolSettingsPageClient initialPreferences={initialPreferences} />;
}
