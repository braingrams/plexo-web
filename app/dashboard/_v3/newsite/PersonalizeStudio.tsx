"use client";

import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { SolStudio } from "../sol/studio/SolStudio";
import { StudioCreditsError, type StudioApi } from "../sol/studio/types";
import { useStudioScript } from "../sol/studio/useStudioScript";
import { browserPlace } from "@/lib/onboarding/place";
import type { AskUserQuestionSpec } from "../../sol/_components/types";

export type PersonalizeDesign = { id: string; name: string; description?: string; html: string };
export type PersonalizeResult = { html: string; summary: string; creditsRemaining?: number };

type Plan = { domain: string; summary: string; questions: AskUserQuestionSpec[] };

/** One stage of SOL personalizing a design (see app/api/onboarding/personalize). Plain-words errors; a 402 becomes the top-up flow. */
async function callStage<T>(stage: "plan" | "write" | "finish", body: Record<string, unknown>, creditCost: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/onboarding/personalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, ...body }) });
  } catch {
    throw new Error("We couldn't reach SOL just now. Check your connection and try again: nothing was changed.");
  }
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string; outOfCredits?: boolean; availableCredits?: number }) | null;
  if (res.status === 402 || data?.outOfCredits) throw new StudioCreditsError({ requiredCredits: creditCost, availableCredits: typeof data?.availableCredits === "number" ? data.availableCredits : 0 });
  if (!res.ok || !data) throw new Error(data?.error || "SOL took too long to answer. Please try again: nothing was changed.");
  return data as T;
}

/**
 * SOL Studio for "Personalize with SOL": SOL reads the brand and the chosen design, asks what it
 * really needs to know, rewrites the words and puts the owner's logo/colours in, as live steps.
 * When it finishes, `onApplied` hands back the new design for the preview.
 */
export function PersonalizeStudio({ profile, design, creditCost, onApplied, onClose }: { profile: { goal: string; brand: Record<string, unknown> & { name: string } }; design: PersonalizeDesign; creditCost: number; onApplied: (result: PersonalizeResult) => void; onClose: () => void }) {
  // Kept across "Try again" so a failed last step never makes SOL redo (or charge for) what already worked.
  const kept = useRef<{ plan?: Plan; replacements?: Record<string, string> }>({});
  const base = { profile, place: browserPlace(), templateHtml: design.html, templateName: design.name, templateDescription: design.description };

  const script = async (api: StudioApi): Promise<PersonalizeResult> => {
    api.say(`I'll tailor **${design.name}** to **${profile.brand.name}**: your words, your name and your logo.`);
    const plan = (kept.current.plan ??= await api.step("studio_read_design", () => callStage<Plan>("plan", base, creditCost)));
    const answers = plan.questions.length ? await api.ask(plan.questions) : [];
    const replacements = (kept.current.replacements ??= await api.step("studio_write_words", async () => (await callStage<{ replacements: Record<string, string> }>("write", { ...base, answers }, creditCost)).replacements));
    const finished = await api.step("studio_apply_brand", () => callStage<PersonalizeResult>("finish", { ...base, replacements, domain: plan.domain }, creditCost));
    if (!finished.html) throw new Error("SOL couldn't put your design together this time. Please try again: nothing was changed.");
    api.say(finished.summary || `Your design is ready for ${profile.brand.name}.`);
    return finished;
  };

  const engine = useStudioScript(script, { onFinished: onApplied });
  return <SolStudio engine={engine} title="SOL is personalizing your design" onClose={onClose} closeLabel="Back to design" doneActions={<Button rightIcon={<ArrowRight size={18} aria-hidden />} onClick={onClose}>See my design</Button>} />;
}
