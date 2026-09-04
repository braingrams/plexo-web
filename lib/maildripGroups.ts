/**
 * MailDrip's contact-groups API — GET/POST /api/v1/contacts/groups, `x-api-key` auth, same
 * base URL and auth header lib/maildripAuth.ts and lib/commerce/maildripNotify.ts already
 * use. Powers the Commerce Notifications settings page's group picker — replacing the old
 * free-text "Group ID" fields with a real dropdown sourced from the connected account's
 * actual groups, plus the ability to create one inline.
 *
 * MailDrip's published OpenAPI spec (api.maildrip.io/docs.json) documents a flat response —
 * `{ groups: [...] }` / `{ group: {...} }` — but a real call against the live API (using
 * Plexo's own platform MAILDRIP_API_KEY, the same key lib/commerce/maildripNotify.ts already
 * relies on) returns the payload nested under `.data` instead: `{ success, data: { groups:
 * [...] } }`. This matches what lib/maildripAuth.ts already found and documented for every
 * other MailDrip endpoint here — its docs are not a reliable source for the real envelope.
 * Both the nested and flat shapes are handled below (nested first, since that's what's
 * actually confirmed live) so this keeps working if MailDrip ever ships the flat shape their
 * own docs promise. Error responses are similarly inconsistent — some go through sendError()
 * (`.error`), some return `.message` (confirmed live: an invalid key on this exact endpoint
 * returns `{success:false, statusCode, message}`) — so both are checked, same as
 * maildripAuth.ts's extractErrorMessage.
 */
const MAILDRIP_API_BASE = "https://api.maildrip.io/api/v1";

export type MaildripGroup = { id: string; title: string; description: string | null; totalContacts: number };

function extractErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  return fallback;
}

type RawGroup = { _id: string; title: string; description?: string; totalContacts?: number };

function toGroup(g: RawGroup): MaildripGroup {
  return { id: g._id, title: g.title, description: g.description ?? null, totalContacts: g.totalContacts ?? 0 };
}

export async function listMaildripGroups(apiKey: string): Promise<MaildripGroup[]> {
  const res = await fetch(`${MAILDRIP_API_BASE}/contacts/groups`, {
    headers: { "x-api-key": apiKey },
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(extractErrorMessage(payload, "Couldn't load your MailDrip groups."));
  }
  const data = payload.data as { groups?: RawGroup[] } | undefined;
  const groups = data?.groups ?? (payload.groups as RawGroup[] | undefined) ?? [];
  return groups.map(toGroup);
}

export async function createMaildripGroup(apiKey: string, title: string, description?: string): Promise<MaildripGroup> {
  const res = await fetch(`${MAILDRIP_API_BASE}/contacts/groups`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ title, description: description || undefined }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(extractErrorMessage(payload, "Couldn't create that group."));
  }
  const data = payload.data as { group?: RawGroup } | undefined;
  const group = data?.group ?? (payload.group as RawGroup | undefined);
  if (!group) throw new Error("MailDrip didn't return the new group.");
  return toGroup(group);
}
