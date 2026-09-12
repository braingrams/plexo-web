import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { SolMemoryFact } from "@/lib/db/solEntities";

import { SolMemoryPageClient } from "./SolMemoryPageClient";

export type SolMemoryCategory = "PREFERENCE" | "FACT" | "TONE";
export type SolMemorySource = "USER_ADDED" | "LLM_EXTRACTED";

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
 * SOL's memory — a dedicated page (not a section buried in Settings) since this is the
 * one place a user actually reviews/edits/deletes what Sol has stored about them, the same
 * way ChatGPT/Claude.ai give their own "memory" feature its own screen rather than folding
 * it into general settings. Lives under app/dashboard/sol/ so it nests inside SolShell —
 * the conversation sidebar stays visible.
 */
export default async function SolMemoryPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/sol/memory");
  }

  const { data: facts } = await SolMemoryFact.query.primary({ userId: session.user.id }).go({ pages: "all" });

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

  return <SolMemoryPageClient initialMemories={initialMemories} />;
}
