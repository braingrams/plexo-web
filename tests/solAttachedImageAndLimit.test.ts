import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

const storage = vi.hoisted(() => ({ uploads: [] as { path: string; type: string }[], file: { body: Buffer.from("png-bytes"), contentType: "image/png" } }));
vi.mock("@/lib/storage", () => ({
  readObject: vi.fn(async () => storage.file),
  uploadObject: vi.fn(async (path: string, _b: Buffer, o: { contentType: string }) => {
    storage.uploads.push({ path, type: o.contentType });
    return { url: `https://bucket/public/${path}` };
  }),
}));
const templates = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: { query: { byOrg: () => ({ go: async () => ({ data: templates.rows }) }) } },
}));

import { publishAttachedImage } from "@/lib/ai/solAttachments";
import { rawUploadLimitMessage } from "@/server/rawUploadLimit";
import { RAW_UPLOAD_DAILY_LIMIT } from "@/server/rawUpload";

const mine = "https://bucket.s3.us-east-1.amazonaws.com/private/sol-attachments/user-1/abc-photo.png";

describe("SOL putting the user's attached image on a page", () => {
  beforeEach(() => void (storage.uploads = []));

  it("copies only that image to public storage and returns its address", async () => {
    const { url } = await publishAttachedImage("user-1", mine);
    expect(storage.uploads).toEqual([{ path: expect.stringMatching(/^sol-images\/user-1\/[0-9a-f]{40}\.png$/), type: "image/png" }]);
    expect(url).toMatch(/^https:\/\/bucket\/public\/sol-images\/user-1\//);
  });

  it("refuses another user's attachment", async () => {
    await expect(publishAttachedImage("user-2", mine)).rejects.toThrow(/isn't one of this user's attachments/);
    expect(storage.uploads).toEqual([]);
  });
});

describe("the custom HTML page limit", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const raw = (h: number, extra: Record<string, unknown> = {}) => ({ userId: "u", sourceType: "RAW_UPLOAD", createdAt: hoursAgo(h), ...extra });

  it("doesn't count pages a WordPress migration created (Muzingo used up SOL's whole day)", async () => {
    templates.rows = Array.from({ length: 40 }, () => raw(1, { migratedFrom: "https://playmuzingo.com" }));
    expect(await rawUploadLimitMessage("org", "u")).toBeNull();
  });

  it("says when the next one is allowed, and the alternative", async () => {
    templates.rows = Array.from({ length: RAW_UPLOAD_DAILY_LIMIT }, (_, i) => raw(22 - i * 0.1));
    const msg = await rawUploadLimitMessage("org", "u");
    expect(msg).toMatch(/You can make another in about 2 hours/);
    expect(msg).toMatch(/drag-and-drop builder page/);
  });
});
