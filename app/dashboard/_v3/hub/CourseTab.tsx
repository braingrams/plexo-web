"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Input } from "../ui";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Lesson = { id: string; title: string; kind: string; order?: number };
type Learner = { email: string; name: string | null; status: "ACTIVE" | "REVOKED"; paymentStatus: "FREE" | "PAID" | "REFUNDED"; completedPageCount: number; enrolledAt: string };
const KIND: Record<string, string> = { VIDEO: "Video", DOCUMENT: "Reading", IMAGE: "Pictures", WELCOME: "Welcome" };

export function CourseTab({ siteId }: { siteId: string }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [learners, setLearners] = useState<Learner[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/lms/funnels/${siteId}`;

  const load = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([hubApi<{ pages: Lesson[] }>(`${base}/pages`), hubApi<{ enrollments: Learner[] }>(`${base}/enrollments`)]);
      setLessons(p.pages);
      setLearners(e.enrollments);
    } catch (e) {
      setError(errMsg(e, "We couldn't load your course."));
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!title.trim()) return setError("Give your lesson a name first.");
    setBusy(true);
    setError(null);
    try {
      await hubApi(`${base}/pages`, { method: "POST", json: { title: title.trim(), kind: "VIDEO" } });
      setTitle("");
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const count = lessons?.length ?? 0;
  return (
    <>
      <TabBar title="Your course" sub="Lessons people work through, and who has signed up." action={<ButtonLink href={`/dashboard/funnels/${siteId}/pages`} variant="secondary">Edit lessons</ButtonLink>} />
      {error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div> : null}
      <div className="plx-hub__grid plx-hub__grid--wide" style={{ alignItems: "start" }}>
        <Card padding="none" className="plx-listcard" data-tour="hub-course">
          <div style={{ padding: "22px 22px 0" }}><CardHeader title="Lessons" description={count ? `${count} lesson${count === 1 ? "" : "s"}, in the order people see them.` : undefined} /></div>
          <ul className="plx-list">
            {(lessons ?? []).map((l, i) => (
              <li key={l.id} className="plx-row" style={{ minHeight: 60 }}>
                <span className="plx-row__thumb" style={{ width: 36, height: 36, borderRadius: 10, fontWeight: 800 }}>{i + 1}</span>
                <span className="plx-row__main"><span className="plx-row__title">{l.title}</span></span>
                <span className="plx-row__end"><Badge>{KIND[l.kind] ?? "Lesson"}</Badge></span>
              </li>
            ))}
          </ul>
          <div style={{ padding: 22, borderTop: "1px solid var(--plx-border)", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Input fieldClassName="plx-grow" label="Add a lesson" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson 1: Getting started" style={{ minWidth: 200 }} onKeyDown={(e) => e.key === "Enter" && add()} />
            <Button loading={busy} onClick={add}>Add lesson</Button>
          </div>
        </Card>
        <Card padding="none" className="plx-listcard">
          <div style={{ padding: "22px 22px 0" }}><CardHeader title="Learners" action={<ButtonLink href={`/dashboard/funnels/${siteId}/settings`} variant="link" size="sm">Price and settings</ButtonLink>} /></div>
          {learners && learners.length === 0 ? (
            <div style={{ padding: "0 22px 22px" }}><EmptyState compact title="No learners yet" body="When someone signs up on your site they show up here with their progress." illustration={<GraduationCap size={48} aria-hidden />} /></div>
          ) : (
            <ul className="plx-list">
              {(learners ?? []).map((l) => (
                <li key={l.email} className="plx-row">
                  <span className="plx-row__main">
                    <span className="plx-row__title">{l.name || l.email}</span>
                    <span className="plx-row__sub">{l.name ? `${l.email} · ` : ""}{l.completedPageCount} of {count} done</span>
                  </span>
                  <span className="plx-row__end">{l.status === "REVOKED" ? <Badge tone="warning">Removed</Badge> : l.paymentStatus === "PAID" ? <Badge tone="success">Paid</Badge> : <Badge>Free</Badge>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
