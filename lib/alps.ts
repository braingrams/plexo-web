import { PLAN } from "@/lib/plan/plans";
// One-way sync of Plexo accounts into Alps (Charisol's CRM) so every signup and plan change
// shows up there without anyone exporting a CSV. https://help.tryalps.com/contacts/syncing-contacts-into-alps-automatically
//
// Design rules:
//  - Never blocks or breaks the user-facing flow: a missing key is a silent no-op, and any
//    failure is logged and swallowed (a CRM outage must not stop someone signing up).
//  - Idempotent: Alps upserts on externalId (our user id), and each real-world event carries
//    its own Idempotency-Key, so retries and re-runs never create duplicates.
//  - Omitted fields keep their Alps value, so routine syncs never send lifecycleStage unless
//    the event is genuinely a stage change.
//
// Env (all optional — with no ALPS_API_KEY the whole integration is off):
//   ALPS_API_KEY           Alps → Settings → Apps → API Keys. Server-side only.
//   ALPS_API_URL           Override for testing; defaults to https://api.tryalps.com/api/v1
//   ALPS_LEAD_STAGE        Lifecycle stage ID (not label) for new signups, e.g. "lead".
//   ALPS_CUSTOMER_STAGE    Lifecycle stage ID for people who start paying, e.g. "customer".
// Stage IDs are only sent when set: Alps rejects an unknown ID with a 400, and has no API to
// list them, so guessing would fail every sync.

import { after } from "next/server";

const DEFAULT_API_URL = "https://api.tryalps.com/api/v1";
const MAX_ATTEMPTS = 3;

export type AlpsContact = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  /** International form, e.g. +2348012345678. */
  phone?: string | null;
};

type SyncOptions = {
  /** One key per real-world event (e.g. `signup-<userId>`), reused across retries. */
  idempotencyKey: string;
  lifecycleStage?: string;
  customProperties?: Record<string, string | number | boolean | null>;
};

export function isAlpsEnabled(): boolean {
  return Boolean(process.env.ALPS_API_KEY);
}

function splitName(name: string | null | undefined): { firstName?: string; lastName?: string } {
  const trimmed = name?.trim();
  if (!trimmed) return {};
  const [first, ...rest] = trimmed.split(/\s+/);
  return rest.length ? { firstName: first, lastName: rest.join(" ") } : { firstName: first };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Upserts one contact. Throws on a non-retryable rejection; callers use the `*InBackground` helpers. */
export async function syncContactToAlps(contact: AlpsContact, options: SyncOptions): Promise<void> {
  const apiKey = process.env.ALPS_API_KEY;
  if (!apiKey) return;
  const base = process.env.ALPS_API_URL || DEFAULT_API_URL;

  const body = {
    idProperty: "externalId",
    externalId: contact.id,
    email: contact.email,
    ...splitName(contact.name),
    ...(contact.image ? { avatarUrl: contact.image } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(options.lifecycleStage ? { lifecycleStage: options.lifecycleStage } : {}),
    customProperties: { source: "Plexo", ...options.customProperties },
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${base}/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": options.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => "");
      // Only 5xx / 429 / 409 (same key still processing) are worth retrying; other 4xx mean
      // the request itself is wrong and retrying unchanged would just repeat the failure.
      if (res.status < 500 && res.status !== 429 && res.status !== 409) {
        throw new Error(`Alps rejected the contact (${res.status}): ${text.slice(0, 300)}`);
      }
      lastError = new Error(`Alps ${res.status}: ${text.slice(0, 300)}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Alps rejected")) throw err;
      lastError = err; // network error or timeout
    }
    if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 400 + Math.random() * 300);
  }
  throw lastError instanceof Error ? lastError : new Error("Alps sync failed.");
}

function runInBackground(task: () => Promise<void>): void {
  const safe = () => task().catch((err) => console.error("Alps sync failed:", err instanceof Error ? err.message : err));
  try {
    // Keeps the work alive after the response is sent without making the visitor wait on it.
    after(safe);
  } catch {
    // Not inside a request scope (scripts, tests) — just fire it.
    void safe();
  }
}

/** A new Plexo account (email signup or Charisol sign-in). */
export function syncSignupToAlps(contact: AlpsContact, via: "email" | "charisol"): void {
  if (!isAlpsEnabled()) return;
  runInBackground(() =>
    syncContactToAlps(contact, {
      idempotencyKey: `signup-${contact.id}`,
      lifecycleStage: process.env.ALPS_LEAD_STAGE || undefined,
      customProperties: { plexoPlan: PLAN.FREE, signupMethod: via },
    }),
  );
}

/** Someone started paying (or changed plan). */
export function syncPlanChangeToAlps(contact: AlpsContact, plan: string, eventId: string): void {
  if (!isAlpsEnabled()) return;
  runInBackground(() =>
    syncContactToAlps(contact, {
      idempotencyKey: `plan-${contact.id}-${plan}-${eventId}`,
      lifecycleStage: plan !== PLAN.FREE ? process.env.ALPS_CUSTOMER_STAGE || undefined : undefined,
      customProperties: { plexoPlan: plan },
    }),
  );
}

/** Their phone number was saved (they connected WhatsApp to SOL): keep the contact in Alps up to date. */
export function syncPhoneToAlps(contact: AlpsContact, phone: string): void {
  if (!isAlpsEnabled()) return;
  runInBackground(() =>
    syncContactToAlps(
      { ...contact, phone },
      // One key per number, so connecting the same number again never repeats the sync.
      { idempotencyKey: `phone-${contact.id}-${phone}` },
    ),
  );
}
