import { beforeEach, describe, expect, it, vi } from "vitest";

// A conversation row is rewritten (delete + put) whenever its activity or title changes,
// because updatedAt is part of its key. Every rewrite must carry the app link over: an app
// editor chat that lost appId stopped getting the app in context after its first turn
// (SOL asked setup questions instead of building) and the editor started a new chat.

const sent: any[] = [];
const existing = {
  id: "c1",
  userId: "u1",
  organizationId: "o1",
  title: "",
  modelTier: "MEDIUM",
  status: "ACTIVE",
  messageCount: 1,
  appId: "app-123",
  createdAt: "2026-10-09T22:52:44.000Z",
  updatedAt: "2026-10-09T22:52:44.000Z",
};

import { docClient } from "@/lib/db/client";
import { SolConversation, SolMessage } from "@/lib/db/solEntities";
import { bumpConversationActivity, setConversationTitleIfUnset } from "@/lib/db/solConversationActivity";

vi.spyOn(docClient, "send").mockImplementation((async (cmd: unknown) => void sent.push(cmd)) as never);
vi.spyOn(SolConversation.query, "primary").mockReturnValue({ go: async () => ({ data: [existing] }) } as never);
vi.spyOn(SolMessage.query, "primary").mockReturnValue({ go: async () => ({ data: [{ createdAt: "2026-10-09T22:52:59.000Z" }, { createdAt: "2026-10-09T22:52:44.000Z" }] }) } as never);

const putItem = () => sent.at(-1)?.input?.TransactItems?.find((t: any) => t.Put)?.Put?.Item;

describe("rewriting a conversation keeps its app", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("after a turn", async () => {
    await bumpConversationActivity("u1", "c1");
    expect(putItem()?.appId).toBe("app-123");
  });

  it("when it gets its title", async () => {
    await setConversationTitleIfUnset("u1", "c1", "Building telly");
    expect(putItem()?.appId).toBe("app-123");
    expect(putItem()?.title).toBe("Building telly");
  });
});
