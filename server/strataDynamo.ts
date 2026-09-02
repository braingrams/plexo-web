import { User } from "@/lib/db/coreEntities";

// DynamoDB-stack port of server/strata.ts — same behavior, same rationale (see that
// file's comments), just backed by the User entity instead of Prisma.
export interface StrataTokenFlat {
  key: string;
  name: string;
  value: string;
  type: string;
}

const STRATA_CDN_BASE = "https://snapshot.strata.charisol.io";

function inferTokenType(value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return "color";
  if (/^rgb|^hsl/.test(value)) return "color";
  if (/px$|rem$|em$|%$/.test(value)) return "spacing";
  if (/^\d+(\.\d+)?$/.test(value)) return "number";
  return "string";
}

/**
 * Resolves the Strata project id an account is connected to. If `incomingProjectId` is
 * provided, it connects (or switches) the account to that project first — so a single
 * call can both "connect" and "check status" depending on whether an id was passed.
 */
export async function resolveStrataProjectId(
  userId: string,
  incomingProjectId?: string,
): Promise<string | null> {
  const trimmed = incomingProjectId?.trim();
  if (trimmed) {
    await User.patch({ id: userId }).set({ strataProjectId: trimmed }).go();
    return trimmed;
  }

  const { data: user } = await User.get({ id: userId }).go();
  return user?.strataProjectId || null;
}

export async function fetchStrataTokens(
  projectId: string,
): Promise<{ tokens: StrataTokenFlat[] } | { error: string }> {
  try {
    const url = `${STRATA_CDN_BASE}/snapshots/${encodeURIComponent(projectId)}/strata.json`;
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `Strata project "${projectId}" not found or not public (status ${res.status}).` };
    }

    const data = await res.json();
    const variablesObj: Record<string, any> = data.variables || {};
    const tokens: StrataTokenFlat[] = Object.entries(variablesObj).map(([key, v]: [string, any]) => {
      const resolved = String(v.resolvedValue || v.value || "");
      return {
        key,
        name: v.name || key,
        value: resolved,
        type: v.type || inferTokenType(resolved),
      };
    });

    return { tokens };
  } catch (err) {
    return { error: `Failed to fetch Strata tokens: ${err instanceof Error ? err.message : String(err)}` };
  }
}
