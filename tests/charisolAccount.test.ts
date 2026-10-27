import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@better-auth/utils/password";

const { store } = vi.hoisted(() => ({ store: new Map<string, import("./userStoreMock").FakeUser>() }));

vi.mock("@/lib/db/coreEntities", async () => {
  const { createFakeUserEntity } = await import("./userStoreMock");
  return { User: createFakeUserEntity(store) };
});

vi.mock("@/lib/db/coreOperations", async () => {
  const { createFakeCoreOperations } = await import("./userStoreMock");
  return createFakeCoreOperations(store);
});

import { isEmailVerifiedClaim, resolveCharisolUser } from "@/server/charisolAccount";
import * as coreOperations from "@/lib/db/coreOperations";

const verifiedClaims = (extra: Record<string, unknown> = {}) => ({ email: "Ada@Example.com", email_verified: true, ...extra });

beforeEach(() => store.clear());

describe("isEmailVerifiedClaim", () => {
  it("accepts boolean true and string 'true' only", () => {
    expect(isEmailVerifiedClaim(true)).toBe(true);
    expect(isEmailVerifiedClaim("true")).toBe(true);
    for (const v of [false, "false", undefined, null, 1, "TRUE", "yes"]) expect(isEmailVerifiedClaim(v)).toBe(false);
  });
});

describe("resolveCharisolUser", () => {
  it("rejects a token whose email is not verified", async () => {
    store.set("u1", { id: "u1", email: "ada@example.com", name: "Ada", isConfirmed: true });
    expect(await resolveCharisolUser({ email: "ada@example.com", email_verified: false })).toBeNull();
    expect(await resolveCharisolUser({ email: "ada@example.com" })).toBeNull();
    expect(await resolveCharisolUser({ email: "ada@example.com", email_verified: "false" })).toBeNull();
    expect(store.size).toBe(1);
  });

  it("rejects a token with no email", async () => {
    expect(await resolveCharisolUser({ email_verified: true })).toBeNull();
    expect(store.size).toBe(0);
  });

  it("matches legacy_user_id before email", async () => {
    store.set("plexo-1", { id: "plexo-1", email: "old-address@example.com", name: "Legacy", isConfirmed: true });
    store.set("plexo-2", { id: "plexo-2", email: "ada@example.com", name: "Emailmatch", isConfirmed: true });
    const user = await resolveCharisolUser(verifiedClaims({ legacy_user_id: "plexo-1" }));
    expect(user?.id).toBe("plexo-1");
  });

  it("falls through to the lowercased verified email when legacy_user_id has no user", async () => {
    store.set("plexo-2", { id: "plexo-2", email: "ada@example.com", name: "Ada", isConfirmed: true });
    const user = await resolveCharisolUser(verifiedClaims({ legacy_user_id: "does-not-exist" }));
    expect(user?.id).toBe("plexo-2");
    expect(store.size).toBe(1);
  });

  it("matches by email when there is no legacy_user_id", async () => {
    store.set("plexo-2", { id: "plexo-2", email: "ada@example.com", name: "Ada", image: "http://img", isConfirmed: true });
    expect(await resolveCharisolUser(verifiedClaims())).toEqual({ id: "plexo-2", email: "ada@example.com", name: "Ada", image: "http://img" });
  });

  it("refuses a suspended account (by legacy_user_id and by email), saying so", async () => {
    store.set("s1", { id: "s1", email: "ada@example.com", name: "Ada", isConfirmed: true, suspendedAt: "2026-01-01" });
    await expect(resolveCharisolUser(verifiedClaims({ legacy_user_id: "s1" }))).rejects.toThrow("account suspended");
    await expect(resolveCharisolUser(verifiedClaims())).rejects.toThrow("account suspended");
  });

  it("does not touch an already-confirmed account's password", async () => {
    const passwordHash = await hashPassword("my-real-password");
    store.set("c1", { id: "c1", email: "ada@example.com", name: "Ada", isConfirmed: true, passwordHash });
    await resolveCharisolUser(verifiedClaims());
    expect(store.get("c1")?.passwordHash).toBe(passwordHash);
  });

  it("pre-registration takeover: confirms an unconfirmed account and invalidates the squatter's password", async () => {
    const squatterHash = await hashPassword("attacker-chosen-password");
    store.set("t1", { id: "t1", email: "ada@example.com", name: "Squatted", isConfirmed: false, passwordHash: squatterHash });

    const user = await resolveCharisolUser(verifiedClaims());
    expect(user?.id).toBe("t1");

    const after = store.get("t1")!;
    expect(after.isConfirmed).toBe(true);
    expect(after.passwordHash).not.toBe(squatterHash);
    expect(await verifyPassword(after.passwordHash!, "attacker-chosen-password")).toBe(false);
  });

  it("takeover fix also applies when matched via legacy_user_id", async () => {
    const squatterHash = await hashPassword("attacker-chosen-password");
    store.set("t2", { id: "t2", email: "someone-else@example.com", name: "Squatted", isConfirmed: false, passwordHash: squatterHash });
    await resolveCharisolUser(verifiedClaims({ legacy_user_id: "t2" }));
    expect(store.get("t2")?.isConfirmed).toBe(true);
    expect(await verifyPassword(store.get("t2")!.passwordHash!, "attacker-chosen-password")).toBe(false);
  });

  it("creates a new verified user with a random, unusable password (never the email)", async () => {
    const user = await resolveCharisolUser(verifiedClaims({ name: "Ada L", picture: "http://pic" }));
    expect(user).toMatchObject({ email: "ada@example.com", name: "Ada L", image: "http://pic" });
    const created = store.get(user!.id)!;
    expect(created.isConfirmed).toBe(true);
    expect(created.passwordHash).toBeTruthy();
    expect(await verifyPassword(created.passwordHash!, "ada@example.com")).toBe(false);
    expect(await verifyPassword(created.passwordHash!, "Ada@Example.com")).toBe(false);
  });

  it("losing a creation race signs in as the winning account, with the takeover fix applied", async () => {
    // A concurrent password registration for the same email lands between our lookup and
    // our create: the email lock rejects our insert, and we must use the winner's row.
    const squatterHash = await hashPassword("attacker-chosen-password");
    const spy = vi.spyOn(coreOperations, "createUserWithEmailLock").mockImplementationOnce(async () => {
      store.set("racer", { id: "racer", email: "ada@example.com", name: "Racer", isConfirmed: false, passwordHash: squatterHash });
      throw new coreOperations.EmailAlreadyInUseError("ada@example.com");
    });
    const user = await resolveCharisolUser(verifiedClaims());
    spy.mockRestore();
    expect(user?.id).toBe("racer");
    expect(store.size).toBe(1);
    expect(store.get("racer")?.isConfirmed).toBe(true);
    expect(await verifyPassword(store.get("racer")!.passwordHash!, "attacker-chosen-password")).toBe(false);
  });

  it("never creates a second account for an email that already has one", async () => {
    store.set("u1", { id: "u1", email: "ada@example.com", name: "Ada", isConfirmed: true });
    const user = await resolveCharisolUser(verifiedClaims());
    expect(user?.id).toBe("u1");
    expect(store.size).toBe(1);
  });
});
