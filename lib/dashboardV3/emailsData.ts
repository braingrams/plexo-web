import { Template } from "@/lib/db/contentEntities";
import { isLibraryEmail } from "./emails";

export type EmailCard = { id: string; name: string; updatedAt: string; createdAt: string; html: string };

/** The workspace's emails only: other kinds of template never reach the emails page. */
export async function loadEmails(organizationId: string): Promise<EmailCard[]> {
  const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all" });
  return data
    .filter(isLibraryEmail)
    .map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt ?? "", updatedAt: t.updatedAt ?? t.createdAt ?? "", html: t.compiledHtml ?? "" }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}
