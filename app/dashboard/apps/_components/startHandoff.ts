// What the owner gave us on the Apps home — the brief, the questions' answers and any files —
// carried to the editor so SOL's very first message has the full picture. It travels through
// sessionStorage, never the address bar: a long brief in the URL is what made CloudFront answer
// "414 request too long", and a URL that is re-opened would send the same brief twice.

import { classifyAttachmentType, type ModelTier } from "../../sol/_components/types";
import { prepareImageForModel } from "../../sol/_components/prepareImage";

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

export type StartFileRole = "logo" | "design" | "reference";

export type StartFile = {
  id: string;
  name: string;
  size: number;
  role: StartFileRole;
  status: "uploading" | "ready" | "error";
  error?: string;
  /** Set once uploaded. */
  url?: string;
  type?: "image" | "pdf" | "document";
};

export type StartHandoff = {
  prompt: string;
  plan: string | null;
  notes: string;
  /** Standard (BASIC) or Advanced (MEDIUM) — what the owner picked before building. */
  modelTier?: ModelTier;
  files: Array<{ role: StartFileRole; type: "image" | "pdf" | "document"; url: string; name: string }>;
};

export const START_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv";
export const MAX_START_FILES = 12;

const key = (appId: string) => `plexo:app-start:${appId}`;

export function saveHandoff(appId: string, handoff: StartHandoff) {
  try {
    sessionStorage.setItem(key(appId), JSON.stringify(handoff));
  } catch {
    // Private mode / storage full — the editor just opens empty and the owner can paste the brief.
  }
}

/** Reads the handoff once and removes it, so a refresh can never send it a second time. */
export function takeHandoff(appId: string): StartHandoff | null {
  try {
    const raw = sessionStorage.getItem(key(appId));
    if (!raw) return null;
    sessionStorage.removeItem(key(appId));
    const parsed = JSON.parse(raw) as StartHandoff;
    return typeof parsed?.prompt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Uploads one file the same way the chat composer does (private, owner-checked). */
export async function uploadStartFile(original: File): Promise<{ url: string; type: "image" | "pdf" | "document" }> {
  const file = await prepareImageForModel(original);
  // Some browsers leave the type empty for .md/.csv — fall back to the extension.
  const contentType = file.type || TYPE_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
  const type = classifyAttachmentType(contentType);
  if (!type) throw new Error("That file type isn't supported. Try an image, PDF, Word document or text file.");
  const presign = await fetch("/api/v1/sol/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, sizeBytes: file.size }),
  });
  const data = (await presign.json().catch(() => ({}))) as { url?: string; fields?: Record<string, string>; publicUrl?: string; error?: string };
  if (!presign.ok || !data.url || !data.fields || !data.publicUrl) throw new Error(data.error || "The upload didn't go through. Please try again.");
  const form = new FormData();
  for (const [k, v] of Object.entries(data.fields)) form.append(k, v);
  form.append("file", file);
  const res = await fetch(data.url, { method: "POST", body: form });
  if (!res.ok) throw new Error("The upload didn't go through. Please try again.");
  return { url: data.publicUrl, type };
}

const ROLE_LABEL: Record<StartFileRole, string> = {
  logo: "Logo",
  design: "Brand or design guide",
  reference: "Reference material",
};

/** The extra context as plain words, appended to the brief only in what SOL receives. */
export function describeExtras(handoff: Pick<StartHandoff, "notes" | "files">): string {
  const lines: string[] = [];
  if (handoff.notes.trim()) lines.push(`Extra details from the owner:\n${handoff.notes.trim()}`);
  if (handoff.files.length) {
    lines.push(
      "Files attached to this message — treat them as the source of truth and follow them closely rather than guessing:\n" +
        handoff.files.map((f) => `- ${ROLE_LABEL[f.role]}: ${f.name}`).join("\n"),
    );
  }
  return lines.join("\n\n");
}
