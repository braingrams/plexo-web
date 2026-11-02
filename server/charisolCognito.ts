// Plexo's own email + password form, checked by Charisol Auth (the shared Cognito pool every
// Charisol product signs into) instead of Plexo's local password hash — no redirect: the
// person types into Plexo's form and Plexo asks Charisol directly. Only "outside" (non-
// Charisol) apps use Charisol's hosted sign-in page.
//
// These are Cognito's public, unauthenticated user APIs (InitiateAuth / ForgotPassword /
// ConfirmForgotPassword) called with Plexo's app-client id — no AWS credentials involved.
// USER_PASSWORD_AUTH (not SRP) on purpose: it's the flow that lets Cognito call Charisol's
// legacy-password migration trigger, which asks Plexo's /api/charisol/legacy-verify whether
// an existing Plexo user's password is right — that's how existing users move across with no
// reset (see Charisol's docs/legacy-user-migration.md).

export type PasswordSignInResult =
  | { kind: "ok"; idToken: string; /** Kept (encrypted, server-side) so other Charisol products open without another login. */ refreshToken?: string }
  /** Wrong password, or no Charisol account Cognito could find/migrate. */
  | { kind: "wrong_password" }
  /** The account exists but must choose a new password (e.g. a migrated password that's
   *  too weak for Charisol's policy). Cognito has NOT sent a code — call sendResetCode. */
  | { kind: "reset_required" }
  | { kind: "unconfirmed" }
  /** Charisol hasn't switched on password sign-in for Plexo yet. */
  | { kind: "not_enabled" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export type SendResetCodeResult = { kind: "sent" } | { kind: "rate_limited" } | { kind: "unavailable" };

export type ConfirmResetResult =
  | { kind: "ok" }
  | { kind: "invalid_code" }
  | { kind: "expired_code" }
  | { kind: "weak_password"; message: string }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

function clientId(): string {
  return process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "";
}

function endpoint(): string {
  // The region is the user-pool id's prefix ("us-east-1_AbC…").
  const region = (process.env.CHARISOL_USER_POOL_ID ?? "").split("_")[0] || "us-east-1";
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

type CognitoResponse = { ok: true; body: any } | { ok: false; type: string; message: string } | { ok: false; type: "network"; message: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(action: string, payload: Record<string, unknown>): Promise<CognitoResponse> {
  if (!clientId()) return { ok: false, type: "network", message: "Charisol client id is not configured" };
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify({ ClientId: clientId(), ...payload }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, type: "network", message: err instanceof Error ? err.message : String(err) };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, body };
  // "__type" is sometimes namespaced ("com.amazonaws…#NotAuthorizedException").
  const type = String(body.__type ?? `HTTP${res.status}`).split("#").pop()!;
  return { ok: false, type, message: String(body.message ?? body.Message ?? "") };
}

const RATE_LIMITED = new Set(["TooManyRequestsException", "LimitExceededException", "TooManyFailedAttemptsException"]);

export async function passwordSignIn(email: string, password: string): Promise<PasswordSignInResult> {
  const res = await call("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (res.ok) {
    const idToken = res.body?.AuthenticationResult?.IdToken;
    const refreshToken = res.body?.AuthenticationResult?.RefreshToken;
    if (typeof idToken === "string" && idToken) return { kind: "ok", idToken, ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}) };
    // A challenge instead of tokens. NEW_PASSWORD_REQUIRED (an admin-created account) is
    // handled the same way as a required reset; Plexo doesn't enrol MFA, so anything else
    // is unexpected — treat it as unavailable rather than guess.
    return res.body?.ChallengeName === "NEW_PASSWORD_REQUIRED" ? { kind: "reset_required" } : { kind: "unavailable" };
  }
  switch (res.type) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return { kind: "wrong_password" };
    case "PasswordResetRequiredException":
      return { kind: "reset_required" };
    case "UserNotConfirmedException":
      return { kind: "unconfirmed" };
    case "InvalidParameterException":
      // "USER_PASSWORD_AUTH flow not enabled for this client" — the rollout hasn't reached Plexo.
      if (/flow not enabled/i.test(res.message)) return { kind: "not_enabled" };
      return { kind: "unavailable" };
    default:
      if (RATE_LIMITED.has(res.type)) return { kind: "rate_limited" };
      console.error("Charisol password sign-in failed unexpectedly:", res.type, res.message);
      return { kind: "unavailable" };
  }
}

/** Emails a password-reset code from Charisol. Unknown emails look identical to known ones. */
export async function sendResetCode(email: string): Promise<SendResetCodeResult> {
  const res = await call("ForgotPassword", { Username: email });
  if (res.ok) return { kind: "sent" };
  if (RATE_LIMITED.has(res.type)) return { kind: "rate_limited" };
  // UserNotFoundException / InvalidParameterException (no verified email, federated-only) —
  // answer exactly like a sent code so this can't be used to probe which emails exist.
  if (res.type === "UserNotFoundException" || res.type === "InvalidParameterException" || res.type === "NotAuthorizedException") {
    return { kind: "sent" };
  }
  console.error("Charisol ForgotPassword failed:", res.type, res.message);
  return { kind: "unavailable" };
}

export async function confirmReset(email: string, code: string, newPassword: string): Promise<ConfirmResetResult> {
  const res = await call("ConfirmForgotPassword", { Username: email, ConfirmationCode: code, Password: newPassword });
  if (res.ok) return { kind: "ok" };
  switch (res.type) {
    case "CodeMismatchException":
    case "UserNotFoundException":
      return { kind: "invalid_code" };
    case "ExpiredCodeException":
      return { kind: "expired_code" };
    case "InvalidPasswordException":
      return { kind: "weak_password", message: res.message.replace(/^Password does not conform to policy:\s*/i, "") };
    default:
      if (RATE_LIMITED.has(res.type)) return { kind: "rate_limited" };
      console.error("Charisol ConfirmForgotPassword failed:", res.type, res.message);
      return { kind: "unavailable" };
  }
}
