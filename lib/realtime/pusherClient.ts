"use client";

import PusherClient from "pusher-js";

let client: PusherClient | null = null;

/** Browser-side singleton — subscribes lazily, authorizing private channels via /api/pusher/auth. */
export function getPusherClient(): PusherClient | null {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) return null;

  if (!client) {
    client = new PusherClient(key, {
      cluster,
      authEndpoint: "/api/pusher/auth",
    });
  }
  return client;
}

export const commentChannelName = (organizationId: string, templateId: string) =>
  `private-org-${organizationId}-template-${templateId}`;

export const userChannelName = (userId: string) => `private-user-${userId}`;
