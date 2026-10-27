import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@better-auth/utils/password";

const { store } = vi.hoisted(() => ({ store: new Map<string, import("./userStoreMock").FakeUser>() }));

vi.mock("@/lib/db/coreEntities", async () => {
  const { createFakeUserEntity } = await import("./userStoreMock");
  return { User: createFakeUserEntity(store) };
});
vi.mock("@/lib/db/coreOperations", async () => {
  const { createFakeCoreOperations } = await import("./userStoreMock");
  return createFakeCoreOperations(store);
});
// next-auth can't load outside Next.js's module resolution; only its error base class is used.
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {
    code = "credentials";
  },
}));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({
  checkCommerceRateLimit: vi.fn(async () => true),
  clientIp: () => "203.0.113.7",
}));

const saved = vi.hoisted(() => vi.fn(async (_userId: string, _token: string) => undefined));
vi.mock("@/lib/charisolLink", () => ({ saveCharisolRefresh: saved }));

import { authorizePassword } from "@/server/passwordSignIn";
import type { PasswordSignInResult } from "@/server/charisolCognito";

const request = new Request("https://plexo.example/api/auth/callback/credentials");
const PASSWORD = "Correct-Horse-9";

async function seed(extra: Partial<import("./userStoreMock").FakeUser> = {}) {
  store.set("u1", { id: "u1", email: "ada@example.com", name: "Ada", isConfirmed: true, passwordHash: await hashPassword(PASSWORD), ...extra });
}

function deps(result: PasswordSignInResult, claims: Record<string, unknown> = {}) {
  return {
    passwordSignIn: vi.fn(async () => result),
    sendResetCode: vi.fn(async () => ({ kind: "sent" })),
    verifyIdToken: vi.fn(async () => ({ sub: "charisol-sub-1", email: "ada@example.com", email_verified: true, ...claims })),
  };
}

const codeOf = async (p: Promise<unknown>) => p.then(() => "no error", (e: { code?: string }) => e.code);

beforeEach(() => store.clear());

describe("authorizePassword — Charisol accepts the password", () => {
  it("signs in and records that Charisol now holds the password", async () => {
    await seed();
    const user = await authorizePassword("Ada@Example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" }));
    expect(user?.id).toBe("u1");
    expect(store.get("u1")).toMatchObject({ charisolSub: "charisol-sub-1" });
    expect(store.get("u1")?.charisolPasswordAt).toBeTruthy();
  });

  it("keeps the Charisol sign-in (server-side) so Strata can be connected without another login, and never fails the sign-in over it", async () => {
    await seed();
    saved.mockClear();
    const user = await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t", refreshToken: "refresh.tok" }));
    expect(user?.id).toBe("u1");
    expect(saved).toHaveBeenCalledWith("u1", "refresh.tok");
    saved.mockRejectedValueOnce(new Error("db down"));
    expect((await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t", refreshToken: "r2" })))?.id).toBe("u1");
    saved.mockClear();
    await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" })); // Charisol gave no refresh token: nothing to keep
    expect(saved).not.toHaveBeenCalled();
  });

  it("matches the existing account by legacy_user_id (moved across via Plexo's verifier)", async () => {
    await seed({ email: "old@example.com" });
    const user = await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" }, { legacy_user_id: "u1" }));
    expect(user?.id).toBe("u1");
  });

  it("creates the Plexo account for someone who only had a Charisol account", async () => {
    const user = await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" }));
    expect(user?.email).toBe("ada@example.com");
    expect(store.size).toBe(1);
  });

  it("refuses a token whose email isn't verified", async () => {
    await seed();
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" }, { email_verified: false })))).toBe("unverified_email");
  });

  it("refuses a token that fails verification", async () => {
    await seed();
    const d = deps({ kind: "ok", idToken: "forged" });
    d.verifyIdToken.mockRejectedValueOnce(new Error("bad signature"));
    expect(await authorizePassword("ada@example.com", PASSWORD, request, d)).toBeNull();
  });
});

