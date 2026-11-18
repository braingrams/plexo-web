import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { Promo } from "@/lib/db/coreEntities";

/** Counts a click on the promo button (a plain number; no one is tracked). */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: true });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.id)) return NextResponse.json({ ok: true });
  try {
    // Only counts promos that exist: a made-up id never creates a row.
    await Promo.patch({ id: body.id }).add({ clicks: 1 }).where(({ id }, { exists }) => exists(id)).go();
  } catch {
    // best effort
  }
  return NextResponse.json({ ok: true });
}
