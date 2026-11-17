"use client";

import "./learners.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Copy, Download, GraduationCap, MoreHorizontal, Search, Users, Wallet, Zap, Mail, UserCheck, UserMinus } from "lucide-react";
import { Avatar, Badge, Button, Input, Modal, ProgressBar, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { CourseFrame, type CourseLite } from "./CourseFrame";
import { LearnerDrawer } from "./LearnerDrawer";
import type { Experience } from "@/lib/dashboardV3/nav";
import { displayName, filterLearners, lastActiveLabel, LEARNER_FILTERS, learnerState, learnersCsv, progressPercent, summarize, type LearnerFilter, type LearnerRow } from "@/lib/dashboardV3/learners";
import type { LessonLite, ProgressRow } from "@/lib/dashboardV3/lessonRules";

export function StatePills({ row, total }: { row: LearnerRow; total: number }) {
  const s = learnerState(row, total);
  return (
    <span className="plx-tbl__pills">
      {s === "removed" ? <Badge tone="warning">Removed</Badge> : s === "waiting" ? <Badge tone="warning" dot>Waiting for approval</Badge> : s === "finished" ? <Badge tone="success" dot>Finished</Badge> : <Badge tone="info" dot>Active</Badge>}
      {s !== "removed" ? row.paymentStatus === "PAID" ? <Badge tone="brand">Paid</Badge> : <Badge>Free</Badge> : null}
    </span>
  );
}

function RowMenu({ row, total, onOpen, onResend, onApprove, onRemove, onRestore }: { row: LearnerRow; total: number; onOpen: () => void; onResend: () => void; onApprove: () => void; onRemove: () => void; onRestore: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const state = learnerState(row, total);
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="plx-tbl__act" ref={ref} onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" iconOnly aria-label={`Actions for ${displayName(row)}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={20} aria-hidden /></Button>
      {open ? (
        <div className="plx-menu" role="menu">
          <button type="button" role="menuitem" onClick={act(onOpen)}><Users size={18} aria-hidden /> See their progress</button>
          {state === "waiting" ? <button type="button" role="menuitem" onClick={act(onApprove)}><UserCheck size={18} aria-hidden /> Let them in</button> : null}
          {state !== "removed" ? <button type="button" role="menuitem" onClick={act(onResend)}><Mail size={18} aria-hidden /> Send access link again</button> : null}
          {state === "removed" ? <button type="button" role="menuitem" onClick={act(onRestore)}><UserCheck size={18} aria-hidden /> Let them back in</button> : <button type="button" role="menuitem" data-danger="true" onClick={act(onRemove)}><UserMinus size={18} aria-hidden /> Remove from course</button>}
        </div>
      ) : null}
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LearnersView({ courses, current, lessons, learners: initial, experience, preview }: {
  courses: CourseLite[];
  current: CourseLite;
  lessons: LessonLite[];
  learners: LearnerRow[];
  experience: Experience;
  /** Dev preview: act on the screen only, no network. */
  preview?: { progress: Record<string, ProgressRow[]>; openEmail?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LearnerFilter>("all");
  const [openEmail, setOpenEmail] = useState<string | null>(preview?.openEmail ?? null);
  const [removing, setRemoving] = useState<LearnerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const total = lessons.length;
  const base = `/api/v1/lms/funnels/${current.id}/enrollments`;
  const link = current.address ? `https://${current.address}` : null;

  const summary = useMemo(() => summarize(rows, total), [rows, total]);
  const hasRemoved = rows.some((r) => r.status === "REVOKED");
  const shown = useMemo(() => filterLearners(rows, { query, filter, total }), [rows, query, filter, total]);
  const open = rows.find((r) => r.email === openEmail) ?? null;
  const patch = useCallback((email: string, p: Partial<LearnerRow>) => setRows((all) => all.map((r) => (r.email === email ? { ...r, ...p } : r))), []);

  async function run(label: string, fn: () => Promise<void>, ok: string): Promise<boolean> {
    try {
      if (!preview) await fn();
      toast.show({ title: ok, tone: "success" });
      return true;
    } catch (e) {
      toast.show({ title: label, description: errMsg(e), tone: "danger" });
      return false;
    }
  }
  const resend = (r: LearnerRow) => run("We couldn't send the link", async () => void (await hubApi(`${base}/${encodeURIComponent(r.email)}/resend-magic-link`, { method: "POST" })), `Link sent to ${r.email}`);
  const approve = (r: LearnerRow) =>
    run("We couldn't let them in", async () => {
      await hubApi(`${base}/${encodeURIComponent(r.email)}/approve`, { method: "POST", json: { pageId: r.waitingLessonId } });
      router.refresh();
    }, `${displayName(r)} can open the next lesson now`).then((done) => done && patch(r.email, { waitingLessonId: null }));
  const setStatus = (r: LearnerRow, status: "ACTIVE" | "REVOKED") =>
    run("We couldn't change that", async () => {
      await hubApi(`${base}/${encodeURIComponent(r.email)}`, { method: "PATCH", json: { status } });
      router.refresh();
    }, status === "REVOKED" ? `${displayName(r)} was removed` : `${displayName(r)} is back in`).then((done) => done && patch(r.email, { status }));

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    await setStatus(removing, "REVOKED");
    setBusy(false);
    setRemoving(null);
    setOpenEmail(null);
  }

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.show({ title: "Link copied", tone: "success" });
    } catch {
      toast.show({ title: "Couldn't copy", description: "Select the link and copy it yourself.", tone: "danger" });
    }
  };

  const filters = hasRemoved ? [...LEARNER_FILTERS, { id: "removed" as const, label: "Removed" }] : LEARNER_FILTERS;
  const stats = [
    { n: summary.learners, t: "Learners", icon: <Users size={22} aria-hidden />, tone: "brand" },
    { n: summary.activeThisWeek, t: "Active this week", icon: <Zap size={22} aria-hidden />, tone: "info" },
    { n: summary.finished, t: "Finished the course", icon: <CheckCheck size={22} aria-hidden />, tone: "success" },
    { n: summary.sales, t: "Paid sign-ups", icon: <Wallet size={22} aria-hidden />, tone: "warning" },
  ];

  return (
    <CourseFrame courses={courses} current={current} tab="learners" experience={experience}>
      {rows.length === 0 ? (
        <div className="plx-card plx-card--pad-lg" style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }} data-testid="learners-empty">
          <span className="plx-sum__ic" style={{ width: 64, height: 64, borderRadius: 20 }}><GraduationCap size={32} aria-hidden /></span>
          <div>
            <h2 className="plx-h2">No learners yet. Share your course link.</h2>
            <p className="plx-body" style={{ marginTop: 8, maxWidth: 560 }}>
              {link ? "When someone signs up on this page, they show up here with their progress." : "Your course isn't online yet. Choose a web address first, then share the link."}
            </p>
          </div>
          {link ? (
            <div className="plx-linkbox">
              <code>{link}</code>
              <Button leftIcon={<Copy size={16} aria-hidden />} onClick={copy}>Copy link</Button>
            </div>
          ) : (
            <Button onClick={() => router.push(`/dashboard/sites/${current.id}?tab=address`)}>Choose a web address</Button>
          )}
        </div>
      ) : (
        <>
          <div className="plx-sum">
            {stats.map((s) => (
              <div key={s.t} className="plx-sum__card">
                <span className="plx-sum__ic" data-tone={s.tone === "brand" ? undefined : s.tone}>{s.icon}</span>
                <div><b>{s.n}</b><span>{s.t}</span></div>
              </div>
            ))}
          </div>

          <div className="plx-tools">
            <div className="plx-search">
              <Search size={18} aria-hidden />
              <Input hideLabel label="Search learners" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="plx-filters" role="radiogroup" aria-label="Show">
              {filters.map((f) => (
                <button key={f.id} type="button" className="plx-chip" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
            <Button variant="secondary" leftIcon={<Download size={18} aria-hidden />} onClick={() => download(`${current.name.replace(/[^\w]+/g, "-").toLowerCase()}-learners.csv`, learnersCsv(filterLearners(rows, { query, filter, total }), total))}>Download list</Button>
          </div>

          <div className="plx-tbl" data-tour="learners-table">
            <div className="plx-tbl__head" aria-hidden>
              <span>Learner</span><span>Progress</span><span>Last active</span><span>Status</span><span />
            </div>
            <div className="plx-tbl__rows">
              {shown.length === 0 ? <div className="plx-tbl__empty">No one matches that. Try another search or filter.</div> : null}
              {shown.map((r) => (
                <div key={r.email} className="plx-tbl__row" onClick={() => setOpenEmail(r.email)}>
                  <button type="button" className="plx-tbl__who" onClick={(e) => { e.stopPropagation(); setOpenEmail(r.email); }} aria-label={`${displayName(r)}, see progress`}>
                    <Avatar name={displayName(r)} size={42} />
                    <span><span className="plx-tbl__name">{displayName(r)}</span><span className="plx-tbl__mail">{r.email}</span></span>
                  </button>
                  <ProgressBar thin value={r.completedPageCount} max={Math.max(1, total)} label={`${progressPercent(r.completedPageCount, total)}%`} />
                  <span className="plx-tbl__when">{lastActiveLabel(r.lastActiveAt)}</span>
                  <StatePills row={r} total={total} />
                  <RowMenu row={r} total={total} onOpen={() => setOpenEmail(r.email)} onResend={() => resend(r)} onApprove={() => approve(r)} onRemove={() => setRemoving(r)} onRestore={() => setStatus(r, "ACTIVE")} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {open ? (
        <LearnerDrawer courseId={current.id} row={open} lessons={lessons} previewProgress={preview?.progress[open.email]} onClose={() => setOpenEmail(null)} onResend={resend} onApprove={approve} onRemove={setRemoving} onRestore={(r) => setStatus(r, "ACTIVE")} />
      ) : null}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Remove ${displayName(removing)}?` : ""} description="They won't be able to open your lessons any more. Their progress is kept, and you can let them back in whenever you like." footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Keep them</Button><Button variant="danger" loading={busy} onClick={confirmRemove}>Remove</Button></>} />
    </CourseFrame>
  );
}
