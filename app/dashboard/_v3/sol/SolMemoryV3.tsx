"use client";

import { useState } from "react";
import { ArrowLeft, Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SolMemoryItem } from "../../sol/memory/page";
import { AsideCard, AsideStats, Notice, Panel, SettingsPageShell } from "../settings/bits";
import { Badge, Button, ButtonLink, EmptyState, Input, Modal } from "../ui";
import "./sol.css";

const byNewest = (a: SolMemoryItem, b: SolMemoryItem) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

async function failure(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(payload?.error ?? fallback);
}

/** What SOL remembers, in the new look: add, edit, remove. Same memory API as the classic page. */
export function SolMemoryV3({ initialMemories }: { initialMemories: SolMemoryItem[] }) {
  const [memories, setMemories] = useState(initialMemories);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function add() {
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/sol/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, category: "PREFERENCE" }) });
      if (!response.ok) throw await failure(response, "We couldn't save that. Please try again.");
      const payload = (await response.json()) as { memory: SolMemoryItem };
      setMemories((m) => [payload.memory, ...m]);
      setNewText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sol/memories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw await failure(response, "We couldn't save that change. Please try again.");
      setMemories((m) => m.map((x) => (x.id === id ? { ...x, text } : x)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that change. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    const removed = memories.find((m) => m.id === id);
    setBusyId(id);
    setError(null);
    setMemories((m) => m.filter((x) => x.id !== id));
    try {
      const response = await fetch(`/api/v1/sol/memories/${id}`, { method: "DELETE" });
      if (!response.ok) throw await failure(response, "We couldn't remove that. Please try again.");
    } catch (err) {
      if (removed) setMemories((m) => [...m, removed].sort(byNewest));
      setError(err instanceof Error ? err.message : "We couldn't remove that. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function clearAll() {
    if (!memories.length || clearing) return;
    setClearing(true);
    setError(null);
    const targets = memories;
    const results = await Promise.allSettled(targets.map((m) => fetch(`/api/v1/sol/memories/${m.id}`, { method: "DELETE" })));
    const failed = new Set(targets.filter((_, i) => { const r = results[i]; return r.status === "rejected" || !r.value.ok; }).map((m) => m.id));
    setMemories((m) => m.filter((x) => failed.has(x.id)));
    if (failed.size) setError(`${failed.size} ${failed.size === 1 ? "thing" : "things"} couldn't be removed. Please try again.`);
    setClearing(false);
    setConfirmAll(false);
  }

  const mine = memories.filter((m) => m.source === "USER_ADDED").length;
  const count = memories.length;

  return (
    <div className="sol3-sub">
      <SettingsPageShell
        title="What SOL remembers"
        purpose="Things SOL keeps in mind every time you chat, like your business name or how you like things written."
        action={
          <ButtonLink href="/dashboard/sol" variant="secondary" leftIcon={<ArrowLeft size={17} aria-hidden />}>
            Back to chats
          </ButtonLink>
        }
        aside={
          <>
            <AsideCard title="Your memory" icon={Brain}>
              <AsideStats items={[{ label: count === 1 ? "thing remembered" : "things remembered", value: count }, { label: "added by you", value: mine }, { label: "noticed by SOL", value: count - mine }]} />
              <p>SOL also notices lasting preferences while you chat. You can change or remove anything here, any time.</p>
              <ButtonLink href="/dashboard/sol/settings" variant="secondary" size="sm">
                Turn memory off
              </ButtonLink>
            </AsideCard>
          </>
        }
      >
        {error ? <Notice tone="bad">{error}</Notice> : null}

        <Panel title="Add something SOL should remember" description="Write it the way you'd tell a person.">
          <form
            className="sol3-memadd"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input label="Something to remember" hideLabel fieldClassName="sol3-memadd__field" value={newText} maxLength={500} placeholder="For example: My shop is called Ama's Bakery." onChange={(e) => setNewText(e.target.value)} />
            <Button type="submit" leftIcon={<Plus size={18} aria-hidden />} loading={adding} disabled={!newText.trim()}>
              Remember this
            </Button>
          </form>
        </Panel>

        {count === 0 ? (
          <Panel>
            <EmptyState
              compact
              title="SOL hasn't remembered anything yet"
              body="Memory is how SOL gets to know you. Tell it once, like your business name, who your customers are or how you like things written, and it keeps that in mind in every chat so you never repeat yourself. Add your first one above, or just mention it in a chat and SOL will notice."
            />
          </Panel>
        ) : (
          <Panel flush title="Remembered" description="Tap the pencil to change something, or the bin to remove it." action={<Button variant="ghost" size="sm" onClick={() => setConfirmAll(true)}>Remove all</Button>}>
            <ul className="sol3-mems">
              {memories.map((m) => (
                <li key={m.id} className="sol3-mem" data-busy={busyId === m.id || undefined}>
                  {editingId === m.id ? (
                    <form
                      className="sol3-mem__edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(m.id);
                      }}
                    >
                      <Input label="Change this memory" hideLabel fieldClassName="sol3-memadd__field" autoFocus value={editText} maxLength={500} onChange={(e) => setEditText(e.target.value)} />
                      <Button type="submit" size="sm" iconOnly aria-label="Save change" loading={busyId === m.id} disabled={!editText.trim()}>
                        <Check size={18} aria-hidden />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" iconOnly aria-label="Cancel" onClick={() => setEditingId(null)}>
                        <X size={18} aria-hidden />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="sol3-mem__text">
                        <span>{m.text}</span>
                        <Badge tone={m.source === "USER_ADDED" ? "brand" : "neutral"}>{m.source === "USER_ADDED" ? "You added" : "SOL noticed"}</Badge>
                      </div>
                      <div className="sol3-mem__acts">
                        <button type="button" className="plx-iconbtn" aria-label="Change this memory" title="Change" onClick={() => { setEditingId(m.id); setEditText(m.text); }}>
                          <Pencil size={18} aria-hidden />
                        </button>
                        <button type="button" className="plx-iconbtn" aria-label="Remove this memory" title="Remove" onClick={() => void remove(m.id)}>
                          <Trash2 size={18} aria-hidden />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </SettingsPageShell>

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Remove everything SOL remembers?"
        description={`SOL will forget all ${count} ${count === 1 ? "thing" : "things"} about you. This can't be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>Keep them</Button>
            <Button variant="danger" loading={clearing} onClick={() => void clearAll()}>Remove all</Button>
          </>
        }
      />
    </div>
  );
}
