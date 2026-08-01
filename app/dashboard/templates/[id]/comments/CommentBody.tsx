"use client";

import { splitMentionSegments } from "@/lib/comments/mentions";

export function CommentBody({ body }: { body: string }) {
  const segments = splitMentionSegments(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <span key={i} style={{ color: "var(--brand)", fontWeight: 600 }}>
            @{seg.name}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}
