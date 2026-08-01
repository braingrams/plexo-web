"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getPusherClient, commentChannelName } from "@/lib/realtime/pusherClient";

export type CommentItem = {
  id: string;
  parentId: string | null;
  body: string;
  anchorNodeId: string | null;
  anchorNodeType: "row" | "column" | "element" | null;
  anchorX: number | null;
  anchorY: number | null;
  deviceView: string | null;
  resolved: boolean;
  resolvedById: string | null;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  author: { id: string; name: string; image: string | null };
};

export function useComments(templateId: string, organizationId: string) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const commentsRef = useRef<CommentItem[]>([]);
  commentsRef.current = comments;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/comments?templateId=${templateId}`);
      const data = await res.json();
      setComments(data.comments ?? []);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(commentChannelName(organizationId, templateId));

    channel.bind("comment:new", (payload: CommentItem) => {
      setComments((prev) => (prev.some((c) => c.id === payload.id) ? prev : [...prev, payload]));
    });
    channel.bind("comment:updated", (payload: { id: string; body: string }) => {
      setComments((prev) => prev.map((c) => (c.id === payload.id ? { ...c, body: payload.body, edited: true } : c)));
    });
    channel.bind("comment:resolved", (payload: { id: string; resolved: boolean }) => {
      setComments((prev) => prev.map((c) => (c.id === payload.id ? { ...c, resolved: payload.resolved } : c)));
    });
    channel.bind("comment:deleted", (payload: { id: string }) => {
      setComments((prev) => prev.map((c) => (c.id === payload.id ? { ...c, deleted: true, body: "" } : c)));
    });

    return () => {
      pusher.unsubscribe(commentChannelName(organizationId, templateId));
    };
  }, [organizationId, templateId]);

  const create = useCallback(
    async (input: {
      body: string;
      parentId?: string;
      anchorNodeId?: string;
      anchorNodeType?: "row" | "column" | "element";
      anchorX?: number;
      anchorY?: number;
      deviceView?: string;
    }) => {
      const res = await fetch("/api/v1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, ...input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't post comment.");
      setComments((prev) => (prev.some((c) => c.id === data.comment.id) ? prev : [...prev, data.comment]));
      return data.comment as CommentItem;
    },
    [templateId],
  );

  const resolve = useCallback(async (id: string, resolved: boolean) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved } : c)));
    await fetch(`/api/v1/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    }).catch(() => {});
  }, []);

  const remove = useCallback(async (id: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, deleted: true, body: "" } : c)));
    await fetch(`/api/v1/comments/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  return { comments, loading, create, resolve, remove, reload: load };
}
