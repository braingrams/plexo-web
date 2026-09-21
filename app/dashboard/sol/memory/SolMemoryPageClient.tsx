"use client";

import { useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";

import { SolSubpageHeader } from "../_components/SolSubpageHeader";
import type { SolMemoryItem, SolMemoryCategory, SolMemorySource } from "./page";

const CATEGORY_LABELS: Record<SolMemoryCategory, string> = {
  PREFERENCE: "Preference",
  FACT: "Fact",
  TONE: "Tone",
};

function SourceBadge({ source }: { source: SolMemorySource }) {
  const isUser = source === "USER_ADDED";
  return (
    <span
      style={{
        fontSize: "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "0.18rem 0.45rem",
        borderRadius: 6,
        flexShrink: 0,
        color: isUser ? "#e9d5ff" : "rgba(240,242,255,0.5)",
        background: isUser ? "rgba(var(--brand-rgb),0.16)" : "rgba(255,255,255,0.06)",
      }}
    >
      {isUser ? "Added by you" : "Learned by Sol"}
    </span>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: "0.7rem 1rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", minWidth: 120 }}>
      <p style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, fontFamily: "var(--font-heading), sans-serif", color: "#f3f0fa" }}>{value}</p>
      <p style={{ margin: "0.1rem 0 0", fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>{label}</p>
    </div>
  );
}

export function SolMemoryPageClient({ initialMemories }: { initialMemories: SolMemoryItem[] }) {
  const [memories, setMemories] = useState<SolMemoryItem[]>(initialMemories);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [clearingAll, setClearingAll] = useState(false);

  async function handleAdd() {
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/sol/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, category: "PREFERENCE" }),
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? "Unable to add that memory.");
      }
      const payload = (await response.json()) as { memory: SolMemoryItem };
      setMemories((current) => [payload.memory, ...current]);
      setNewText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add that memory.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    const removed = memories.find((m) => m.id === id) ?? null;
    setDeletingIds((current) => new Set(current).add(id));
    setMemories((current) => current.filter((m) => m.id !== id));
    setError(null);
    try {
      const response = await fetch(`/api/v1/sol/memories/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? "Unable to delete that memory.");
      }
    } catch (err) {
      if (removed) setMemories((current) => [...current, removed].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      setError(err instanceof Error ? err.message : "Unable to delete that memory.");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleClearAll() {
    if (memories.length === 0 || clearingAll) return;
    if (!window.confirm(`Delete all ${memories.length} memor${memories.length === 1 ? "y" : "ies"} Sol has stored about you? This can't be undone.`)) return;
    setClearingAll(true);
    setError(null);
    const targets = memories;
    const results = await Promise.allSettled(targets.map((m) => fetch(`/api/v1/sol/memories/${m.id}`, { method: "DELETE" })));
    const failedIds = new Set(
      targets.filter((_, i) => {
        const result = results[i];
        return result.status === "rejected" || !result.value.ok;
      }).map((m) => m.id),
    );
    setMemories((current) => current.filter((m) => failedIds.has(m.id)));
    if (failedIds.size > 0) setError(`${failedIds.size} memor${failedIds.size === 1 ? "y" : "ies"} couldn't be deleted — try again.`);
    setClearingAll(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <SolSubpageHeader title="Memory" subtitle={`${memories.length} thing${memories.length === 1 ? "" : "s"} remembered`} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "2.5rem 2rem 3.5rem" }}>
          <div style={{ marginBottom: "1.75rem" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: "1.6rem", fontWeight: 700, color: "#f3f0fa" }}>
              What Sol remembers
            </h1>
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.88rem", color: "rgba(240,242,255,0.45)", maxWidth: 560 }}>
              Facts and preferences Sol carries into every new conversation — add your own, or let Sol notice them on its own.
            </p>
          </div>

          {memories.length > 0 && (
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.75rem", flexWrap: "wrap" }}>
              <StatChip label="Total remembered" value={memories.length} />
              <StatChip label="Added by you" value={memories.filter((m) => m.source === "USER_ADDED").length} />
              <StatChip label="Learned by Sol" value={memories.filter((m) => m.source === "LLM_EXTRACTED").length} />
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
            <input
              type="text"
              value={newText}
              maxLength={500}
              placeholder="Sol should always remember: …"
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "0.7rem 0.9rem",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(240,242,255,0.9)",
                fontFamily: "inherit",
                fontSize: "0.875rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              disabled={!newText.trim() || adding}
              onClick={() => void handleAdd()}
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.7rem 1.1rem",
                borderRadius: 10,
                border: "none",
                background: !newText.trim() || adding ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: !newText.trim() || adding ? "rgba(240,242,255,0.3)" : "#fff",
                fontSize: "0.83rem",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: !newText.trim() || adding ? "not-allowed" : "pointer",
              }}
            >
              <Plus size={15} />
              {adding ? "Adding…" : "Add"}
            </button>
          </div>

          {error && <p style={{ fontSize: "0.78rem", color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

          {memories.length === 0 ? (
            <div
              style={{
                padding: "2.5rem 1.5rem",
                borderRadius: 16,
                background: "rgba(255,255,255,0.02)",
                border: "1px dashed rgba(255,255,255,0.1)",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <Brain size={22} color="rgba(240,242,255,0.25)" style={{ marginBottom: "0.6rem" }} />
              <p style={{ margin: 0, fontSize: "0.85rem", color: "rgba(240,242,255,0.4)" }}>Sol hasn&apos;t remembered anything about you yet.</p>
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.76rem", color: "rgba(240,242,255,0.28)" }}>
                Add something above, or just mention it in a conversation — Sol notices durable preferences on its own.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem", marginBottom: "1.75rem" }}>
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.6rem",
                      padding: "1rem 1.1rem",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      opacity: deletingIds.has(memory.id) ? 0.5 : 1,
                      transition: "opacity 0.15s, border-color 0.15s",
                    }}
                    className="sol-memory-card"
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", minWidth: 0 }}>
                        <SourceBadge source={memory.source} />
                        <span style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.3)" }}>{CATEGORY_LABELS[memory.category]}</span>
                      </div>
                      <button
                        type="button"
                        aria-label="Delete memory"
                        disabled={deletingIds.has(memory.id)}
                        onClick={() => void handleDelete(memory.id)}
                        style={{
                          flexShrink: 0,
                          width: 24,
                          height: 24,
                          display: "grid",
                          placeItems: "center",
                          background: "none",
                          border: "none",
                          color: "rgba(248,113,113,0.65)",
                          cursor: deletingIds.has(memory.id) ? "not-allowed" : "pointer",
                          borderRadius: 6,
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "rgba(240,242,255,0.85)", lineHeight: 1.5, wordBreak: "break-word" }}>{memory.text}</p>
                  </div>
                ))}
              </div>
              <style>{`.sol-memory-card:hover { border-color: rgba(var(--brand-rgb),0.25); }`}</style>

              <button
                type="button"
                disabled={clearingAll}
                onClick={() => void handleClearAll()}
                style={{
                  padding: "0.55rem 0.95rem",
                  borderRadius: 9,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)",
                  color: "#f87171",
                  fontSize: "0.79rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: clearingAll ? "not-allowed" : "pointer",
                  opacity: clearingAll ? 0.5 : 1,
                }}
              >
                {clearingAll ? "Clearing…" : "Clear all memories"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
