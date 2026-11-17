import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

type Step = { text?: string; tool?: string; stop?: string };
const world = vi.hoisted(() => ({ script: [] as any[], saved: [] as any[], histories: [] as any[], reports: [] as boolean[], dispatched: [] as string[] }));

vi.mock("@/lib/db/solEntities", () => ({
  SolMessage: {
    query: { primary: () => ({ go: async () => ({ data: [] }) }) },
    create: (row: any) => ({ go: async () => (world.saved.push(row), { data: { ...row, createdAt: new Date().toISOString() } }) }),
    patch: () => ({ set: () => ({ go: async () => ({}) }) }),
  },
}));
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({
  dispatchMcpTool: vi.fn(async (name: string) => (world.dispatched.push(name), { ok: true, saved: true, templateId: "p1" })),
  PLEXO_MCP_TOOLS: ["page_edit", "site_create", "get_user_profile"].map((name) => ({ name, description: "x", inputSchema: { type: "object", properties: {} } })),
}));
vi.mock("@/lib/ai/solAttachments", () => ({ createAttachmentResolver: () => async (h: unknown) => h, publishAttachedImage: vi.fn(), PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/" }));
vi.mock("@/lib/ai/solQuality", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/solQuality")>()),
  checkPage: () => {
    const passed = world.reports.length ? world.reports.shift()! : true;
    return { score: passed ? 95 : 40, passed, findings: passed ? [] : [{ id: "hero-cta", severity: "must", message: "The top of the page has no button.", fix: "Add one." }], stats: {} };
  },
}));
vi.mock("@/lib/ai/solQualityRun", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/solQualityRun")>()),
  pageLoaderFor: () => async () => ({ name: "Home", html: "<html></html>", kind: "page" }),
}));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({
  generateWithTools: vi.fn(async (p: any) => {
    world.histories.push(JSON.parse(JSON.stringify(p.conversationHistory)));
    const step = world.script.shift() as Step;
    if (!step) throw new Error("script exhausted");
    if (step.tool) p.onToolInputProgress?.({ id: "t", name: step.tool, characters: 5 });
    for (const word of (step.text ?? "").split(/(?<= )/)) p.onTextDelta(word);
    const content: any[] = [];
    if (step.text) content.push({ type: "text", text: step.text });
    if (step.tool) content.push({ type: "tool_use", id: `u${world.histories.length}`, name: step.tool, input: {} });
    return { content, stopReason: step.stop ?? (step.tool ? "tool_use" : "end_turn"), usage: { inputTokens: 1, outputTokens: 1 } };
  }),
}));

import { runAgentTurn } from "@/lib/ai/solAgent";

