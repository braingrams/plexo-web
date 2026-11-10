import { triggerEvent } from "./pusher";
import {
  buildLogChannelName,
  MAX_LOG_LINE_CHARS,
  type BuildLogMessage,
  type BuildStatusMessage,
} from "./buildLog";

/** Used only by the build finalizer, which has Pusher credentials. Kept apart from buildLog.ts so the
 * build worker (which only needs the types) never pulls in the Pusher client. */

/** Sends one batch to the build's channel. Shortens over-long lines so no event exceeds Pusher's limit. */
export async function publishBuildLog(message: BuildLogMessage): Promise<void> {
  const lines = message.lines.map((line) => (line.length > MAX_LOG_LINE_CHARS ? line.slice(0, MAX_LOG_LINE_CHARS) + " …" : line));
  await triggerEvent(buildLogChannelName(message.buildId), "lines", { seq: message.seq, lines });
}

/** Tells subscribers the build reached a final state, so they can stop waiting for more lines. */
export async function publishBuildStatus(message: BuildStatusMessage): Promise<void> {
  await triggerEvent(buildLogChannelName(message.buildId), "status", { status: message.status, summary: message.summary });
}
