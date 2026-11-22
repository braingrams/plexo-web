import { NextRequest, NextResponse } from "next/server";

import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { analyzeCustomCode } from "@/lib/customCode/sanitize";

/**
 * POST { head?, footer? } — checks pasted code WITHOUT saving it and says, snippet by snippet, what it is
 * and what (if anything) is wrong, so the owner finds out while typing rather than after pressing Save.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  const body = (await request.json().catch(() => ({}))) as { head?: unknown; footer?: unknown };
  const one = (v: unknown) => {
    const a = analyzeCustomCode(v);
    return { ok: a.ok, error: a.ok ? null : a.error, snippets: a.snippets };
  };
  return NextResponse.json({ head: one(body.head), footer: one(body.footer) });
}
