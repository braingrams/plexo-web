import { randomBytes } from "node:crypto";
import { ProjectPreviewHost } from "@/lib/db/projectEntities";
import { getPagesDomain } from "@/server/pagesDomain";

// Preview links live on the pages domain as "preview--<10 chars>.<pagesDomain>". The "--"
// can't appear in a published subdomain (rejected by every publish path), so a preview
// host can never collide with — or be claimed by — a real site. Unguessable, so an
// unpublished app isn't discoverable, and single-label, so the existing wildcard
// certificate covers it.

const PREFIX = "preview--";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function isPreviewHostLabel(label: string): boolean {
  return label.startsWith(PREFIX) && /^[a-z0-9]{10}$/.test(label.slice(PREFIX.length));
}

function randomLabel(): string {
  const bytes = randomBytes(10);
  return PREFIX + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function createPreviewHost(templateId: string, organizationId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const host = randomLabel();
    try {
      await ProjectPreviewHost.create({ host, templateId, organizationId }).go();
      return host;
    } catch (err: any) {
      if (err?.cause?.name !== "ConditionalCheckFailedException" && !String(err?.message).includes("conditional")) throw err;
    }
  }
  throw new Error("Couldn't reserve a preview address — please try again.");
}

export function previewUrl(host: string): string {
  return `https://${host}.${getPagesDomain()}`;
}

/** Resolves a full hostname ("preview--abc.plexopages.com") to its project, or null. */
export async function resolvePreviewHost(hostname: string): Promise<{ templateId: string } | null> {
  const pagesDomain = getPagesDomain();
  let label = hostname;
  if (hostname.endsWith(`.${pagesDomain}`)) label = hostname.slice(0, -(pagesDomain.length + 1));
  else if (hostname.endsWith(".localhost")) label = hostname.slice(0, -".localhost".length);
  if (!isPreviewHostLabel(label)) return null;
  const { data } = await ProjectPreviewHost.get({ host: label }).go();
  return data ? { templateId: data.templateId } : null;
}
