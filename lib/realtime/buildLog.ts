import { triggerEvent } from "@/lib/realtime/pusher";

// Live build output. The build worker batches output lines into SQS messages (type "build-log") on
// BUILD_EVENTS_QUEUE_URL; BuildFinalizeFn relays each batch to the build's private Pusher channel.
// A signed-in member of the build's organization can subscribe (see app/api/pusher/auth/route.ts).

/** One batch of output. `seq` orders batches, because SQS doesn't keep message order. */
export type BuildLogMessage = {
  type: "build-log";
  buildId: string;
  templateId: string;
  seq: number;
  lines: string[];
};

/** The build reached a final state (success or failure). Sent once, by the handler, when it finishes. */
export type BuildStatusMessage = {
  type: "build-status";
  buildId: string;
  templateId: string;
  status: "SUCCEEDED" | "FAILED";
  summary: string;
};

export type LiveBuildMessage = BuildLogMessage | BuildStatusMessage;

export const buildLogChannelName = (buildId: string) => `private-build-${buildId}`;

/** Pusher caps an event at 10KB, so a batch and a single line both stay well under that. */
export const MAX_LOG_LINE_CHARS = 2000;

/** Reads a live-log message from an SQS body. Anything else (the build-announce or server-app messages) gives null. */
export function parseLiveBuildMessage(body: string): LiveBuildMessage | null {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed?.buildId !== "string" || typeof parsed.templateId !== "string") return null;
  if (parsed.type === "build-log") {
    if (!Number.isInteger(parsed.seq) || !Array.isArray(parsed.lines)) return null;
    if (!parsed.lines.every((line: unknown) => typeof line === "string")) return null;
    return parsed as BuildLogMessage;
  }
  if (parsed.type === "build-status") {
    if (parsed.status !== "SUCCEEDED" && parsed.status !== "FAILED") return null;
    if (typeof parsed.summary !== "string") return null;
    return parsed as BuildStatusMessage;
  }
  return null;
}

/** Sends one batch to the build's channel. Shortens over-long lines so no event exceeds Pusher's limit. */
export async function publishBuildLog(message: BuildLogMessage): Promise<void> {
  const lines = message.lines.map((line) => (line.length > MAX_LOG_LINE_CHARS ? line.slice(0, MAX_LOG_LINE_CHARS) + " …" : line));
  await triggerEvent(buildLogChannelName(message.buildId), "lines", { seq: message.seq, lines });
}

/** Tells subscribers the build reached a final state, so they can stop waiting for more lines. */
export async function publishBuildStatus(message: BuildStatusMessage): Promise<void> {
  await triggerEvent(buildLogChannelName(message.buildId), "status", { status: message.status, summary: message.summary });
}
