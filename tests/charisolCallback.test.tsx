// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Charisol callback page serves two journeys: the normal sign-in to Plexo (unchanged), and
// the "Connect Strata" popup, which must NOT sign the person in to Plexo again.

const mocks = vi.hoisted(() => ({
  authError: null as string | null,
  getSession: vi.fn(),
  signInCharisol: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/charisolAuth", () => ({ CharisolAuth: { getSession: mocks.getSession }, POST_LOGIN_REDIRECT_KEY: "plexo_post_login_redirect", get initialAuthError() { return mocks.authError; } }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { charisol: mocks.signInCharisol } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("@/app/auth/charisol/callback/dashboard-skeleton", () => ({ DashboardSkeleton: () => null }));

async function renderPage() {
  // The page decides "Connect Strata or normal?" once per page load, so each test is a fresh load.
  vi.resetModules();
  const { default: Page } = await import("@/app/auth/charisol/callback/page");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Page />);
    await new Promise((r) => setTimeout(r, 10));
  });
  return root;
}

beforeEach(() => {
  mocks.authError = null;
  mocks.getSession.mockReset().mockResolvedValue({ idToken: "id.tok", accessToken: "a" });
  mocks.signInCharisol.mockReset().mockResolvedValue({ error: null });
  mocks.push.mockReset();
  mocks.replace.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Charisol callback page", () => {
  it("signs in to Plexo and goes to the saved destination when no purpose is set", async () => {
    window.sessionStorage.setItem("plexo_post_login_redirect", "/dashboard/sites");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderPage();
    expect(mocks.signInCharisol).toHaveBeenCalledWith({ idToken: "id.tok" });
    expect(mocks.push).toHaveBeenCalledWith("/dashboard/sites");
    // The only request is the new-account lookup (sign_up vs login); no Strata link is made.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/signup-event"]);
  });

  it("keeps the Charisol sign-in on the server after signing in, so other Charisol products open without another login", async () => {
    mocks.getSession.mockResolvedValue({ idToken: "id.tok", accessToken: "a", refreshToken: "refresh.tok" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPage();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/charisol/link", expect.objectContaining({ method: "POST", body: JSON.stringify({ refreshToken: "refresh.tok" }) }));
    expect(mocks.push).toHaveBeenCalled();
  });

  it("defaults to the dashboard, and still bounces a failed sign-in back to the login page", async () => {
    await renderPage();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    mocks.push.mockReset();
    mocks.signInCharisol.mockResolvedValue({ error: { message: "Nope" } });
    await renderPage();
    expect(mocks.replace).toHaveBeenCalledWith("/auth/login?error=Nope");
  });

  it("connects Strata instead when the popup marked its purpose: no Plexo sign-in, no redirect, tells the opener, closes", async () => {
    window.sessionStorage.setItem("plexo_strata_connect", String(Date.now()));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ connected: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    await renderPage();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/strata/session", expect.objectContaining({ method: "POST", body: JSON.stringify({ idToken: "id.tok" }) }));
    expect(postMessage).toHaveBeenCalledWith({ type: "plexo-strata-connected" }, window.location.origin);
    expect(close).toHaveBeenCalled();
    expect(mocks.signInCharisol).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    Object.defineProperty(window, "opener", { value: null, configurable: true });
  });

  it("when Charisol had no session to reuse, sends the Strata window to its own sign-in instead of failing", async () => {
    window.sessionStorage.setItem("plexo_strata_connect", String(Date.now()));
    mocks.authError = "login_required";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderPage();
    expect(mocks.replace).toHaveBeenCalledWith("/auth/strata?signin=1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("plexo_strata_connect")).toBeNull();
  });

  it("reports a failed Strata connection to the opener", async () => {
    window.sessionStorage.setItem("plexo_strata_connect", String(Date.now()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Wrong account." }), { status: 403 })));
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });
    vi.spyOn(window, "close").mockImplementation(() => {});
    await renderPage();
    expect(postMessage).toHaveBeenCalledWith({ type: "plexo-strata-failed", message: "Wrong account." }, window.location.origin);
    expect(mocks.signInCharisol).not.toHaveBeenCalled();
    Object.defineProperty(window, "opener", { value: null, configurable: true });
  });

  it("an old, forgotten marker doesn't hijack a normal sign-in", async () => {
    window.sessionStorage.setItem("plexo_strata_connect", String(Date.now() - 60 * 60 * 1000));
    await renderPage();
    expect(mocks.signInCharisol).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
