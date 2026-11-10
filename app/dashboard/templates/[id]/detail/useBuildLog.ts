"use client";

import { useEffect, useState } from "react";
import { getPusherClient } from "@/lib/realtime/pusherClient";
import { buildLogChannelName } from "@/lib/realtime/buildLog";

/**
 * Live output of one build, over the build's private Pusher channel. Lines are kept in the order the
 * build wrote them (by batch number, since messages can arrive out of order). Lines written before this
 * subscribes are not shown: the full log is saved when the build ends.
 */
export function useBuildLog(buildId: string | null): { lines: string[]; status: string | null; summary: string | null } {
  const [batches, setBatches] = useState<Map<number, string[]>>(new Map());
  const [status, setStatus] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    setBatches(new Map());
    setStatus(null);
    setSummary(null);
    if (!buildId) return;
    const client = getPusherClient();
    if (!client) return;

    const channelName = buildLogChannelName(buildId);
    const channel = client.subscribe(channelName);
    channel.bind("lines", (data: { seq: number; lines: string[] }) => {
      setBatches((previous) => new Map(previous).set(data.seq, data.lines));
    });
    channel.bind("status", (data: { status: string; summary: string }) => {
      setStatus(data.status);
      setSummary(data.summary);
    });
    return () => {
      channel.unbind_all();
      client.unsubscribe(channelName);
    };
  }, [buildId]);

  const lines = [...batches.entries()].sort(([a], [b]) => a - b).flatMap(([, batch]) => batch);
  return { lines, status, summary };
}
