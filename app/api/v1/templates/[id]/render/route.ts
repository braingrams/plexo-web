import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { EMAIL_MERGE_TAGS, fillMergeTags, findMergeTags, missingMergeTags } from "@/lib/email/mergeTags";

/**
 * POST /api/v1/templates/:id/render   body: { "values": { "first_name": "Ada", "unsubscribe_url": "https://..." } }
 *
 * For a sending tool: returns the email's HTML with the merge tags filled in, plus `missing` (tags the email uses that
 * `values` didn't cover, left untouched in the HTML) and `mergeTags` (every tag the email uses, so a sender can look the
 * values up before it asks). Tags the sender doesn't fill are reported, never silently blanked.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No email found with id "${id}" for this account.` }, { status: 404 });
  }
  if (template.kind !== "EMAIL") return NextResponse.json({ error: "Only emails have merge tags to fill." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.values ?? {})) if (typeof v === "string") values[k] = v;

  const html = template.compiledHtml ?? "";
  return NextResponse.json({
    html: fillMergeTags(html, values),
    missing: missingMergeTags(html, values),
    mergeTags: findMergeTags(html),
    supportedTags: EMAIL_MERGE_TAGS.map((t) => ({ key: t.key, label: t.label, help: t.help })),
  });
}
