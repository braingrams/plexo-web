import { SignJWT, jwtVerify } from "jose";

// A learner's session is a stateless signed cookie, not a DB-backed session table — see
// the Funnel/LMS plan's "Learner auth/session" section. Revocation still works: every
// protected request re-checks LmsEnrollment.status via a single primary-key Get keyed by
// exactly the (templateId, email) this cookie carries, so flipping an enrollment to
// REVOKED takes effect on the learner's very next request with no session store to touch.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const LMS_SESSION_COOKIE_PREFIX = "plexo_lms_session_";

function secretKey(): Uint8Array {
  const secret = process.env.LMS_SESSION_SECRET;
  if (!secret) throw new Error("LMS_SESSION_SECRET is not configured.");
  return new TextEncoder().encode(secret);
}

export function lmsSessionCookieName(templateId: string): string {
  return `${LMS_SESSION_COOKIE_PREFIX}${templateId}`;
}

export type LmsSessionPayload = { templateId: string; email: string };

export async function signLmsSession(payload: LmsSessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyLmsSession(token: string): Promise<LmsSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.templateId !== "string" || typeof payload.email !== "string") return null;
    return { templateId: payload.templateId, email: payload.email };
  } catch {
    return null;
  }
}

export const LMS_SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
