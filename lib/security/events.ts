/**
 * The security event trail: a short, structured record of things that look like an attack or abuse (a flood of sign-up or reset
 * attempts, a request blocked from reaching an internal address, a form bot caught). It exists so someone can answer "is something
 * happening?" without trawling raw logs.
 *
 * Rules this file keeps:
 *  - It NEVER throws and never slows the request it is describing (callers do not await it).
 *  - It stores no secrets, no message content and no full email addresses; IPs are shortened (last part hidden).
 *  - It cannot grow without bound or cost real money: rows expire after 90 days, details are capped, and repeated events of the
 *    same kind from the same source collapse into one row per 10 minutes.
 */
import { createHash, randomUUID } from "node:crypto";

export type SecurityEventType = "rate_limited" | "ssrf_blocked" | "form_bot_blocked";

const DEDUPE_WINDOW_MS = 10 * 60_000;
const MAX_DETAIL = 300;

/** 203.0.113.42 -> 203.0.113.x, and an IPv6 address is cut after its first four groups. Anything else becomes "unknown". */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.x`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::x`;
  return "unknown";
}

/** ama@example.com -> a**@example.com (enough for a person to recognise their own address, not enough to harvest it). */
export function maskEmail(email: string | null | undefined): string {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec((email ?? "").trim());
  if (!m) return "unknown";
  return `${m[1][0]}**@${m[2]}`;
}

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL);

export type SecurityEventInput = {
  type: SecurityEventType;
  /** What happened, in plain words, with no secrets (a host name, a route name, a form id). */
  detail: string;
  /** Raw IP; it is shortened before it is stored. */
  ip?: string | null;
  /** Who did it, when known (a user id, never an email). */
  actorId?: string | null;
  /** Events with the same key inside 10 minutes become one row, so a flood cannot flood the table too. */
  dedupeKey?: string;
};

/**
 * The row's identity. Events with a dedupe key get the same id AND the same timestamp (the start of their 10 minute window), so a
 * repeat produces the same row key and the database refuses the second write. Others get a fresh id and the real time.
 */
export function securityEventKey(input: Pick<SecurityEventInput, "type" | "dedupeKey">, now: number): { id: string; createdAt: string } {
  if (!input.dedupeKey) return { id: randomUUID(), createdAt: new Date(now).toISOString() };
  const bucket = Math.floor(now / DEDUPE_WINDOW_MS);
  return { id: createHash("sha256").update(`${input.type}|${input.dedupeKey}|${bucket}`).digest("hex").slice(0, 32), createdAt: new Date(bucket * DEDUPE_WINDOW_MS).toISOString() };
}

/** Fire and forget: `void recordSecurityEvent(...)`. Always resolves. */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const now = Date.now();
    const event = { type: input.type, detail: clean(input.detail), ip: maskIp(input.ip), actorId: input.actorId ? clean(input.actorId).slice(0, 64) : undefined };
    // One structured line for the logs as well, so the event is searchable there too.
    console.warn("[security]", JSON.stringify(event));
    // Loaded here, not at the top, so importing this file (from code that runs in tests and scripts) never needs the database.
    const { SecurityEvent } = await import("@/lib/db/opsEntities");
    try {
      const key = securityEventKey(input, now);
      await SecurityEvent.create({ ...key, day: key.createdAt.slice(0, 10), ...event }).go();
    } catch (err) {
      const e = err as { name?: string; cause?: { name?: string } };
      // A repeat inside the 10 minute window: the row is already there, which is the point.
      if (e?.name !== "ConditionalCheckFailedException" && e?.cause?.name !== "ConditionalCheckFailedException") throw err;
    }
  } catch (err) {
    console.error("[security] could not record event:", err instanceof Error ? err.message : "unknown error");
  }
}

/** Recent events, newest first, for staff. `days` is capped at 7. */
export async function listRecentSecurityEvents(days = 1, limit = 200): Promise<Array<{ id: string; type: string; detail: string; ip: string; actorId?: string; createdAt: string }>> {
  const { SecurityEvent } = await import("@/lib/db/opsEntities");
  const out: Array<{ id: string; type: string; detail: string; ip: string; actorId?: string; createdAt: string }> = [];
  const span = Math.min(Math.max(Math.floor(days), 1), 7);
  for (let i = 0; i < span && out.length < limit; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const { data } = await SecurityEvent.query.primary({ day }).go({ order: "desc", limit: limit - out.length });
    out.push(...data.map((d) => ({ id: d.id, type: d.type, detail: d.detail, ip: d.ip, actorId: d.actorId, createdAt: d.createdAt })));
  }
  return out;
}
