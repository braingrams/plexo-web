/**
 * SOL discovery eval. Offline by default: runs every prompt in tests/fixtures/solEvalPrompts.json through the brief
 * intake and question planner and prints what was extracted, what would be asked and the creative direction, so the
 * team can diff before/after a change:
 *
 *   npx tsx scripts/sol-eval.ts > eval-after.json
 *
 * Add --live to also send each prompt to the model with SOL's real system prompt and record its first reply
 * (the questions it actually asks). That path needs ANTHROPIC_API_KEY and spends credits, so it is never run in CI:
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sol-eval.ts --live > eval-live.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { briefFromConversation, creativeDirection, directionSummary, discoveryPrompt } from "../lib/ai/solDiscovery";

type Case = { id: string; industry: string; text: string; alreadyBuilt?: boolean };
const cases: Case[] = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/solEvalPrompts.json"), "utf8"));
const live = process.argv.includes("--live");

const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

async function liveReply(system: string, text: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("--live needs ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.SOL_EVAL_MODEL ?? "claude-sonnet-4-5",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: text }],
      tools: [{ name: ASK_USER_QUESTION_TOOL_NAME, description: "Ask the owner questions.", input_schema: { type: "object", properties: { questions: { type: "array" } }, required: ["questions"] } }],
    }),
  });
  const json: any = await res.json();
  const blocks: any[] = json.content ?? [];
  return { text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""), asked: blocks.filter((b) => b.type === "tool_use" && b.name === ASK_USER_QUESTION_TOOL_NAME).flatMap((b) => (b.input?.questions ?? []).map((q: any) => q.question)) };
}

async function main() {
  const out = [];
  for (const c of cases) {
    const history = [{ role: "user" as const, content: [{ type: "text", text: c.text }] }, ...(c.alreadyBuilt ? [{ role: "assistant" as const, content: [{ type: "tool_use", id: "x", name: "site_create", input: {} }] }] : [])];
    const { brief, plan } = briefFromConversation(history);
    const row: Record<string, unknown> = {
      id: c.id,
      words: brief.wordCount,
      richness: brief.richness,
      extracted: { name: brief.name, offer: brief.offer, audience: brief.audience, cta: brief.cta, tone: brief.tone, colors: brief.colors, logo: brief.logo, sections: brief.sections, language: brief.language, content: brief.content },
      mode: plan.mode,
      reason: plan.reason,
      questions: plan.questions.map((q) => q.question),
      understood: plan.understood,
      assumptions: plan.assumptions,
      direction: directionSummary(creativeDirection(brief)),
    };
    if (live) {
      const { buildSolSystemPrompt } = await import("../lib/ai/solAgent");
      row.live = await liveReply(buildSolSystemPrompt([], undefined, { discovery: discoveryPrompt(brief, plan) }), c.text);
    }
    out.push(row);
  }
  console.log(JSON.stringify(out, null, 2));
}
main();
