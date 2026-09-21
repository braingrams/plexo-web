import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolPreferences } from "@/lib/db/solEntities";

const TONE_PRESETS = new Set(["PROFESSIONAL", "FRIENDLY", "CONCISE", "DETAILED"]);
const MODEL_TIERS = new Set(["BASIC", "MEDIUM", "HIGH"]);
const RESPONSE_LENGTHS = new Set(["CONCISE", "BALANCED", "THOROUGH"]);

function serialize(prefs: {
  tonePreset?: string;
  customInstructions?: string;
  defaultModelTier?: string;
  memoryEnabled?: boolean;
  responseLength?: string;
  createdAt?: string;
  updatedAt?: string;
} | null) {
  return {
    tonePreset: prefs?.tonePreset ?? null,
    customInstructions: prefs?.customInstructions ?? "",
    defaultModelTier: prefs?.defaultModelTier ?? "BASIC",
    memoryEnabled: prefs?.memoryEnabled ?? true,
    responseLength: prefs?.responseLength ?? "BALANCED",
    createdAt: prefs?.createdAt ?? null,
    updatedAt: prefs?.updatedAt ?? null,
  };
}

/**
 * GET /api/v1/sol/preferences
 *
 * One row per user (SolPreferences' primary key has a fixed literal sort key — see
 * solEntities.ts). Returns the entity's own defaults for a user who's never saved
 * preferences yet, rather than 404ing — there's nothing "missing" about that state from
 * the client's point of view, it's just every default.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: prefs } = await SolPreferences.get({ userId: resolved.userId }).go();
  return NextResponse.json({ preferences: serialize(prefs) });
}

/**
 * PATCH /api/v1/sol/preferences
 *
 * Upserts the caller's SOL preferences — `.patch()` on a row that doesn't exist yet would
 * fail (nothing to update), so this creates it on first write via the same
 * try-patch-else-create shape other single-row-per-user settings in this codebase use.
 * No composite-key attributes here (the sort key is a fixed literal, not derived from any
 * of these fields — see solEntities.ts), so a plain `.patch()` is always safe once the row
 * exists.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    tonePreset?: string | null;
    customInstructions?: string;
    defaultModelTier?: string;
    memoryEnabled?: boolean;
    responseLength?: string;
  };

  if (body.tonePreset !== undefined && body.tonePreset !== null && !TONE_PRESETS.has(body.tonePreset)) {
    return NextResponse.json({ error: "Invalid tonePreset." }, { status: 400 });
  }
  if (body.defaultModelTier !== undefined && !MODEL_TIERS.has(body.defaultModelTier)) {
    return NextResponse.json({ error: "Invalid defaultModelTier." }, { status: 400 });
  }
  if (body.responseLength !== undefined && !RESPONSE_LENGTHS.has(body.responseLength)) {
    return NextResponse.json({ error: "Invalid responseLength." }, { status: 400 });
  }
  if (body.customInstructions !== undefined && body.customInstructions.length > 2000) {
    return NextResponse.json({ error: "customInstructions must be 2000 characters or fewer." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.tonePreset !== undefined) updates.tonePreset = body.tonePreset ?? undefined;
  if (body.customInstructions !== undefined) updates.customInstructions = body.customInstructions;
  if (body.defaultModelTier !== undefined) updates.defaultModelTier = body.defaultModelTier;
  if (body.memoryEnabled !== undefined) updates.memoryEnabled = body.memoryEnabled;
  if (body.responseLength !== undefined) updates.responseLength = body.responseLength;

  const { data: existing } = await SolPreferences.get({ userId: resolved.userId }).go();
  if (existing) {
    if (Object.keys(updates).length > 0) {
      await SolPreferences.patch({ userId: resolved.userId }).set(updates).go();
    }
  } else {
    await SolPreferences.create({ userId: resolved.userId, ...updates }).go();
  }

  const { data: updated } = await SolPreferences.get({ userId: resolved.userId }).go();
  return NextResponse.json({ preferences: serialize(updated) });
}
