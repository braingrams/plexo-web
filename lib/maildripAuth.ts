// Server-to-server MailDrip account auth — backs the "Connect MailDrip" flow in
// form_container's 'maildrip' provider (see app/api/v1/maildrip/[templateId]/connect).
// A password is only ever in flight from the visitor's browser to OUR OWN backend (a normal
// same-origin POST, same trust boundary as any login form) and then from our backend to
// MailDrip's API over HTTPS — it is never logged, never stored, and never sent anywhere else.
// This is defensible specifically because MailDrip and Plexo are both Charisol's own
// products; this is not a pattern to generalize to a genuine third-party service.
//
// MailDrip's own response envelope is NOT consistent across these endpoints — confirmed by
// real calls against the live API, not assumed from its (incomplete) public docs:
//   - register / verify / resend-verification-link / credentials all go through its sendData()
//     helper, nesting the real payload under `.data`.
//   - login responds flat (`{success, token, verified}`, no `.data`) — a genuinely different
//     shape from every other endpoint here.
//   - Error responses are ALSO inconsistent: most go through sendError(), which puts the
//     message on `.error` (not `.message`, despite what's passed into it) — but login's own
//     "wrong email or password" case bypasses that and uses `.message` directly. Checking both
//     is the only way to surface the real message across every path.

const MAILDRIP_API_BASE = "https://api.maildrip.io/api/v1";

export type MaildripApiError = { error: string; status: number };

function extractErrorMessage(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  return "MailDrip request failed.";
}

async function maildripPost(path: string, body: Record<string, unknown>, token?: string): Promise<Record<string, unknown> | MaildripApiError> {
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
    return { error: extractErrorMessage(payload), status: response.status };
  }
  return payload;
}

function isApiError(result: unknown): result is MaildripApiError {
  return typeof result === "object" && result !== null && "error" in result && "status" in result;
}

// companyName and phone are genuinely required by MailDrip's own register validator
// (body("companyName").notEmpty(), body("phone").notEmpty()) despite the public API docs'
// schema not marking them that way — confirmed by a real 422 against the live API before
// wiring this up, not assumed from the docs alone.
export async function maildripRegister(input: { email: string; password: string; name: string; companyName: string; phone: string }): Promise<{ userId: string } | MaildripApiError> {
  const result = await maildripPost("/users/register", input);
  if (isApiError(result)) return result;
  const data = result.data as { userId?: string } | undefined;
  if (!data?.userId) return { error: "MailDrip did not return a user id.", status: 502 };
  return { userId: data.userId };
}

export async function maildripLogin(input: { email: string; password: string }): Promise<{ token: string; verified: boolean } | MaildripApiError> {
  const result = await maildripPost("/users/login", input);
  if (isApiError(result)) return result;
  if (typeof result.token !== "string") return { error: "MailDrip did not return a session token.", status: 502 };
  return { token: result.token, verified: Boolean(result.verified) };
}

// Confirmed via a real call: MailDrip's own verify endpoint already mints and returns a
// usable JWT on success (it exists specifically so a just-verified visitor can proceed
// without a second login step) — so this flow never needs to re-submit the password after
// verifying, unlike an earlier version of this file that called login() again afterward.
export async function maildripVerify(input: { email: string; verificationCode: string }): Promise<{ token: string } | MaildripApiError> {
  const result = await maildripPost("/users/verify", input);
  if (isApiError(result)) return result;
  const data = result.data as { token?: string } | undefined;
  if (!data?.token) return { error: "MailDrip did not return a session token.", status: 502 };
  return { token: data.token };
}

export async function maildripResendVerification(email: string): Promise<{ ok: true } | MaildripApiError> {
  const result = await maildripPost("/users/resend-verification-link", { email });
  if (isApiError(result)) return result;
  return { ok: true };
}

export async function maildripFetchApiKey(token: string): Promise<{ apiKey: string } | MaildripApiError> {
  const response = await fetch(`${MAILDRIP_API_BASE}/users/credentials`, {
    headers: { "x-access-token": token },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: extractErrorMessage(payload), status: response.status };
  }
  const data = payload.data as { apiKey?: string } | undefined;
  if (typeof data?.apiKey !== "string" || !data.apiKey) {
    return { error: "MailDrip did not return an API key.", status: 502 };
  }
  return { apiKey: data.apiKey };
}

export { isApiError };
