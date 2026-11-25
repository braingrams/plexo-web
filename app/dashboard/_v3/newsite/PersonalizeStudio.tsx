"use client";

import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { SolStudio } from "../sol/studio/SolStudio";
import { StudioCreditsError, type StudioApi } from "../sol/studio/types";
import { useStudioScript } from "../sol/studio/useStudioScript";
import { browserPlace } from "@/lib/onboarding/place";
import { extractTextNodes, MAX_NODES } from "@/lib/onboarding/htmlText";
import type { AskUserQuestionSpec } from "../../sol/_components/types";

/** `v2`: a new-editor design, personalized on its own data by the server (it needs no page HTML from here). */
export type PersonalizeDesign = { id: string; name: string; description?: string; html: string; v2?: boolean };
/** SOL's part of a personalized new-editor design: the small recipe the new website is made from (the design itself is rebuilt on the server). */
export type SolEdits = { copy?: Record<string, string>; remove?: string[]; domain?: string; contact?: boolean; slotsKey?: string };
export type PersonalizeResult = { html: string; summary: string; creditsRemaining?: number; edits?: SolEdits; designToken?: string; warnings?: string[] };

type Plan = { domain: string; summary: string; questions: AskUserQuestionSpec[]; slotCount?: number; slotsKey?: string; remove?: string[] };

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

const BATCH = 25;

/** A failure worth trying again: the gateway timed out, SOL was briefly busy, or the network blipped. Not credits, not a bad request. */
const retryable = (err: unknown) => !(err instanceof StudioCreditsError);

/** SOL writes the design's words in small, separate requests (so none runs long enough to time out), a few at a time, each tried up to three times. */
async function writeWords(base: Record<string, unknown>, html: string, answers: unknown, creditCost: number, slotCount?: number): Promise<Record<string, string>> {
  // A new-editor design is numbered by the server (it tells us how many words there are); a page-text design is numbered here from its HTML.
  const ids = slotCount !== undefined ? Array.from({ length: slotCount }, (_, i) => i) : extractTextNodes(html).slice(0, MAX_NODES).map((n) => n.id);
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  const out: Record<string, string> = {};
  let lastError: unknown = null;
  const one = async (batch: number[]) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        Object.assign(out, (await callStage<{ replacements: Record<string, string> }>("write", { ...base, answers, ids: batch }, creditCost)).replacements);
        return;
      } catch (err) {
        if (!retryable(err)) throw err;
        lastError = err;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  };
  for (let i = 0; i < batches.length; i += 4) await Promise.all(batches.slice(i, i + 4).map(one));
  // A few pieces that never came back are fine (they keep the design's words); nothing at all is a real failure.
  if (Object.keys(out).length === 0) throw lastError instanceof Error ? lastError : new Error("SOL couldn't finish the words this time. Please try again: you haven't lost anything.");
  return out;
}

/**
 * SOL Studio for "Personalize with SOL": SOL reads the brand and the chosen design, asks what it
 * really needs to know, rewrites the words and puts the owner's logo/colours in, as live steps.
 * When it finishes, `onApplied` hands back the new design for the preview.
 */
export function PersonalizeStudio({ profile, design, creditCost, onApplied, onClose }: { profile: { goal: string; brand: Record<string, unknown> & { name: string } }; design: PersonalizeDesign; creditCost: number; onApplied: (result: PersonalizeResult) => void; onClose: () => void }) {
  // Kept across "Try again" so a failed last step never makes SOL redo (or charge for) what already worked.
  const kept = useRef<{ plan?: Plan; replacements?: Record<string, string> }>({});
  const base = design.v2
    ? { profile, place: browserPlace(), designId: design.id }
    : { profile, place: browserPlace(), templateHtml: design.html, templateName: design.name, templateDescription: design.description };

  const script = async (api: StudioApi): Promise<PersonalizeResult> => {
    api.say(`I'll tailor **${design.name}** to **${profile.brand.name}**: your words, your name and your logo.`);
    const plan = (kept.current.plan ??= await api.step("studio_read_design", () => callStage<Plan>("plan", base, creditCost)));
    const answers = plan.questions.length ? await api.ask(plan.questions) : [];
    const replacements = (kept.current.replacements ??= await api.step("studio_write_words", () => writeWords(base, design.html, answers, creditCost, design.v2 ? plan.slotCount ?? 0 : undefined)));
    const finished = await api.step("studio_apply_brand", () => callStage<PersonalizeResult>("finish", { ...base, replacements, domain: plan.domain, answers, ...(design.v2 ? { remove: plan.remove, slotsKey: plan.slotsKey } : {}) }, creditCost));
    if (!finished.html) throw new Error("SOL couldn't put your design together this time. Please try again: nothing was changed.");
    api.say(finished.summary || `Your design is ready for ${profile.brand.name}.`);
    return finished;
  };

  const engine = useStudioScript(script, { onFinished: onApplied });
  return <SolStudio engine={engine} title="SOL is personalizing your design" onClose={onClose} closeLabel="Back to design" doneActions={<Button rightIcon={<ArrowRight size={18} aria-hidden />} onClick={onClose}>See my design</Button>} />;
}
