import { createHash } from "node:crypto";
import { prisma } from "@/server/prisma";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface ResolvedApiKey {
  apiKeyId: string;
  userId: string;
}

/**
 * Extracts and validates the caller's API key (x-api-key, falling back to
 * Authorization: Bearer) against prisma.apiKey. Shared by /api/v1/my-templates and
 * /api/v1/public-templates so both endpoints hash/look-up a key identically — this
 * used to be duplicated inline in one route file (and, before that, not actually
 * validated at all).
 */
export async function resolveApiKey(request: Request): Promise<ResolvedApiKey | null> {
  const rawApiKey =
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!rawApiKey) return null;

  const hashedKey = sha256(rawApiKey);
  const apiKeyRecord = await prisma.apiKey.findFirst({
    where: { hashedKey, isActive: true },
    select: { id: true, userId: true },
  });

  if (!apiKeyRecord) return null;

  return { apiKeyId: apiKeyRecord.id, userId: apiKeyRecord.userId };
}
