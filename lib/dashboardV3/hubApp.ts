/** What a hosted app's status means, in words an owner can act on. Pure (tests/hubApp.test.ts). */

export type AppStatusInput = {
  kind: "server" | "static";
  /** Visitors can open it now. */
  isLive: boolean;
  /** A build is queued or running. */
  building: boolean;
  /** The last build failed (message from the build, if any). */
  buildFailed?: string | null;
  /** The last push from GitHub could not be built or published. */
  gitError?: string | null;
};
export type AppStatus = { state: "running" | "building" | "attention" | "idle"; tone: "success" | "info" | "danger" | "neutral"; title: string; body: string };

export function appStatusView(i: AppStatusInput): AppStatus {
  if (i.building) return { state: "building", tone: "info", title: "Building a new version", body: i.isLive ? "Your current version stays online until the new one is ready. This usually takes a few minutes." : "This usually takes a few minutes. We'll put it online as soon as it's ready." };
  if (i.gitError) return { state: "attention", tone: "danger", title: "Needs your attention", body: `The last change from GitHub didn't go live. ${i.gitError}` };
  if (i.buildFailed !== undefined && i.buildFailed !== null) return { state: "attention", tone: "danger", title: "The last build didn't work", body: `${i.buildFailed || "Something in the code stopped it."} ${i.isLive ? "Your previous version is still online." : "Fix it and upload again."}`.trim() };
  if (i.isLive) return { state: "running", tone: "success", title: "Running", body: i.kind === "server" ? "Your app is online and answering visitors." : "Your app is online." };
  return { state: "idle", tone: "neutral", title: "Not online yet", body: i.kind === "server" ? "Upload your app or connect GitHub and we'll build it and put it online." : "Upload your app's files and it goes online straight away." };
}

export type AlwaysOn = { request: "NONE" | "REQUESTED" | "APPROVED" | "DECLINED"; status: "OFF" | "STARTING" | "ON" | "FAILED"; error: string | null };

export function alwaysOnView(a: AlwaysOn | null, turningOff = false): { text: string; action: "request" | "turn-off" | null } {
  if (!a) return { text: "Checking…", action: null };
  if (turningOff) return { text: "Turning off. The app goes back to starting up when someone visits.", action: null };
  if (a.request === "APPROVED") {
    if (a.status === "STARTING") return { text: "Approved. Getting it ready, this takes a few minutes.", action: null };
    if (a.status === "ON") return { text: "On. Your app is always ready, so visitors never wait for it to start.", action: "turn-off" };
    if (a.status === "FAILED") return { text: "Approved, but it didn't switch on yet. We're looking into it.", action: "turn-off" };
    return { text: "Approved. It's being set up.", action: "turn-off" };
  }
  if (a.request === "REQUESTED") return { text: "Asked for. We check each request by hand, then switch it on.", action: null };
  if (a.request === "DECLINED") return { text: "Not approved for this app. Contact us if you need it.", action: "request" };
  return { text: "Keeps your app ready all the time so visitors never wait for it to start. We check each request by hand.", action: "request" };
}

/** A variable or secret name must look like API_KEY. */
export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "NUXT_PUBLIC_", "VITE_", "PUBLIC_", "REACT_APP_"];
export const isPublicName = (name: string) => PUBLIC_PREFIXES.some((p) => name.startsWith(p));
