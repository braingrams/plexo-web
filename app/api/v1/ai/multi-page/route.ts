import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { MAX_PAGES_PER_RUN } from "@/lib/ai/multiPageRun";
import { applyToPage, estimateRun, pageForSol, PageToolError, undoPage } from "@/lib/ai/multiPage";

/**
 * SOL on several pages, one small step per call (the AI call itself is the editor's streaming assist route, which also
 * bills it): `page` reads one page for SOL, `apply` saves SOL's changes as the page's working copy, `undo` takes them
 * back, `estimate` says roughly what a run could cost. Nothing here ever publishes.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "You're signed out. Sign in again, then try once more." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; pageId?: string; pageIds?: string[]; commands?: unknown; before?: unknown };
  try {
    if (body.action === "estimate") {
      const ids = Array.isArray(body.pageIds) ? body.pageIds.filter((x): x is string => typeof x === "string").slice(0, MAX_PAGES_PER_RUN) : [];
      const out = await estimateRun(resolved, ids);
      return "error" in out ? NextResponse.json({ error: out.error }, { status: out.status }) : NextResponse.json(out);
    }
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    if (!pageId) return NextResponse.json({ error: "Pick a page first." }, { status: 400 });
    if (body.action === "page") return NextResponse.json(await pageForSol(resolved, pageId));
    if (body.action === "apply") {
      if (!Array.isArray(body.commands) || !body.commands.length) return NextResponse.json({ error: "There was nothing to change." }, { status: 400 });
      return NextResponse.json(await applyToPage(resolved, pageId, body.commands));
    }
    if (body.action === "undo") {
      await undoPage(resolved, pageId, body.before ?? null);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "That isn't something SOL can do here." }, { status: 400 });
  } catch (err) {
    if (err instanceof PageToolError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[multi-page-sol]", err);
    return NextResponse.json({ error: "Something went wrong on our side. Your pages are untouched. Try again in a moment." }, { status: 500 });
  }
}
