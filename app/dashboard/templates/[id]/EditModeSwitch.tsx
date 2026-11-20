"use client";

import { useRef } from "react";
import { Code2, LayoutTemplate, Type } from "lucide-react";
import { VIEW_LABELS, type EditorViewName } from "@/lib/editorModes/switchCheck";

const OPTIONS: { value: EditorViewName; icon: React.ReactNode; hint: string }[] = [
  { value: "design", icon: <LayoutTemplate size={15} aria-hidden />, hint: "See your page as visitors will" },
  { value: "code", icon: <Code2 size={15} aria-hidden />, hint: "Change the page itself, with a live preview beside it" },
  { value: "text", icon: <Type size={15} aria-hidden />, hint: "Change the words, pictures and colours, no code" },
];

/**
 * Design | Code | Text: three ways to work on the same page. Switching keeps everything (the editor saves first if
 * needed, and says so up front if the other view can't change some part of the page).
 */
export function EditModeSwitch({ value, onChange, disabled, hints }: { value: EditorViewName; onChange: (v: EditorViewName) => void; disabled?: boolean; /** Replaces the hover text of a view (the block editor explains that Code and Text turn the page into code first). */ hints?: Partial<Record<EditorViewName, string>> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const n = OPTIONS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(OPTIONS[to].value);
    refs.current[to]?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label="How you want to edit this page"
      style={{ display: "inline-flex", padding: 3, gap: 2, borderRadius: 11, background: "var(--ed-w-050)", border: "1px solid var(--ed-w-100)", flexShrink: 0 }}
    >
      {OPTIONS.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            title={hints?.[o.value] ?? o.hint}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.38rem 0.85rem", borderRadius: 8, border: "none",
              fontSize: "0.8rem", fontWeight: 700, whiteSpace: "nowrap", cursor: disabled ? "default" : "pointer",
              background: active ? "var(--ed-cta)" : "transparent",
              color: active ? "var(--ed-on-brand)" : "var(--ed-t-600)",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {o.icon}
            {VIEW_LABELS[o.value]}
          </button>
        );
      })}
    </div>
  );
}
