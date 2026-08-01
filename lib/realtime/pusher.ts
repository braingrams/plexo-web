import PusherServer from "pusher";

let cached: PusherServer | null = null;

/**
 * Lazily constructed so a dev environment without Pusher keys configured yet doesn't
 * crash at import time — only actually throws once something tries to trigger an event
 * (see triggerEvent below), matching how the rest of this app treats optional integrations
 * (see server/auth.ts's sendMaildripEmail).
 */
function getPusherServer(): PusherServer {
  if (cached) return cached;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    throw new Error(
      "PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, and PUSHER_CLUSTER must be configured for realtime comments/notifications."
    );
  }

  cached = new PusherServer({ appId, key, secret, cluster, useTLS: true });
  return cached;
}

export const commentChannelName = (organizationId: string, templateId: string) =>
  `private-org-${organizationId}-template-${templateId}`;

export const userChannelName = (userId: string) => `private-user-${userId}`;

/** Fire-and-forget by convention at call sites — a realtime push failure should never fail the underlying mutation. */
export async function triggerEvent(channel: string, event: string, data: unknown): Promise<void> {
  await getPusherServer().trigger(channel, event, data);
}

/** Used by app/api/pusher/auth/route.ts once it has verified the caller may join `channel`. */
export function authorizeChannel(socketId: string, channel: string) {
  return getPusherServer().authorizeChannel(socketId, channel);
}

export function isRealtimeConfigured(): boolean {
  return Boolean(
    process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET && process.env.PUSHER_CLUSTER
  );
}
