"use client";

import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, Skeleton } from "../ui";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Post = { id: string; title: string; status: string; publishedAt: string | null; updatedAt: string; viewCount: number };

const STATUS: Record<string, { text: string; tone: "success" | "neutral" | "info" }> = { PUBLISHED: { text: "Published", tone: "success" }, DRAFT: { text: "Draft", tone: "neutral" }, SCHEDULED: { text: "Scheduled", tone: "info" } };

export function BlogTab({ siteId, experience }: { siteId: string; experience: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    hubApi<{ posts: Post[] }>(`/api/blog/${siteId}/posts`).then((r) => setPosts(r.posts), (e) => setError(errMsg(e, "We couldn't load your posts.")));
  }, [siteId]);
  const write = <ButtonLink href={`/dashboard/templates/${siteId}/blog/new`} leftIcon={<PenLine size={18} aria-hidden />}>Write a post</ButtonLink>;
  return (
    <>
      <TabBar title="Your blog" sub="Write posts and share them with the world." action={write} />
      {error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div> : null}
      {posts === null && !error ? (
        <Card><Skeleton height={20} width="50%" /></Card>
      ) : posts && posts.length === 0 ? (
        <EmptyState title="Write your first post" body="Tell people what's new. You can write it yourself, or ask SOL to draft it and then change the words." action={write} />
      ) : posts ? (
        <Card padding="none" className="plx-listcard" data-tour="hub-blog">
          <ul className="plx-list">
            {posts.map((p) => {
              const s = STATUS[p.status] ?? STATUS.DRAFT;
              return (
                <li key={p.id} style={{ display: "contents" }}>
                  <a className="plx-row" href={`/dashboard/templates/${siteId}/blog/${p.id}`}>
                    <span className="plx-row__main">
                      <span className="plx-row__title">{p.title}</span>
                      <span className="plx-row__sub">{new Date(p.publishedAt ?? p.updatedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}{p.status === "PUBLISHED" ? ` · ${p.viewCount} views` : ""}</span>
                    </span>
                    <span className="plx-row__end"><Badge tone={s.tone}>{s.text}</Badge></span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {experience !== "beginner" ? (
        <p className="plx-small"><ButtonLink href={`/dashboard/templates/${siteId}/blog/settings`} variant="link" size="sm">Blog settings</ButtonLink></p>
      ) : null}
    </>
  );
}
