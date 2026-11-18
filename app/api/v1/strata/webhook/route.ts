import { after, NextRequest, NextResponse } from "next/server";
import { StrataProjectWebhook } from "@/lib/db/coreEntities";
import { decryptStrataToken } from "@/lib/crypto";
import { verifyStrataSignature } from "@/lib/brand/webhookSignature";
import { applyPublishedEvent } from "@/lib/brand/siteBrand";

/**
 * POST /api/v1/strata/webhook — Strata tells Plexo a design system was PUBLISHED.
 *
 * Signed by Strata with the subscription's secret (lib/brand/webhookSignature.ts); anything unsigned, stale or mis-signed is
 * refused. Only `design-system.published` does anything — Strata also has `design-system.updated` for autosaves, which must
 * never reach a live site. The answer comes back straight away (Strata waits only a few seconds); every site linked to the
 * project is then updated in the background (lib/brand/siteBrand.ts applyPublishedEvent). A delivery Strata retries is applied
 * once: the sync stops on a revision it has already applied, and a repeated delivery id is acknowledged without work.
 */
const MAX_BODY = 64 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });
  let payload: { id?: unknown; type?: unknown; projectId?: unknown; data?: { revision?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }
  const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "No project." }, { status: 400 });

  const { data: hook } = await StrataProjectWebhook.get({ strataProjectId: projectId }).go();
  // Nobody here listens to this project any more: a 404 lets Strata count the failure and eventually switch the subscription off.
  if (!hook) return NextResponse.json({ error: "Unknown subscription." }, { status: 404 });
  let secret: string;
  try {
    secret = decryptStrataToken(hook.secretCiphertext);
  } catch {
    console.error(`[strata-webhook] ${projectId}: the stored secret can't be read`);
    return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  }
  const check = verifyStrataSignature({ secret, timestamp: request.headers.get("x-strata-timestamp"), signature: request.headers.get("x-strata-signature"), rawBody });
  if (!check.ok) return NextResponse.json({ error: "Bad signature." }, { status: 401 });

  const type = request.headers.get("x-strata-event") ?? (typeof payload.type === "string" ? payload.type : "");
  if (type !== "design-system.published") return NextResponse.json({ ok: true, ignored: type || "unknown" }, { status: 202 });

  const deliveryId = request.headers.get("x-strata-delivery") ?? (typeof payload.id === "string" ? payload.id : "");
  if (deliveryId && deliveryId === hook.lastDeliveryId) return NextResponse.json({ ok: true, duplicate: true });
  await StrataProjectWebhook.patch({ strataProjectId: projectId }).set({ lastDeliveryId: deliveryId || undefined, lastDeliveryAt: new Date().toISOString() }).go().catch(() => undefined);

  const revision = typeof payload.data?.revision === "string" ? payload.data.revision : undefined;
  after(async () => {
    try {
      const counts = await applyPublishedEvent(projectId, revision);
      console.log(`[strata-webhook] ${projectId} ${revision ?? ""}`, counts);
    } catch (err) {
      console.error(`[strata-webhook] ${projectId}: update failed (the scheduled check will retry)`, err);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
