import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A person must never end up with two identical workspaces. That happened once: signup's
// first requests raced, each saw "no workspace yet", and each created one with a random id.
// These tests pin the two things that keep it from happening again.

const { orgs, members } = vi.hoisted(() => ({ orgs: new Map<string, { id: string; name: string; slug: string }>(), members: new Map<string, { organizationId: string; userId: string; role: string }>() }));

const alreadyExists = () => Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });

vi.mock("@/lib/db/coreEntities", () => ({
  Organization: {
    // Same behaviour as ElectroDB's create(): refuses if the primary key is already taken.
    create: (org: { id: string; name: string; slug: string }) => ({
      go: async () => {
        await Promise.resolve(); // yield, so concurrent callers genuinely interleave
        if (orgs.has(org.id)) throw alreadyExists();
        orgs.set(org.id, org);
        return { data: org };
      },
    }),
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: orgs.get(id) ?? null }) }),
  },
  Member: {
    create: (m: { organizationId: string; userId: string; role: string }) => ({
      go: async () => {
        await Promise.resolve();
        const key = `${m.organizationId}#${m.userId}`;
        if (members.has(key)) throw alreadyExists();
        members.set(key, m);
        return { data: m };
      },
    }),
  },
  User: {},
}));

import { ensurePersonalWorkspace } from "@/server/orgMemberships";

describe("personal workspace provisioning", () => {
  it("gives a person exactly one workspace even when many requests race for it", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => ensurePersonalWorkspace("user-1", "Ada's Workspace")));

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(orgs.size).toBe(1);
    expect([...members.values()].filter((m) => m.userId === "user-1")).toHaveLength(1);
  });

  it("keeps different people's workspaces separate", async () => {
    const a = await ensurePersonalWorkspace("user-a", "A's Workspace");
    const b = await ensurePersonalWorkspace("user-b", "B's Workspace");
    expect(a.id).not.toBe(b.id);
  });

  it("repairs a workspace whose membership never got written, without making a second one", async () => {
    orgs.set("personal-user-c", { id: "personal-user-c", name: "C's Workspace", slug: "x" });
    const before = orgs.size;
    await ensurePersonalWorkspace("user-c", "C's Workspace");
    expect(orgs.size).toBe(before);
    expect(members.has("personal-user-c#user-c")).toBe(true);
  });
});

describe("no other way to create a workspace", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name === ".next" || name === "tests") return [];
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("only ensurePersonalWorkspace calls Organization.create", () => {
    const root = process.cwd();
    const offenders = ["app", "lib", "server", "lambda"]
      .flatMap((d) => sourceFiles(join(root, d)))
      .filter((file) => /Organization\.(create|put)\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    // The one-time migration/backfill scripts live under scripts/, not here.
    expect(offenders).toEqual(["server/orgMemberships.ts"]);
  });
});
