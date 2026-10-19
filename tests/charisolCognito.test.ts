import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmReset, passwordSignIn, sendResetCode } from "@/server/charisolCognito";
import { passwordProblem } from "@/lib/passwordPolicy";

// Responses mirror what Cognito actually returns (status 400 + {__type, message}); the
// "flow not enabled" message is the exact text Plexo's client returned before the rollout.
function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    (respond as unknown as { last: RequestInit }).last = init;
    return new Response(JSON.stringify(body), { status });
  });
}
const cognitoError = (type: string, message = "") => respond(400, { __type: type, message });

beforeEach(() => {
  process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID = "client-123";
  process.env.CHARISOL_USER_POOL_ID = "us-east-1_Pool";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("passwordSignIn", () => {
  it("also returns Charisol's refresh token when it gives one", async () => {
    vi.stubGlobal("fetch", respond(200, { AuthenticationResult: { IdToken: "id.t", RefreshToken: "refresh.t" } }));
    expect(await passwordSignIn("ada@example.com", "pw")).toEqual({ kind: "ok", idToken: "id.t", refreshToken: "refresh.t" });
  });

  it("returns the ID token on success, calling Cognito with Plexo's client and USER_PASSWORD_AUTH", async () => {
    const fetchMock = respond(200, { AuthenticationResult: { IdToken: "id.token.here" } });
    vi.stubGlobal("fetch", fetchMock);
    expect(await passwordSignIn("ada@example.com", "pw")).toEqual({ kind: "ok", idToken: "id.token.here" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect((init.headers as Record<string, string>)["X-Amz-Target"]).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(JSON.parse(String(init.body))).toMatchObject({ ClientId: "client-123", AuthFlow: "USER_PASSWORD_AUTH" });
  });

  it.each([
    ["NotAuthorizedException", "Incorrect username or password.", "wrong_password"],
    ["UserNotFoundException", "", "wrong_password"],
    ["PasswordResetRequiredException", "", "reset_required"],
    ["UserNotConfirmedException", "", "unconfirmed"],
    ["InvalidParameterException", "USER_PASSWORD_AUTH flow not enabled for this client", "not_enabled"],
    ["TooManyRequestsException", "", "rate_limited"],
    ["com.amazonaws.cognito#NotAuthorizedException", "", "wrong_password"],
    ["InternalErrorException", "", "unavailable"],
  ])("maps %s to %s", async (type, message, kind) => {
    vi.stubGlobal("fetch", cognitoError(type, message));
    expect((await passwordSignIn("ada@example.com", "pw")).kind).toBe(kind);
  });

  it("treats a NEW_PASSWORD_REQUIRED challenge as a required reset", async () => {
    vi.stubGlobal("fetch", respond(200, { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s" }));
    expect((await passwordSignIn("ada@example.com", "pw")).kind).toBe("reset_required");
  });

  it("network failure is 'unavailable', never 'wrong password'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await passwordSignIn("ada@example.com", "pw")).kind).toBe("unavailable");
  });
});

describe("sendResetCode", () => {
  it("answers 'sent' for unknown emails too, so it can't be used to probe accounts", async () => {
    vi.stubGlobal("fetch", cognitoError("UserNotFoundException"));
    expect(await sendResetCode("nobody@example.com")).toEqual({ kind: "sent" });
  });
  it("passes rate limiting through", async () => {
    vi.stubGlobal("fetch", cognitoError("LimitExceededException"));
    expect(await sendResetCode("ada@example.com")).toEqual({ kind: "rate_limited" });
  });
});

describe("confirmReset", () => {
  it.each([
    ["CodeMismatchException", "invalid_code"],
    ["ExpiredCodeException", "expired_code"],
  ])("maps %s to %s", async (type, kind) => {
    vi.stubGlobal("fetch", cognitoError(type));
    expect((await confirmReset("ada@example.com", "123456", "Abcdefgh12")).kind).toBe(kind);
  });
  it("returns Cognito's policy message without its prefix", async () => {
    vi.stubGlobal("fetch", cognitoError("InvalidPasswordException", "Password does not conform to policy: Password must have uppercase characters"));
    expect(await confirmReset("ada@example.com", "123456", "abcdefgh12")).toEqual({ kind: "weak_password", message: "Password must have uppercase characters" });
  });
});

describe("passwordProblem (matches Charisol's policy)", () => {
  it("accepts a password meeting every rule", () => {
    expect(passwordProblem("Correct-Horse-9")).toBeNull();
  });
  it("lists exactly what's missing", () => {
    expect(passwordProblem("short")).toBe("Your password needs at least 10 characters, an uppercase letter and a number.");
    expect(passwordProblem("alllowercase1")).toBe("Your password needs an uppercase letter.");
  });
  it("refuses the account's own email", () => {
    expect(passwordProblem("Ada@Example1.com", "ada@example1.com")).toBe("Password can't be the same as your email address.");
  });
});
