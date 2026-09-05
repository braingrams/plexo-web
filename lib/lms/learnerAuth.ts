import { NextRequest } from "next/server";
import type { EntityItem } from "electrodb";
import { LmsEnrollment } from "@/lib/db/contentEntities";
import { lmsSessionCookieName, verifyLmsSession } from "./session";

export type ResolvedLearner = {
  templateId: string;
  email: string;
  enrollment: EntityItem<typeof LmsEnrollment>;
};

/**
 * Verifies the learner session cookie, then re-checks LmsEnrollment.status with a single
 * primary-key Get (the cookie carries exactly this entity's key) — this is what makes an
 * admin's revoke take effect immediately with no session table to invalidate. Returns null
 * on any failure (missing cookie, bad/expired JWT, enrollment gone or revoked) — callers
 * respond 401 uniformly rather than distinguishing why.
 */
export async function resolveLearner(request: NextRequest, templateId: string): Promise<ResolvedLearner | null> {
  const token = request.cookies.get(lmsSessionCookieName(templateId))?.value;
  if (!token) return null;

  const payload = await verifyLmsSession(token);
  if (!payload || payload.templateId !== templateId) return null;

  const { data: enrollment } = await LmsEnrollment.get({ templateId, email: payload.email }).go();
  if (!enrollment || enrollment.status !== "ACTIVE") return null;

  return { templateId, email: payload.email, enrollment };
}
