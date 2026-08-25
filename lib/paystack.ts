const PAYSTACK_BASE_URL = "https://api.paystack.co";

export interface PaystackInitializeParams {
  secretKey: string;
  email: string;
  amountMinor: number; // kobo
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
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
      currency: "NGN",
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
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
