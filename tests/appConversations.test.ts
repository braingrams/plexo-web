import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Deleting watchy on staging removed everything it owned except its SOL chat, which stayed in
// the owner's list bound to an app that no longer existed.

const db = vi.hoisted(() => ({
  convos: [] as any[],
  messages: [] as any[],
  shares: new Map<string, { conversationId: string; token: string }>(),
  links: new Set<string>(),
  members: [] as Array<{ userId: string }>,
}));

vi.mock("@/lib/db/coreEntities", () => ({
  Member: { query: { primary: () => ({ go: async () => ({ data: db.members }) }) } },
}));
vi.mock("@/lib/db/solEntities", () => ({
  SolConversation: {
    query: { primary: ({ userId }: { userId: string }) => ({ go: async () => ({ data: db.convos.filter((c) => c.userId === userId) }) }) },
    delete: (k: any) => ({ go: async () => void (db.convos = db.convos.filter((c) => c.id !== k.id)) }),
  },
  SolMessage: {
    query: { primary: ({ conversationId }: { conversationId: string }) => ({ go: async () => ({ data: db.messages.filter((m) => m.conversationId === conversationId) }) }) },
    delete: (keys: any[]) => ({ go: async () => void (db.messages = db.messages.filter((m) => !keys.some((k) => k.id === m.id))) }),
  },
  SolConversationShare: {
    get: ({ conversationId }: { conversationId: string }) => ({ go: async () => ({ data: db.shares.get(conversationId) ?? null }) }),
    delete: ({ conversationId }: { conversationId: string }) => ({ go: async () => void db.shares.delete(conversationId) }),
  },
  SolShareLink: { delete: ({ token }: { token: string }) => ({ go: async () => void db.links.delete(token) }) },
}));

import { deleteAppConversations } from "@/lib/projects/appConversations";

beforeEach(() => {
  db.members = [{ userId: "teammate" }];
  db.convos = [
    { id: "c-owner", userId: "owner", appId: "watchy", updatedAt: "1" },
    { id: "c-mate", userId: "teammate", appId: "watchy", updatedAt: "1" },
    { id: "c-other-app", userId: "owner", appId: "telly", updatedAt: "1" },
    { id: "c-plain", userId: "owner", updatedAt: "1" },
  ];
  db.messages = [
    ...Array.from({ length: 60 }, (_, i) => ({ conversationId: "c-owner", createdAt: String(i), id: `m${i}` })),
    { conversationId: "c-mate", createdAt: "1", id: "mate1" },
    { conversationId: "c-other-app", createdAt: "1", id: "keep1" },
    { conversationId: "c-plain", createdAt: "1", id: "keep2" },
  ];
  db.shares = new Map([["c-owner", { conversationId: "c-owner", token: "tok" }]]);
  db.links = new Set(["tok"]);
});

describe("deleting an app's SOL chats", () => {
  it("removes every person's chat for that app, with its messages and share link", async () => {
    expect(await deleteAppConversations({ id: "watchy", userId: "owner", organizationId: "org" })).toBe(2);
    expect(db.convos.map((c) => c.id).sort()).toEqual(["c-other-app", "c-plain"]);
    expect(db.messages.map((m) => m.id).sort()).toEqual(["keep1", "keep2"]);
    expect(db.shares.size).toBe(0);
    expect(db.links.size).toBe(0);
  });

  it("leaves everything alone when the app had no chats", async () => {
    expect(await deleteAppConversations({ id: "nothing", userId: "owner", organizationId: "org" })).toBe(0);
    expect(db.convos).toHaveLength(4);
    expect(db.messages).toHaveLength(63);
  });
});
