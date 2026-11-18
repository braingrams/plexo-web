"use client";

import "./learners.css";
import { useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, GripVertical, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, Modal, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { describeLock, LOCK_OPTIONS, lockChoice, reconcileRules, rulesFromChoice, type LessonLite, type LockChoice } from "@/lib/dashboardV3/lessonRules";
import type { Experience } from "@/lib/dashboardV3/nav";

const KIND: Record<string, string> = { VIDEO: "Video", DOCUMENT: "Reading", IMAGE: "Pictures", WELCOME: "Welcome" };

/** The ordered list of lessons: add, rename, reorder (drag or arrows), say when each one opens, delete. */
export function LessonsManager({ courseId, initial, experience, preview }: { courseId: string; initial: LessonLite[]; experience: Experience; preview?: boolean }) {
  const toast = useToast();
  const [lessons, setLessons] = useState(initial);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("VIDEO");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; choice: Exclude<LockChoice, "custom">; days: number }>({ title: "", choice: "after_previous", days: 7 });
  const [deleting, setDeleting] = useState<LessonLite | null>(null);
  const base = `/api/v1/lms/funnels/${courseId}/pages`;

  const fail = (e: unknown) => toast.show({ title: "That didn't work", description: errMsg(e), tone: "danger" });

  async function syncRules(next: LessonLite[]) {
    const fixes = reconcileRules(next);
    if (!fixes.length) return next;
    if (!preview) await Promise.all(fixes.map((f) => hubApi(`${base}/${f.id}`, { method: "PATCH", json: { unlockRules: f.unlockRules } })));
    return next.map((l) => fixes.find((f) => f.id === l.id) ? { ...l, unlockRules: fixes.find((f) => f.id === l.id)!.unlockRules } : l);
  }

  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= lessons.length) return;
    const moved = [...lessons];
    const [item] = moved.splice(from, 1);
    moved.splice(to, 0, item);
    const before = lessons;
    setLessons(moved);
    try {
      if (!preview) await hubApi(`${base}/reorder`, { method: "POST", json: { orderedPageIds: moved.map((l) => l.id) } });
      setLessons(await syncRules(moved));
    } catch (e) {
      setLessons(before);
      fail(e);
    }
  }

  async function add() {
    if (!title.trim()) return toast.show({ title: "Give your lesson a name first", tone: "danger" });
    setBusy(true);
    try {
      const made = preview ? { page: { id: `new-${lessons.length}`, title: title.trim(), kind, unlockRules: rulesFromChoice("after_previous", lessons.at(-1)?.id ?? null) } } : await hubApi<{ page: LessonLite }>(base, { method: "POST", json: { title: title.trim(), kind } });
      setLessons((l) => [...l, made.page]);
      setTitle("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(l: LessonLite, i: number) {
    const { choice, days } = lockChoice(l.unlockRules, i);
    setDraft({ title: l.title, choice: choice === "custom" ? "after_previous" : choice, days });
    setEditId(l.id);
  }

  async function saveEdit(l: LessonLite, i: number) {
    const current = lockChoice(l.unlockRules, i);
    const keepRules = current.choice === "custom" && draft.choice === "after_previous";
    const unlockRules = keepRules ? l.unlockRules : rulesFromChoice(i === 0 ? "open" : draft.choice, i === 0 ? null : lessons[i - 1].id, draft.days);
    setBusy(true);
    try {
      if (!preview) await hubApi(`${base}/${l.id}`, { method: "PATCH", json: { title: draft.title.trim() || l.title, ...(unlockRules ? { unlockRules } : {}) } });
      setLessons((all) => all.map((x) => (x.id === l.id ? { ...x, title: draft.title.trim() || l.title, unlockRules: unlockRules ?? x.unlockRules } : x)));
      setEditId(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      if (!preview) await hubApi(`${base}/${deleting.id}`, { method: "DELETE" });
      const rest = lessons.filter((l) => l.id !== deleting.id);
      setLessons(await syncRules(rest));
      setDeleting(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card padding="none" className="plx-listcard" data-tour="lessons-list">
        {lessons.length === 0 ? (
          <div style={{ padding: 22 }}>
            <EmptyState compact title="No lessons yet" body="Add your first lesson below. People work through lessons in the order you set here." illustration={<BookOpen size={48} aria-hidden />} />
          </div>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {lessons.map((l, i) => (
              <li key={l.id} className="plx-lesson" data-drag={dragId === l.id || undefined} data-drop={overId === l.id && dragId !== l.id || undefined}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(l.id); } }}
                onDrop={(e) => { e.preventDefault(); const from = lessons.findIndex((x) => x.id === dragId); setDragId(null); setOverId(null); if (from >= 0) void reorder(from, i); }}>
                <span className="plx-lesson__grip" draggable aria-hidden onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(null); setOverId(null); }} title="Drag to move">
                  <GripVertical size={20} />
                </span>
                <span className="plx-lesson__n">{i + 1}</span>
                <span className="plx-lesson__main">
                  <span className="plx-lesson__title">{l.title}</span>
                  <span className="plx-lesson__rule"><Lock size={13} aria-hidden /> {describeLock(l.unlockRules, i)}</span>
                </span>
                <span className="plx-lesson__acts">
                  <Badge>{KIND[l.kind] ?? "Lesson"}</Badge>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${l.title} up`} disabled={i === 0 || busy} onClick={() => reorder(i, i - 1)}><ArrowUp size={18} aria-hidden /></Button>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${l.title} down`} disabled={i === lessons.length - 1 || busy} onClick={() => reorder(i, i + 1)}><ArrowDown size={18} aria-hidden /></Button>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Rename or change when ${l.title} opens`} onClick={() => (editId === l.id ? setEditId(null) : startEdit(l, i))}><Pencil size={18} aria-hidden /></Button>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${l.title}`} onClick={() => setDeleting(l)}><Trash2 size={18} aria-hidden /></Button>
                </span>
                {editId === l.id ? (
                  <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 14, padding: "6px 0 4px" }}>
                    <Input label="Lesson name" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                    {i > 0 ? (
                      <div className="plx-lesson__edit" style={{ gridColumn: "auto", paddingTop: 0, gridTemplateColumns: draft.choice === "days" ? "minmax(0,1fr) 140px" : "1fr" }}>
                        <Select label="This lesson opens" value={draft.choice} onChange={(e) => setDraft((d) => ({ ...d, choice: e.target.value as typeof d.choice }))} options={LOCK_OPTIONS} />
                        {draft.choice === "days" ? <Input label="Days" type="number" min={0} value={draft.days} onChange={(e) => setDraft((d) => ({ ...d, days: Number(e.target.value) }))} /> : null}
                      </div>
                    ) : <p className="plx-small">The first lesson opens as soon as someone signs up.</p>}
                    {lockChoice(l.unlockRules, i).choice === "custom" ? <p className="plx-small">This lesson has special rules. Picking an option here replaces them.</p> : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Button loading={busy} onClick={() => saveEdit(l, i)}>Save</Button>
                      <Button variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                      <ButtonLink variant="link" href={`/dashboard/funnels/${courseId}/pages`}>Write the lesson itself</ButtonLink>
                    </div>
                    {experience === "pro" ? (
                      <details className="plx-more">
                        <summary>More options</summary>
                        <p className="plx-small" style={{ margin: "10px 0 6px" }}>Lesson id <code>{l.id}</code>. Unlock rules as stored:</p>
                        <pre className="plx-mono" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify(l.unlockRules ?? { mode: "ALL", conditions: [] }, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div style={{ padding: 20, borderTop: lessons.length ? "1px solid var(--plx-border)" : undefined, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Input fieldClassName="plx-grow" label="Add a lesson" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson 1: Getting started" style={{ minWidth: 200 }} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Select label="What is it?" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "VIDEO", label: "A video" }, { value: "DOCUMENT", label: "Something to read" }, { value: "IMAGE", label: "Pictures" }]} />
          <Button loading={busy} leftIcon={<Plus size={18} aria-hidden />} onClick={add}>Add lesson</Button>
        </div>
      </Card>
      <p className="plx-small">New lessons open after people finish the one before. Change that with the pencil.</p>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Delete "${deleting.title}"?` : ""} description="It disappears from your course. People who already finished it keep their other progress." footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Keep it</Button><Button variant="danger" loading={busy} onClick={remove}>Delete lesson</Button></>} />
    </>
  );
}
