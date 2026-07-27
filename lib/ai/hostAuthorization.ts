import { createHmac, randomUUID } from "node:crypto";

import type { AiActionMode, ConcreteTier, GenerateOutcome } from "@/lib/ai/types";

const AUTHORIZE_TIMEOUT_MS = 8_000;
const SETTLE_TIMEOUT_MS = 8_000;
const SETTLE_MAX_ATTEMPTS = 3;
const SETTLE_RETRY_DELAY_MS = 500;

export interface HostManagedConfig {
  hostAuthWebhookUrl: string;
  hostWebhookSecret: string;
}

export interface AuthorizeResult {
  allowed: boolean;
  reason?: string;
}

function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

async function postSigned(
  config: HostManagedConfig,
  path: "ai-authorize" | "ai-charge",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const timestamp = Date.now().toString();
  const rawBody = JSON.stringify(payload);
  const signature = sign(config.hostWebhookSecret, timestamp, rawBody);

  const url = `${config.hostAuthWebhookUrl.replace(/\/$/, "")}/${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-plexo-timestamp": timestamp,
        "x-plexo-signature": signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Pre-flight authorization for a Host-Managed AI action. The host owns the
 * credit denomination entirely — Plexo only ever describes the action being
 * requested (mode + tier), never a cost. Fails closed: any network error,
 * timeout, or non-2xx response is treated as "not allowed" so a host outage
 * can never turn into unmetered AI usage.
 */
export async function authorizeHostManagedAction(
  config: HostManagedConfig,
  params: { externalUserId: string; actionMode: AiActionMode; tier: ConcreteTier; requestId: string },
): Promise<AuthorizeResult> {
  try {
    const { ok, body } = await postSigned(
      config,
      "ai-authorize",
      {
        externalUserId: params.externalUserId,
        actionMode: params.actionMode,
        tier: params.tier,
        requestId: params.requestId,
      },
      AUTHORIZE_TIMEOUT_MS,
    );

    const parsed = body as { allowed?: boolean; reason?: string } | null;
    if (!ok || !parsed || typeof parsed.allowed !== "boolean") {
      return { allowed: false, reason: parsed?.reason ?? "The host's authorization service returned an unexpected response." };
    }
    return { allowed: parsed.allowed, reason: parsed.reason };
  } catch (err) {
    return {
      allowed: false,
      reason: `Could not reach the host's authorization service: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }
}

/**
 * Post-flight settlement: tells the host to actually charge for a completed
 * generation. Best-effort with a few retries — the AI action already
 * happened, so a settlement hiccup shouldn't be surfaced to the browser, but
 * it must not fail silently either: a terminal failure is logged for
 * reconciliation rather than thrown.
 */
export async function settleHostManagedAction(
  config: HostManagedConfig,
  params: {
    externalUserId: string;
    actionMode: AiActionMode;
    tier: ConcreteTier;
    usage: GenerateOutcome["usage"];
    requestId: string;
  },
): Promise<void> {
  for (let attempt = 1; attempt <= SETTLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { ok, status, body } = await postSigned(
        config,
        "ai-charge",
        {
          externalUserId: params.externalUserId,
          actionMode: params.actionMode,
          tier: params.tier,
          usage: params.usage ?? null,
          requestId: params.requestId,
        },
        SETTLE_TIMEOUT_MS,
      );
      if (ok) return;
      console.error(
        `[hostAuthorization] settle attempt ${attempt}/${SETTLE_MAX_ATTEMPTS} rejected (status ${status}):`,
        body,
      );
    } catch (err) {
      console.error(`[hostAuthorization] settle attempt ${attempt}/${SETTLE_MAX_ATTEMPTS} failed:`, err);
    }
    if (attempt < SETTLE_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_DELAY_MS * attempt));
    }
  }
  console.error(
    `[hostAuthorization] settle permanently failed for requestId=${params.requestId}, externalUserId=${params.externalUserId} — needs manual reconciliation.`,
  );
}

export function newRequestId(): string {
  return randomUUID();
}
