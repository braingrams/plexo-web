import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Existing apps carry their own copy of the client, so the fix reaches them by upgrading an
// unedited earlier copy before a build — never one SOL or the owner changed.

const store = vi.hoisted(() => ({ file: null as string | null, writes: 0 }));
vi.mock("@/lib/projects/fileStore", () => ({
  readTextFile: vi.fn(async () => store.file),
  writeFiles: vi.fn(async (_id: string, files: Array<{ content: string }>) => {
    store.file = files[0].content;
    store.writes += 1;
    return [];
  }),
}));

import { upgradeAppClient } from "@/lib/projects/clientUpgrade";
import { SCAFFOLD_FILES } from "@/lib/projects/scaffold";

const original = readFileSync(path.join(__dirname, "fixtures-old-plexo-client.txt"), "utf8");

beforeEach(() => {
  store.writes = 0;
});

describe("upgrading an existing app's client", () => {
  it("replaces an unedited earlier copy with the current one", async () => {
    store.file = original;
    expect(await upgradeAppClient("app")).toBe(true);
    expect(store.file).toBe(SCAFFOLD_FILES["src/lib/plexo.ts"]);
  });

  it("never touches a copy that was edited", async () => {
    store.file = original.replace("Plexo client", "Plexo client (customised)");
    expect(await upgradeAppClient("app")).toBe(false);
    expect(store.writes).toBe(0);
  });

  it("does nothing when it's already current or missing", async () => {
    store.file = SCAFFOLD_FILES["src/lib/plexo.ts"];
    expect(await upgradeAppClient("app")).toBe(false);
    store.file = null;
    expect(await upgradeAppClient("app")).toBe(false);
    expect(store.writes).toBe(0);
  });
});
