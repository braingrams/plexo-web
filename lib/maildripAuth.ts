// Server-to-server MailDrip account auth — backs the "Connect MailDrip" flow in
// form_container's 'maildrip' provider (see app/api/v1/maildrip/[templateId]/connect).
// A password is only ever in flight from the visitor's browser to OUR OWN backend (a normal
// same-origin POST, same trust boundary as any login form) and then from our backend to
// MailDrip's API over HTTPS — it is never logged, never stored, and never sent anywhere else.
// This is defensible specifically because MailDrip and Plexo are both Charisol's own
// products; this is not a pattern to generalize to a genuine third-party service.

const MAILDRIP_API_BASE = "https://api.maildrip.io/api/v1";

export type MaildripApiError = { error: string; status: number };

async function maildripPost<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T | MaildripApiError> {
  const response = await fetch(`${MAILDRIP_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-access-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: typeof payload.message === "string" ? payload.message : "MailDrip request failed.", status: response.status };
  }
  return payload as T;
}

function isApiError<T>(result: T | MaildripApiError): result is MaildripApiError {
  return typeof result === "object" && result !== null && "error" in result && "status" in result;
}

export async function maildripRegister(input: { email: string; password: string; name: string }): Promise<{ userId: string } | MaildripApiError> {
  const result = await maildripPost<{ userId: string }>("/users/register", input);
  return result;
}

export async function maildripLogin(input: { email: string; password: string }): Promise<{ token: string; verified: boolean } | MaildripApiError> {
  const result = await maildripPost<{ token: string; verified: boolean }>("/users/login", input);
  return result;
}

export async function maildripVerify(input: { email: string; verificationCode: string }): Promise<{ ok: true } | MaildripApiError> {
  const result = await maildripPost<Record<string, unknown>>("/users/verify", input);
  if (isApiError(result)) return result;
  return { ok: true };
}

export async function maildripResendVerification(email: string): Promise<{ ok: true } | MaildripApiError> {
  const result = await maildripPost<Record<string, unknown>>("/users/resend-verification-link", { email });
  if (isApiError(result)) return result;
  return { ok: true };
}

export async function maildripFetchApiKey(token: string): Promise<{ apiKey: string } | MaildripApiError> {
  const response = await fetch(`${MAILDRIP_API_BASE}/users/credentials`, {
    headers: { "x-access-token": token },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: typeof payload.message === "string" ? payload.message : "Could not fetch MailDrip credentials.", status: response.status };
  }
  return { apiKey: payload.apiKey };
}

export { isApiError };
