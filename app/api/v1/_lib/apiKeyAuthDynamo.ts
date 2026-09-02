import { createHash } from "node:crypto";
import { ApiKey } from "@/lib/db/coreEntities";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface ResolvedApiKey {
  apiKeyId: string;
  userId: string;
  organizationId: string;
}

/**
 * DynamoDB-stack twin of apiKeyAuth.ts — same contract, ApiKey.byHashedKey (GSI2,
 * coreEntities.ts) instead of prisma.apiKey.findFirst. Only two real callers
 * (/api/v1/my-templates, /api/v1/public-templates), both repointed here directly rather
 * than sharing the Prisma original.
 */
export async function resolveApiKey(request: Request): Promise<ResolvedApiKey | null> {
  const rawApiKey =
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!rawApiKey) return null;

  const hashedKey = sha256(rawApiKey);
  const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go();
  const apiKeyRecord = matches.find((k) => k.isActive);

  if (!apiKeyRecord) return null;

  return { apiKeyId: apiKeyRecord.id, userId: apiKeyRecord.userId, organizationId: apiKeyRecord.organizationId };
}
