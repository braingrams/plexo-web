const PAYSTACK_BASE_URL = "https://api.paystack.co";

export interface PaystackInitializeParams {
  secretKey: string;
  email: string;
  amountMinor: number; // minor unit (kobo for NGN, cents for USD, etc.)
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  /** A Paystack plan code — the transaction then also starts a recurring subscription on that plan. */
  plan?: string;
}

export interface PaystackInitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Starts a Paystack hosted-checkout transaction with the merchant's OWN secret key (each
 * Commerce site brings its own Paystack account — see CommerceSettings). Throws on any
 * non-2xx or `status: false` response; the caller decides how to surface that (Commerce
 * checkout marks the just-created order FAILED rather than leaving it stuck PENDING).
 */
export async function initializePaystackTransaction(
  params: PaystackInitializeParams,
): Promise<PaystackInitializeResult> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinor,
      currency: params.currency,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      ...(params.plan ? { plan: params.plan } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message ?? `Paystack initialize failed (${response.status}).`);
  }

  return {
    authorizationUrl: payload.data.authorization_url,
    accessCode: payload.data.access_code,
    reference: payload.data.reference,
  };
}

/**
 * Refunds a transaction (fully, or partially when `amountMinor` is given) with the
 * merchant's own secret key. Throws on any non-2xx or `status: false` response — the
 * caller decides how to surface that (the refund route leaves the order PAID rather than
 * marking it REFUNDED on a failed call).
 */
export async function refundPaystackTransaction(params: { secretKey: string; reference: string; amountMinor?: number }): Promise<void> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: params.reference,
      ...(params.amountMinor !== undefined ? { amount: params.amountMinor } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message ?? `Paystack refund failed (${response.status}).`);
  }
}

async function paystackRequest<T>(secretKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message ?? `Paystack ${path} failed (${response.status}).`);
  }
  return payload.data as T;
}

/** Creates a monthly plan for one recurring amount (Paystack subscriptions are plan-based, so each distinct monthly amount needs one). */
export async function createPaystackMonthlyPlan(params: { secretKey: string; name: string; amountMinor: number; currency: string }): Promise<string> {
  const data = await paystackRequest<{ plan_code: string }>(params.secretKey, "POST", "/plan", {
    name: params.name.slice(0, 100),
    interval: "monthly",
    amount: params.amountMinor,
    currency: params.currency,
  });
  return data.plan_code;
}

/** Stops a recurring subscription — Paystack requires the subscription's email token alongside its code. */
export async function disablePaystackSubscription(params: { secretKey: string; code: string; emailToken: string }): Promise<void> {
  await paystackRequest(params.secretKey, "POST", "/subscription/disable", { code: params.code, token: params.emailToken });
}

export interface PaystackSubscriptionSummary {
  subscription_code: string;
  email_token: string;
  status: string;
  amount: number;
  plan?: { plan_code?: string; name?: string; currency?: string; interval?: string };
  customer?: { email?: string; first_name?: string | null; last_name?: string | null };
}

/** Active subscriptions on the account (one page of up to 100) — used to adopt monthly donors from a previous site. */
export async function listPaystackSubscriptions(secretKey: string, page = 1): Promise<PaystackSubscriptionSummary[]> {
  return paystackRequest<PaystackSubscriptionSummary[]>(secretKey, "GET", `/subscription?perPage=100&page=${page}`);
}
