import type { NextRequest } from "next/server";
import { auth } from "@/server/authDynamo";
import { resolveAiKeyByRawKey, resolveAiKeyForUser, type ResolvedAiKey } from "@/lib/ai/generateRequest";

// Who is calling an AI route: the signed-in dashboard ("x-api-key: workspace-internal" +
// session), or an API caller presenting its key (x-api-key, or Bearer as a fallback —
// @charisol/plexo-sdk always uses x-api-key).

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

export async function resolveAiCaller(request: NextRequest): Promise<{ key: ResolvedAiKey } | { error: string; status: number }> {
  const xApiKey = request.headers.get("x-api-key")?.trim();
  if (xApiKey === "workspace-internal") {
    const session = await auth();
    if (!session?.user) return { error: "Unauthorized", status: 401 };
    return resolveAiKeyForUser(session.user.id);
  }
  const rawKey = xApiKey || parseBearerToken(request.headers.get("authorization"));
  if (!rawKey) return { error: "Unauthorized", status: 401 };
  return resolveAiKeyByRawKey(rawKey);
}
