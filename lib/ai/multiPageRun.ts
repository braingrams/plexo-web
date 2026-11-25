/**
 * The loop behind "ask SOL about several pages": one page at a time, each one asked, applied and reported, with live progress.
 * Pure (everything it needs is passed in) so the behaviour — order, stopping when credits run out, skipping what SOL can't
 * change, being cancelled — is tested in tests/multiPageRun.test.ts.
 */

export const MAX_PAGES_PER_RUN = 25;

export type PageRunStatus = "waiting" | "working" | "done" | "nothing" | "skipped" | "failed" | "no-credits" | "cancelled";
export type PageRunState = { pageId: string; name: string; status: PageRunStatus; note: string; said?: string; before?: unknown };

export type PageContext = { pageId: string; name: string; design?: unknown; catalog?: unknown; skipped?: string };
export type ParsedReply = { text: string; commands: unknown[] | null; error?: string };

export type RunDeps = {
  loadPage: (pageId: string) => Promise<PageContext>;
  /** Asks SOL (the editor's own streaming call). Returns SOL's whole reply as text. */
  ask: (input: { question: string; page: PageContext; signal?: AbortSignal }) => Promise<string>;
  parse: (reply: string) => ParsedReply;
  apply: (pageId: string, commands: unknown[]) => Promise<{ saved: boolean; message: string; before: unknown }>;
  isOutOfCredits: (reply: string) => boolean;
};

export function initialStates(pages: { pageId: string; name: string }[]): PageRunState[] {
  return pages.map((p) => ({ pageId: p.pageId, name: p.name, status: "waiting" as const, note: "Waiting" }));
}

export async function runOnPages(opts: {
  pages: { pageId: string; name: string }[];
  question: string;
  deps: RunDeps;
  onProgress: (states: PageRunState[]) => void;
  signal?: AbortSignal;
}): Promise<PageRunState[]> {
  const states = initialStates(opts.pages);
  const set = (i: number, patch: Partial<PageRunState>) => {
    states[i] = { ...states[i], ...patch };
    opts.onProgress(states.map((s) => ({ ...s })));
  };
  const stopFrom = (from: number, status: PageRunStatus, note: string) => {
    for (let j = from; j < states.length; j++) if (states[j].status === "waiting") states[j] = { ...states[j], status, note };
    opts.onProgress(states.map((s) => ({ ...s })));
  };

  for (let i = 0; i < states.length; i++) {
    if (opts.signal?.aborted) return (stopFrom(i, "cancelled", "Stopped"), states);
    set(i, { status: "working", note: "SOL is working on this page…" });
    try {
      const page = await opts.deps.loadPage(states[i].pageId);
      if (page.skipped) {
        set(i, { status: "skipped", note: page.skipped });
        continue;
      }
      const reply = await opts.deps.ask({ question: opts.question, page, signal: opts.signal });
      if (opts.deps.isOutOfCredits(reply)) {
        set(i, { status: "no-credits", note: "SOL ran out of credits before it could start this page." });
        stopFrom(i + 1, "no-credits", "Not started: out of credits");
        return states;
      }
      const parsed = opts.deps.parse(reply);
      if (!parsed.commands?.length) {
        set(i, { status: "nothing", note: parsed.error ?? "SOL didn't change anything on this page.", said: parsed.text });
        continue;
      }
      const applied = await opts.deps.apply(states[i].pageId, parsed.commands);
      set(i, applied.saved ? { status: "done", note: parsed.error ? `Changed. ${parsed.error}` : "Changed", said: parsed.text, before: applied.before } : { status: "nothing", note: applied.message, said: parsed.text });
    } catch (err) {
      if (opts.signal?.aborted) return (stopFrom(i, "cancelled", "Stopped"), states);
      set(i, { status: "failed", note: err instanceof Error && err.message ? err.message : "SOL couldn't finish this page. Try it again on its own." });
    }
  }
  return states;
}

/** "3 pages changed, 1 skipped" — the line above the results. */
export function summarizeRun(states: PageRunState[]): string {
  const count = (s: PageRunStatus) => states.filter((x) => x.status === s).length;
  const done = count("done");
  const parts: string[] = [];
  parts.push(done === 0 ? "No pages were changed" : `${done} ${done === 1 ? "page" : "pages"} changed`);
  const unchanged = count("nothing");
  if (unchanged) parts.push(`${unchanged} left as they were`);
  const skipped = count("skipped");
  if (skipped) parts.push(`${skipped} skipped`);
  const failed = count("failed");
  if (failed) parts.push(`${failed} didn't work`);
  const noCredits = count("no-credits");
  if (noCredits) parts.push(`${noCredits} not started (out of credits)`);
  return parts.join(", ");
}

export function undoableStates(states: PageRunState[]): PageRunState[] {
  return states.filter((s) => s.status === "done");
}

/** Worst-case credits for the pages SOL will actually work on, in plain words. */
export function creditNote(est: { paidBy: string; total: number; balance: number | null; perPage: number[] } | null): string {
  if (!est) return "";
  if (est.paidBy !== "plexo") return "Uses your own AI key, so no credits are used.";
  const up = Math.max(1, Math.ceil(est.total));
  const bal = est.balance === null ? "" : ` You have ${Math.floor(est.balance).toLocaleString()}.`;
  return `Uses up to about ${up.toLocaleString()} credits (usually less).${bal}`;
}