async function turn(extra: Record<string, unknown> = {}) {
  const log: string[] = [];
  const out = await runAgentTurn({
    conversationId: "c1",
    resolvedUser: { userId: "u1", organizationId: "o1" } as never,
    modelTier: "MEDIUM",
    provider: "bedrock_claude",
    userMessageContent: [{ type: "text", text: "Build me a page" }],
    memoryFacts: [],
    onTextDelta: (d: string) => log.push(`text:${d}`),
    onToolCallStart: (c: { name: string }) => log.push(`tool:${c.name}`),
    onStep: (s: { name: string; phase: string }) => log.push(`step:${s.phase}:${s.name}`),
    onToolCallAwaitingConfirmation: async () => {},
    onToolCallResult: () => {},
    budgetGuard: async () => true,
    visualReviewDeps: undefined,
    ...extra,
  } as never);
  const streamed = log.filter((l) => l.startsWith("text:")).map((l) => l.slice(5)).join("");
  const persistedText = world.saved.filter((r) => r.role === "assistant").map((r) => (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("")).filter(Boolean).join("|");
  return { out: out as { finalText: string }, log, streamed, persistedText };
}

beforeEach(() => {
  world.script = [];
  world.saved = [];
  world.histories = [];
  world.reports = [];
  world.dispatched = [];
  process.env.SOL_VISUAL_REVIEW = "off"; // gate behaviour first; the review has its own tests
});

describe("a final answer is held until the page check decides", () => {
  it("normal chat (no build or edit) streams immediately", async () => {
    world.script = [{ text: "Hello " }];
    const { log, streamed } = await turn();
    expect(streamed).toBe("Hello ");
    expect(log.filter((l) => l.startsWith("step:"))).toEqual([]);
  });

  it("build + passing check: the answer is released once, unchanged, and saved once", async () => {
    world.script = [{ text: "Building it now. ", tool: "site_create" }, { text: "All done! Your page is ready." }];
    const { streamed, persistedText, out, log } = await turn();
    expect(streamed).toBe("Building it now. All done! Your page is ready.");
    expect(out.finalText).toBe("All done! Your page is ready.");
    expect(persistedText).toBe("Building it now. |All done! Your page is ready.");
    expect(log).toContain("step:start:sol_check_page");
    // narration before the tool went out straight away, before the tool started
    expect(log.indexOf("text:Building ")).toBeLessThan(log.indexOf("tool:site_create"));
  });

  it("failing check, then a fix, then a pass: the superseded 'done' is never streamed or saved", async () => {
    world.reports = [false, true];
    world.script = [
      { tool: "site_create" },
      { text: "SUPERSEDED all done!" },
      { tool: "page_edit" },
      { text: "Now it is really finished." },
    ];
    const { streamed, persistedText, log } = await turn();
    expect(streamed).toBe("Now it is really finished.");
    expect(persistedText).not.toMatch(/SUPERSEDED/);
    expect(persistedText).toBe("Now it is really finished.");
    expect(log).toContain("step:start:sol_polish_page");
    expect(JSON.stringify(world.histories.at(-1))).not.toMatch(/SUPERSEDED/);
  });

  it("rounds exhausted: an honest message says what is left, and the cheerful draft is never shown", async () => {
    world.reports = [false, false, false, false, false];
    world.script = [{ tool: "site_create" }, { text: "Done, all perfect!" }, { tool: "page_edit" }, { text: "Done, all perfect!" }, { tool: "page_edit" }, { text: "Done, all perfect!" }, { tool: "page_edit" }, { text: "Done, all perfect!" }, { text: "Done, all perfect!" }];
    const { streamed, persistedText, out } = await turn();
    expect(streamed).not.toMatch(/all perfect/);
    expect(streamed).toMatch(/aren't right/);
    expect(streamed).toMatch(/no button/);
    expect(out.finalText).toBe(streamed);
    expect(persistedText).toBe(streamed);
    expect(persistedText).not.toMatch(/all perfect/);
  });
});

describe("the screenshot review after the check passes", () => {
  const shot = (kind: "top" | "full", device: "desktop" | "phone") => ({ kind, device, imageUrl: `https://b.s3.amazonaws.com/private/sol-attachments/u1/screenshots/${device}-${kind}.jpg` });
  const deps = (shoot: (...a: any[]) => Promise<any>, timeoutMs?: number) => ({ resolveTarget: async (id: string) => ({ templateId: id, pageId: null }), shoot, timeoutMs });
  beforeEach(() => {
    delete process.env.SOL_VISUAL_REVIEW;
  });

  it("looks fine: the answer given before the review is released once, and the marker never shows", async () => {
    const shoot = vi.fn(async () => [shot("top", "desktop"), shot("full", "desktop"), shot("top", "phone")]);
    world.script = [{ tool: "site_create" }, { text: "Your page is ready." }, { text: "LOOKS_GOOD" }];
    const { streamed, persistedText, log } = await turn({ visualReviewDeps: deps(shoot) });
    expect(shoot).toHaveBeenCalledTimes(1);
    expect(streamed).toBe("Your page is ready.");
    expect(persistedText).toBe("Your page is ready.");
    expect(log).toContain("step:start:sol_review_look");
    const review = JSON.stringify(world.histories.at(-1));
    expect(review).toMatch(/"type":"image"/);
    expect(review).toMatch(/Look at the desktop and phone screenshots/);
  });

  it("something is off: one fix round, the check runs again, and only the last answer is shown", async () => {
    const shoot = vi.fn(async () => [shot("top", "desktop")]);
    world.script = [{ tool: "site_create" }, { text: "FIRST ready." }, { tool: "page_edit" }, { text: "Polished and ready." }];
    const { streamed, persistedText } = await turn({ visualReviewDeps: deps(shoot) });
    expect(shoot).toHaveBeenCalledTimes(1); // at most one review per turn
    expect(streamed).toBe("Polished and ready.");
    expect(persistedText).toBe("Polished and ready.");
    expect(world.dispatched).toEqual(["site_create", "page_edit"]);
  });

  it("a fix that breaks the check goes through the check again before anything is shown", async () => {
    world.reports = [true, false, true];
    const shoot = vi.fn(async () => [shot("top", "desktop")]);
    world.script = [{ tool: "site_create" }, { text: "FIRST ready." }, { tool: "page_edit" }, { text: "SECOND." }, { tool: "page_edit" }, { text: "Final." }];
    const { streamed } = await turn({ visualReviewDeps: deps(shoot) });
    expect(streamed).toBe("Final.");
  });

  it("a screenshot error skips the step and the turn finishes normally", async () => {
    world.script = [{ tool: "site_create" }, { text: "Ready." }];
    const { streamed, persistedText } = await turn({ visualReviewDeps: deps(async () => { throw new Error("lambda down"); }) });
    expect(streamed).toBe("Ready.");
    expect(persistedText).toBe("Ready.");
  });

  it("a screenshot that never comes back is cut off by the timeout", async () => {
    world.script = [{ tool: "site_create" }, { text: "Ready." }];
    const { streamed } = await turn({ visualReviewDeps: deps(() => new Promise(() => {}), 20) });
    expect(streamed).toBe("Ready.");
  });

  it("does nothing in a turn that built nothing", async () => {
    const shoot = vi.fn(async () => [shot("top", "desktop")]);
    world.script = [{ tool: "get_user_profile" }, { text: "Hi." }];
    await turn({ visualReviewDeps: deps(shoot) });
    expect(shoot).not.toHaveBeenCalled();
  });
});
