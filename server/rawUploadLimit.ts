import { Template } from "@/lib/db/contentEntities";
import { RAW_UPLOAD_DAILY_LIMIT } from "@/server/rawUpload";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why this person can't create another custom-HTML (raw upload) page right now, in plain
 * words — or null when they can. Counts only pages they made themselves in the last 24
 * hours: pages a WordPress migration created for them don't count (the dashboard's upload
 * route already left them out; SOL's path didn't, so one migration used up the whole day's
 * allowance and SOL quietly switched to a different kind of page).
 */
export async function rawUploadLimitMessage(organizationId: string, userId: string): Promise<string | null> {
  const since = Date.now() - DAY_MS;
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId }).go({ pages: "all" });
  const recent = orgTemplates
    .filter((t) => t.userId === userId && t.sourceType === "RAW_UPLOAD" && !t.migratedFrom && Date.parse(t.createdAt ?? "") >= since)
    .map((t) => Date.parse(t.createdAt!))
    .sort((a, b) => a - b);
  if (recent.length < RAW_UPLOAD_DAILY_LIMIT) return null;
  // Another is allowed once enough of them are more than a day old.
  const nextAllowedAt = recent[recent.length - RAW_UPLOAD_DAILY_LIMIT] + DAY_MS;
  const minutes = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 60_000));
  const hours = Math.round(minutes / 60);
  const wait = minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `about ${hours} hour${hours === 1 ? "" : "s"}`;
  return `You've made ${RAW_UPLOAD_DAILY_LIMIT} custom HTML pages in the last 24 hours, the most allowed. You can make another in ${wait} — or build this one as a drag-and-drop builder page now.`;
}
