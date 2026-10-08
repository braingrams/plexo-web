import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

const IMG = "https://plexo-user-content.s3.us-east-1.amazonaws.com/private/sol-attachments/u1/a-photo.jpeg";
const db = vi.hoisted(() => ({
  link: { token: "tok", conversationId: "c1", userId: "u1", upTo: "2026-10-08T12:00:00.000Z" } as Record<string, string> | null,
  messages: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/db/solEntities", () => ({
  SolShareLink: { get: () => ({ go: async () => ({ data: db.link }) }) },
  SolConversation: { query: { primary: () => ({ go: async () => ({ data: [{ id: "c1", organizationId: "o1", title: "Care partner page" }] }) }) } },
  SolMessage: { query: { primary: () => ({ go: async () => ({ data: db.messages }) }) } },
  SolConversationShare: {},
}));
vi.mock("@/lib/storage", () => ({
  getSignedDownloadUrl: vi.fn(async () => "https://signed/photo"),
  readObject: vi.fn(async () => ({ body: Buffer.from("jpg"), contentType: "image/jpeg" })),
}));
vi.mock("@/lib/ai/solAgent", () => ({
  TOOL_CAPABLE_PROVIDERS: {
    bedrock_claude: vi.fn(async () => ({ content: [{ type: "text", text: '"A caregiver smiling beside an older woman."' }], usage: { inputTokens: 1600, outputTokens: 12 } })),
  },
}));

import { loadSharedConversation, sharedAttachmentLink } from "@/lib/sol/share";
import { describeAttachedImages } from "@/lib/ai/solImageDescriptions";

db.messages = [
  { id: "m1", role: "user", createdAt: "2026-10-08T10:00:00.000Z", content: [{ type: "text", text: "Build a hero page" }, { type: "image", source: { type: "url", url: IMG }, filename: "photo.jpeg", description: "A caregiver smiling." }] },
  { id: "m2", role: "assistant", createdAt: "2026-10-08T10:01:00.000Z", content: [{ type: "text", text: "Building it." }, { type: "tool_use", id: "t1", name: "publish_raw_landing_page", input: { htmlContent: "<html>SECRET SOURCE</html>", domain: "careconnect" } }] },
  { id: "m3", role: "tool", createdAt: "2026-10-08T10:01:05.000Z", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "customer email: a@b.com" }] },
  { id: "m4", role: "assistant", createdAt: "2026-10-08T13:00:00.000Z", content: [{ type: "text", text: "Written after the share" }] },
];

describe("a shared SOL conversation", () => {
  it("shows words, images with captions and step names — never a tool's inputs or results", async () => {
    const shared = await loadSharedConversation("tok");
    const all = JSON.stringify(shared);
    expect(shared?.title).toBe("Care partner page");
    expect(all).not.toContain("SECRET SOURCE");
    expect(all).not.toContain("a@b.com");
    expect(shared?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(shared?.messages[0].blocks[1]).toMatchObject({ kind: "image", name: "photo.jpeg", description: "A caregiver smiling." });
    expect(shared?.messages[1].blocks[1]).toEqual({ kind: "step", label: "Published raw landing page", failed: true });
  });

  it("is a snapshot: messages after it was shared don't show", async () => {
    expect(JSON.stringify(await loadSharedConversation("tok"))).not.toContain("Written after the share");
  });

  it("opens only images that are part of the share, and nothing once sharing stops", async () => {
    expect(await sharedAttachmentLink("tok", IMG)).toBe("https://signed/photo");
    expect(await sharedAttachmentLink("tok", IMG.replace("a-photo", "other"))).toBeNull();
    db.link = null;
    expect(await loadSharedConversation("tok")).toBeNull();
    expect(await sharedAttachmentLink("tok", IMG)).toBeNull();
  });
});

describe("captions for attached images", () => {
  it("writes one tidy line per image and reports what it used", async () => {
    const out = await describeAttachedImages({ userId: "u1", provider: "bedrock_claude", urls: [IMG] });
    expect(out.byUrl.get(IMG)).toBe("A caregiver smiling beside an older woman.");
    expect(out.usage).toEqual({ inputTokens: 1600, outputTokens: 12 });
  });

  it("never reads another user's attachment", async () => {
    const out = await describeAttachedImages({ userId: "someone-else", provider: "bedrock_claude", urls: [IMG] });
    expect(out.byUrl.size).toBe(0);
  });
});
