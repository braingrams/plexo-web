import { prisma } from "./prisma";

/**
 * Server-side counterpart to plexo-sdk's StrataTab/strataTokenMapping fetch+normalize logic
 * (public CDN snapshot, no auth) — kept in sync with that shape so AI tooling (MCP) and the
 * in-editor Strata tab agree on what a "token" looks like.
 */
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
    await prisma.user.update({
      where: { id: userId },
      data: { strataProjectId: trimmed },
    });
    return trimmed;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { strataProjectId: true },
  });
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
