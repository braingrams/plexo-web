"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, PenLine } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, Skeleton } from "../ui";
import { Pagination } from "../../_components/Pagination";
import { paginate } from "@/lib/pagination";
import { ListModeToggle, useListMode } from "./ListModeToggle";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Post = { id: string; title: string; status: string; publishedAt: string | null; updatedAt: string; viewCount: number };

const STATUS: Record<string, { text: string; tone: "success" | "neutral" | "info" }> = { PUBLISHED: { text: "Published", tone: "success" }, DRAFT: { text: "Draft", tone: "neutral" }, SCHEDULED: { text: "Scheduled", tone: "info" } };

const dateOf = (p: Post) => new Date(p.publishedAt ?? p.updatedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

export function BlogTab({ siteId, experience }: { siteId: string; experience: string }) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useListMode("blog");
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 });
  useEffect(() => {
    hubApi<{ posts: Post[] }>(`/api/blog/${siteId}/posts`).then((r) => setPosts(r.posts), (e) => setError(errMsg(e, "We couldn't load your posts.")));
  }, [siteId]);

  const write = <ButtonLink href={`/dashboard/templates/${siteId}/blog/new`} leftIcon={<PenLine size={18} aria-hidden />}>Write a post</ButtonLink>;
  const actions = write;
  const shown = paginate(posts ?? [], paging);
  return (
    <>
      <TabBar title="Your blog" sub="Write posts and share them with the world." action={actions} />
      {error ? <GateOrError error={error}><div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div></GateOrError> : null}
      {posts === null && !error ? (
        <Card><Skeleton height={20} width="50%" /></Card>
      ) : posts && posts.length === 0 ? (
        <EmptyState title="Write your first post" body="Tell people what's new. Open the editor and ask SOL to draft it for you, or write it yourself." action={actions} />
      ) : posts ? (
        <div data-tour="hub-blog">
          <div className="plx-toolbar"><ListModeToggle mode={mode} onChange={setMode} /></div>
          {mode === "grid" ? (
            <ul className="plx-gcards">
              {shown.items.map((p) => {
                const s = STATUS[p.status] ?? STATUS.DRAFT;
                return (
                  <li key={p.id} style={{ display: "contents" }}>
                    <a className="plx-gcard" href={`/dashboard/templates/${siteId}/blog/${p.id}`}>
                      <Badge tone={s.tone}>{s.text}</Badge>
                      <span className="plx-gcard__title">{p.title}</span>
                      <span className="plx-gcard__foot"><span>{dateOf(p)}{p.status === "PUBLISHED" ? ` · ${p.viewCount} views` : ""}</span><ChevronRight size={18} aria-hidden /></span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Card padding="none" className="plx-listcard">
              <ul className="plx-list">
                {shown.items.map((p) => {
                  const s = STATUS[p.status] ?? STATUS.DRAFT;
                  return (
                    <li key={p.id} style={{ display: "contents" }}>
                      <a className="plx-hrow plx-hrow--link" href={`/dashboard/templates/${siteId}/blog/${p.id}`}>
                        <span className="plx-hrow__main">
                          <span className="plx-hrow__title">{p.title}</span>
                          <span className="plx-hrow__sub">{dateOf(p)}{p.status === "PUBLISHED" ? ` · ${p.viewCount} views` : ""}</span>
                        </span>
                        <span className="plx-hrow__end"><Badge tone={s.tone}>{s.text}</Badge></span>
                        <ChevronRight size={18} aria-hidden className="plx-hrow__chev" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} noun="posts" onChange={setPaging} />
        </div>
      ) : null}
      {experience !== "beginner" ? (
        <p className="plx-small"><ButtonLink href={`/dashboard/templates/${siteId}/blog/settings`} variant="link" size="sm">Blog settings</ButtonLink></p>
      ) : null}
    </>
  );
}
