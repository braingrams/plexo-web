import { StrataError, type StrataAdapter, type StrataErrorKind, type StrataStatus } from "@charisol/plexo-sdk/v2/strata";
import { readStrataPopupMessage, STRATA_CONNECTED_MESSAGE, STRATA_POPUP_PATH, STRATA_SWITCH_POPUP_PATH } from "@/lib/strataConnect";

// The editor's Branding panel talks to Strata through this adapter, which only ever calls
// Plexo's own routes (/api/v1/strata/*). The Strata session itself lives on the server,
// encrypted, and never reaches the browser. Errors are thrown as the SDK's StrataError, whose
// message is already plain language and whose kind lets the panel offer "Reconnect".

export type StrataAdapterWindow = {
  location: { origin: string };
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  open: (url: string, target: string, features: string) => { closed: boolean; close: () => void } | null;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
};

export type StrataAdapterOptions = {
  win?: StrataAdapterWindow;
  fetchFn?: typeof fetch;
  /** The app being designed. With it, the editor's "Keep my website up to date" switch is wired to this app's server-side updates. */
  appId?: string;
};
export type PlexoStrataAdapter = StrataAdapter & {
  /** False when this Plexo has no Strata configured — the editor then leaves Strata out. */
  available: () => Promise<boolean>;
};
export type AutoUpdateState = {
  enabled: boolean;
  status: "active" | "needs-reconnect" | "off";
  lastCheckedAt: string | null;
  lastResult: string | null;
  lastResultKind: "updated" | "up-to-date" | "needs-review" | "error" | "reconnect" | null;
};

const KINDS = new Set<StrataErrorKind>(["expired", "forbidden", "not_found", "conflict", "invalid", "network", "server"]);
const POPUP = { width: 440, height: 600 };
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const BLOCKED = "Your browser blocked the sign-in window. Allow pop-ups for Plexo and try again.";

export function createStrataAdapter(options: StrataAdapterOptions = {}): PlexoStrataAdapter {
  const win = options.win ?? (window as unknown as StrataAdapterWindow);
  const doFetch = options.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let availability: boolean | undefined;
  let pendingConnect: Promise<StrataStatus> | undefined;

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(path.startsWith("/api/") ? path : `/api/v1/strata${path}`, {
        method: init.method ?? "GET",
        headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new StrataError("Couldn't reach Plexo. Check your connection and try again.", "network");
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string; kind?: string }) | null;
    if (res.ok) return data as T;
    const kind = data?.kind as StrataErrorKind | undefined;
    throw new StrataError(data?.error ?? "Something went wrong talking to Strata. Please try again.", kind && KINDS.has(kind) ? kind : "server", res.status);
  }

  async function status(): Promise<StrataStatus> {
    const s = await call<{ available?: boolean; connected: boolean; expired?: boolean; user?: { email?: string; name?: string } }>("/session");
    availability = s.available !== false;
    return { connected: !!s.connected, expired: !!s.expired, user: s.user };
  }

  function connect(options?: { switchAccount?: boolean }): Promise<StrataStatus> {
    if (pendingConnect) return pendingConnect;
    const left = Math.max(0, Math.round(win.screenX + (win.outerWidth - POPUP.width) / 2));
    const top = Math.max(0, Math.round(win.screenY + (win.outerHeight - POPUP.height) / 2));
    const popup = win.open(`${win.location.origin}${options?.switchAccount ? STRATA_SWITCH_POPUP_PATH : STRATA_POPUP_PATH}`, "plexo-strata-connect", `popup=yes,width=${POPUP.width},height=${POPUP.height},left=${left},top=${top}`);
    if (!popup) return Promise.reject(new StrataError(BLOCKED, "invalid"));

    pendingConnect = new Promise<StrataStatus>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        win.removeEventListener("message", onMessage);
        clearInterval(watcher);
        clearTimeout(timeout);
        pendingConnect = undefined;
        fn();
      };
      const onMessage = (event: MessageEvent) => {
        // Only our own popup, from our own origin — nothing else can say "connected".
        if ((event as { source?: unknown }).source !== popup) return;
        const message = readStrataPopupMessage(event, win.location.origin);
        if (!message) return;
        if (message.type === STRATA_CONNECTED_MESSAGE) {
          status().then((s) => done(() => resolve(s)), (err) => done(() => reject(err)));
        } else {
          done(() => reject(new StrataError(message.message ?? "Strata couldn't be connected. Please try again.", "invalid")));
        }
      };
      win.addEventListener("message", onMessage);
      const watcher = setInterval(() => {
        if (!popup.closed || settled) return;
        // Closed without a message — some browsers drop the link to the opener after a
        // cross-site sign-in — so check whether the connection went through anyway.
        clearInterval(watcher);
        const closedEarly = () => new StrataError("The sign-in window was closed before Strata was connected. Try again when you're ready.", "invalid");
        // The window closes the moment the connection is saved, so look a couple of times before deciding nobody connected.
        const look = (triesLeft: number) =>
          status().then(
            (s) => (s.connected ? done(() => resolve(s)) : triesLeft > 0 ? setTimeout(() => look(triesLeft - 1), 600) : done(() => reject(closedEarly()))),
            () => (triesLeft > 0 ? setTimeout(() => look(triesLeft - 1), 600) : done(() => reject(closedEarly()))),
          );
        look(2);
      }, 400);
      const timeout = setTimeout(() => {
        popup.close();
        done(() => reject(new StrataError("Connecting to Strata took too long. Please try again.", "invalid")));
      }, POPUP_TIMEOUT_MS);
    });
    return pendingConnect;
  }

  return {
    status,
    connect,
    async available() {
      if (availability === undefined) await status().catch(() => undefined);
      return availability === true;
    },
    // Automatic updates run on Plexo's server (it holds a read-only Strata key), so the editor's switch asks the server.
    ...(options.appId
      ? {
          async setAutoUpdate(_projectId: string, enabled: boolean) {
            await call<AutoUpdateState>(`/api/v1/apps/${encodeURIComponent(options.appId!)}/strata-auto-update`, { method: enabled ? "POST" : "DELETE" });
          },
          async autoUpdateStatus() {
            const state = await call<AutoUpdateState>(`/api/v1/apps/${encodeURIComponent(options.appId!)}/strata-auto-update`);
            return { enabled: state.enabled, ok: state.status === "active" && (state.lastResultKind === null || state.lastResultKind === "updated" || state.lastResultKind === "up-to-date"), message: state.lastResult ?? undefined };
          },
        }
      : {}),
    async disconnect() {
      await call("/session", { method: "DELETE" });
    },
    async listProjects() {
      return (await call<{ projects: Awaited<ReturnType<StrataAdapter["listProjects"]>> }>("/projects")).projects;
    },
    async createProject(input) {
      return (await call<{ project: Awaited<ReturnType<StrataAdapter["createProject"]>> }>("/projects", { method: "POST", body: input })).project;
    },
    pull(projectId) {
      return call(`/projects/${encodeURIComponent(projectId)}/design-system`);
    },
    push(projectId, payload, baseRevision) {
      return call(`/projects/${encodeURIComponent(projectId)}/design-system`, { method: "PUT", body: { ...payload, ...(baseRevision ? { baseRevision } : {}) } });
    },
  };
}