describe("authorizePassword — Charisol rejects the password", () => {
  it("not moved across yet: Plexo's own password still works (no lockout mid-rollout)", async () => {
    await seed();
    const user = await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" }));
    expect(user?.id).toBe("u1");
    expect(store.get("u1")?.charisolPasswordAt).toBeUndefined();
  });

  it("not moved across yet, wrong Plexo password too: refused", async () => {
    await seed();
    expect(await authorizePassword("ada@example.com", "Wrong-Password-1", request, deps({ kind: "wrong_password" }))).toBeNull();
  });

  it("Charisol holds the password: the old Plexo password is NOT accepted", async () => {
    await seed({ charisolPasswordAt: "2026-10-01T00:00:00.000Z" });
    expect(await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" }))).toBeNull();
  });

  it("a Google-linked user (charisolSub but no Charisol password) can still use their Plexo password", async () => {
    await seed({ charisolSub: "google-linked" });
    const user = await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" }));
    expect(user?.id).toBe("u1");
  });

  it("unconfirmed Plexo account with the right password is told to verify its email", async () => {
    await seed({ isConfirmed: false });
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" })))).toBe("unverified_email");
  });

  it("Google-only Plexo account gets the Google prompt", async () => {
    await seed({ passwordHash: "" });
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" })))).toBe("google_account_only");
  });
});

describe("authorizePassword — other Charisol answers", () => {
  it("password sign-in not switched on for Plexo yet: Plexo's own password decides", async () => {
    await seed({ charisolPasswordAt: "2026-10-01T00:00:00.000Z" });
    expect((await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "not_enabled" })))?.id).toBe("u1");
  });

  it("Charisol unreachable and it holds the password: 'try again shortly', not 'wrong password'", async () => {
    await seed({ charisolPasswordAt: "2026-10-01T00:00:00.000Z" });
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "unavailable" })))).toBe("sign_in_unavailable");
  });

  it("Charisol unreachable and Plexo still holds the password: signs in with it", async () => {
    await seed();
    expect((await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "unavailable" })))?.id).toBe("u1");
  });

  it("must choose a new password: emails a code and sends them to the reset form", async () => {
    await seed();
    const d = deps({ kind: "reset_required" });
    expect(await codeOf(authorizePassword("ada@example.com", "weakpass", request, d))).toBe("password_reset_required");
    expect(d.sendResetCode).toHaveBeenCalledWith("ada@example.com");
  });

  it("Charisol rate limit surfaces as too many attempts", async () => {
    await seed();
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "rate_limited" })))).toBe("too_many_attempts");
  });

  it("does nothing for an empty email or password", async () => {
    const d = deps({ kind: "ok", idToken: "t" });
    expect(await authorizePassword("", PASSWORD, request, d)).toBeNull();
    expect(await authorizePassword("ada@example.com", "", request, d)).toBeNull();
    expect(d.passwordSignIn).not.toHaveBeenCalled();
  });
});

describe("authorizePassword — CHARISOL_PASSWORD_ENFORCED on", () => {
  beforeEach(() => { process.env.CHARISOL_PASSWORD_ENFORCED = "true"; });
  afterEach(() => { delete process.env.CHARISOL_PASSWORD_ENFORCED; });

  it("ok at Charisol still signs in", async () => {
    await seed();
    expect((await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "ok", idToken: "t" })))?.id).toBe("u1");
  });

  it.each(["wrong_password", "not_enabled"] as const)("%s + stale Plexo password: reset code sent, no sign-in", async (kind) => {
    await seed();
    const d = deps({ kind });
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, d))).toBe("password_reset_required");
    expect(d.sendResetCode).toHaveBeenCalledWith("ada@example.com");
  });

  it("wrong at Charisol + wrong local password: generic refusal, no code", async () => {
    await seed();
    const d = deps({ kind: "wrong_password" });
    expect(await authorizePassword("ada@example.com", "Wrong-Password-1", request, d)).toBeNull();
    expect(d.sendResetCode).not.toHaveBeenCalled();
  });

  it("unknown email stays generic", async () => {
    const d = deps({ kind: "wrong_password" });
    expect(await authorizePassword("nobody@example.com", PASSWORD, request, d)).toBeNull();
    expect(d.sendResetCode).not.toHaveBeenCalled();
  });

  it.each([true, false])("unavailable fails closed (held=%s)", async (held) => {
    await seed(held ? { charisolPasswordAt: "2026-10-01T00:00:00.000Z" } : {});
    expect(await codeOf(authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "unavailable" })))).toBe("sign_in_unavailable");
  });
});

describe("authorizePassword — flag explicitly off", () => {
  it("falls back to Plexo's password as before", async () => {
    process.env.CHARISOL_PASSWORD_ENFORCED = "false";
    await seed();
    expect((await authorizePassword("ada@example.com", PASSWORD, request, deps({ kind: "wrong_password" })))?.id).toBe("u1");
    delete process.env.CHARISOL_PASSWORD_ENFORCED;
  });
});
