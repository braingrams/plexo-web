import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn(), PLEXO_MCP_TOOLS: [] }));
vi.mock("@/lib/ai/solAttachments", () => ({ createAttachmentResolver: () => async (h: unknown) => h, publishAttachedImage: vi.fn(), PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/" }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generateWithTools: vi.fn() }));

import { MAX_GATE_ROUNDS, applyQualityGate, newGateState, touchedPageIds, unfinishedNote, type PageLoader } from "@/lib/ai/solQualityRun";
import { buildSolSystemPrompt } from "@/lib/ai/solAgent";
import { QUALITY_BAR, briefFromConversation, discoveryPrompt } from "@/lib/ai/solDiscovery";
import { blandDocument, pristineDocument } from "./fixtures/solQualityFixtures";

const loaderFor = (html: () => string): PageLoader => async () => ({ name: "Home", html: html(), kind: "page" });

describe("the gate runs inside the tool-result path", () => {
  it("touches the pages a build or edit result names, home first, and skips failed saves", () => {
    expect(touchedPageIds({ success: true, siteId: "s1", pages: [{ templateId: "s1" }, { templateId: "p2" }] })).toEqual(["s1", "p2"]);
    expect(touchedPageIds({ ok: true, saved: true, templateId: "p9" })).toEqual(["p9"]);
    expect(touchedPageIds({ ok: false, saved: false, templateId: "p9" })).toEqual([]);
  });
  it("a bland build comes back with the failures and a 'not done' instruction", async () => {
    const state = newGateState();
    const out = (await applyQualityGate("site_create", { success: true, siteId: "s1" }, undefined, state, loaderFor(blandDocument))) as Record<string, unknown>;
    expect(out.success).toBe(true);
    expect(out.qualityPassed).toBe(false);
    expect(String(out.qualityCheck)).toMatch(/NOT DONE YET/);
    expect(String(out.qualityCheck)).toMatch(/MUST FIX/);
    expect(state.open.size).toBe(1);
    expect(state.rounds).toBe(1);
  });
  it("a pristine edit passes, clears the open item and asks for a plain summary plus next steps", async () => {
    const state = newGateState();
    await applyQualityGate("page_edit", { ok: true, saved: true, templateId: "s1" }, undefined, state, loaderFor(blandDocument));
    const out = (await applyQualityGate("page_edit", { ok: true, saved: true, templateId: "s1" }, undefined, state, loaderFor(() => pristineDocument()))) as Record<string, unknown>;
    expect(out.qualityPassed).toBe(true);
    expect(state.open.size).toBe(0);
    expect(String(out.qualityCheck)).toMatch(/2 or 3 meaningful next improvements/);
    expect(unfinishedNote(state)).toBeNull();
  });
  it("SOL can't finish while a must item is open, but only for a bounded number of rounds", async () => {
    const state = newGateState();
    await applyQualityGate("page_edit", { ok: true, saved: true, templateId: "s1" }, undefined, state, loaderFor(blandDocument));
    expect(unfinishedNote(state)).toMatch(/Don't tell the owner it's done/);
    state.rounds = MAX_GATE_ROUNDS;
    expect(unfinishedNote(state)).toBeNull();
    const last = (await applyQualityGate("page_edit", { ok: true, saved: true, templateId: "s1" }, undefined, { ...state, rounds: MAX_GATE_ROUNDS - 1 }, loaderFor(blandDocument))) as Record<string, unknown>;
    expect(String(last.qualityCheck)).toMatch(/last automatic check/);
  });
  it("other tools and a failing loader never break the tool call", async () => {
    const state = newGateState();
    const same = { success: true };
    expect(await applyQualityGate("page_publish", same, undefined, state, loaderFor(blandDocument))).toBe(same);
    const boom: PageLoader = async () => { throw new Error("db down"); };
    expect(await applyQualityGate("page_edit", { ok: true, templateId: "x" }, undefined, state, boom)).toEqual({ ok: true, templateId: "x" });
  });
});

describe("prompt assembly carries the gate loop and the creative bar", () => {
  it("the system prompt tells SOL how the quality check works and what to say when it passes", () => {
    const { brief, plan, resolution } = briefFromConversation([{ role: "user", content: [{ type: "text", text: "build me a landing page" }] }]);
    const sys = buildSolSystemPrompt([], undefined, { discovery: discoveryPrompt(brief, plan, resolution) });
    expect(sys).toContain("The quality check (enforced, not optional)");
    expect(sys).toContain("up to 3 rounds");
    expect(sys).toContain("2 or 3 meaningful next improvements");
    expect(sys).toContain("follow it exactly");
    expect(sys).toContain("distinctive");
    expect(QUALITY_BAR.length).toBeLessThan(4200);
  });
});
