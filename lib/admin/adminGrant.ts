// Validation for granting a platform admin role. Pure, so it's tested without the database.

export const ADMIN_ROLES = ["SUPERADMIN", "SUPPORT", "MODERATOR", "FINANCE"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** The admin-grant endpoint runs on the staging stack only. CDK sets ADMIN_ENDPOINTS_ENABLED per
 * stack (cdk/lib/compute-stack.ts); anything else, including PR previews and production, gets 404. */
export function adminEndpointsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADMIN_ENDPOINTS_ENABLED === "true";
}

export type AdminGrantInput = { email: string; adminRole: AdminRole };

/** Checks the request body. Returns the cleaned input, or an error message. */
export function parseAdminGrant(body: unknown): AdminGrantInput | string {
  if (!body || typeof body !== "object") return "Send a JSON object with `email` and `adminRole`.";
  const { email, adminRole } = body as { email?: unknown; adminRole?: unknown };
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "`email` must be a valid email address.";
  }
  if (typeof adminRole !== "string" || !(ADMIN_ROLES as readonly string[]).includes(adminRole)) {
    return `\`adminRole\` must be one of ${ADMIN_ROLES.join(", ")}.`;
  }
  return { email: email.trim().toLowerCase(), adminRole: adminRole as AdminRole };
}
