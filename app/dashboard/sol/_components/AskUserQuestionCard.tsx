"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import type { AskUserAnswer, AskUserQuestionSpec, ToolUseBlock } from "./types";

function getQuestions(block: ToolUseBlock): AskUserQuestionSpec[] {
  const raw = (block.input as { questions?: AskUserQuestionSpec[] } | undefined)?.questions;
  return Array.isArray(raw) ? raw : [];
}

/**
 * The compact, read-only trace left in the message flow once a question has actually been
 * answered — the interactive form itself only ever exists as the floating
 * AskUserQuestionOverlay below, which unmounts the moment it's resolved. Collapsed to a
 * single small row by default (just "Answered N questions") — the full Q&A only renders
 * once "View answers" is clicked, since the actual answers already get folded into SOL's
 * own next reply anyway; this is a reference, not something that needs to stay visible.
 */
export function AskUserQuestionRecap({ block }: { block: ToolUseBlock }) {
  const questions = useMemo(() => getQuestions(block), [block]);
  const [expanded, setExpanded] = useState(false);
  if (questions.length === 0) return null;

  const structured = Array.isArray(block.result) ? (block.result as AskUserAnswer[]) : null;
  const asText = typeof block.result === "string" ? block.result : null;
  const count = structured?.length ?? questions.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: expanded ? "0.4rem" : 0,
        borderRadius: 10,
        border: "1px solid rgba(var(--brand-rgb),0.18)",
        background: "rgba(var(--brand-rgb),0.04)",
        padding: "0.5rem 0.85rem",
        maxWidth: 460,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.6rem",
          width: "100%",
          background: "none",
          border: "none",
          padding: expanded ? "0 0 0.1rem" : 0,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "rgba(240,242,255,0.6)" }}>
          Answered {count} {count === 1 ? "question" : "questions"}
        </span>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#c4b5fd" }}>{expanded ? "Hide" : "View answers"}</span>
      </button>
      {expanded &&
        (structured ? (
          structured.map((a, i) => (
            <div key={i} style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
              <span style={{ color: "rgba(240,242,255,0.45)" }}>{questions[i]?.header ?? "Q"}: </span>
              <span style={{ color: "#f0f2ff", fontWeight: 600 }}>{a.answer || "—"}</span>
            </div>
          ))
        ) : (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#f0f2ff", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{asText || "—"}</p>
        ))}
    </div>
  );
}

/**
 * The live, interactive step-through prompt for SOL's ask_user_question tool — a floating
 * panel over the chat (not a card inline in the message flow, which is where the previous
 * version of this lived), one question at a time: square checkboxes, a plain "Something
 * else" row that reveals free-text instead of a fixed set of options ever including it,
 * and a bottom bar with a live selection count and a single circular submit control. No
 * skip/close affordance anywhere — every question needs an actual answer (a picked option
 * or typed text) before you can move on, by design.
 *
 * Rendered exactly once, by SolChatView, whenever `pendingConfirmMessageId` names a message
 * whose pending tool_use is this tool — not per-block inside MessageBubble's normal content
 * map, since a floating panel has no natural place in that per-block flow.
 */
export function AskUserQuestionOverlay({
  block,
  onSubmit,
  busy,
}: {
  block: ToolUseBlock;
  onSubmit: (answers: AskUserAnswer[]) => void;
  busy?: boolean;
}) {
  const questions = useMemo(() => getQuestions(block), [block]);
  const panelRef = useRef<HTMLDivElement>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Array<Set<string>>>(() => questions.map(() => new Set<string>()));
  const [customTexts, setCustomTexts] = useState<string[]>(() => questions.map(() => ""));
  const [customOpen, setCustomOpen] = useState<boolean[]>(() => questions.map(() => false));
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    panelRef.current?.focus();
  }, [stepIndex]);

  if (questions.length === 0) return null;

  const current = questions[stepIndex];
  const rowCount = current.options.length + 1; // +1 for the "Something else" row
  const currentSelection = selections[stepIndex];
  const currentCustomText = customTexts[stepIndex];
  const isCustomOpen = customOpen[stepIndex];
  const hasAnswer = currentSelection.size > 0 || currentCustomText.trim().length > 0;
  const isLastStep = stepIndex === questions.length - 1;
  const busyNow = Boolean(busy);

  function updateAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, value: T) {
    setter((prev) => {
      const next = [...prev];
      next[stepIndex] = value;
      return next;
    });
  }

  function toggleOption(label: string) {
    const set = new Set(current.multiSelect ? currentSelection : []);
    if (current.multiSelect && currentSelection.has(label)) set.delete(label);
    else if (!current.multiSelect && currentSelection.has(label)) {
      // Re-picking the only selected option in a single-select question clears it.
    } else set.add(label);
    updateAt(setSelections, set);
    updateAt<string>(setCustomTexts, "");
    updateAt<boolean>(setCustomOpen, false);
  }

  function openCustom() {
    updateAt<boolean>(setCustomOpen, true);
    updateAt(setSelections, new Set<string>());
    setFocusIndex(rowCount - 1);
  }

  function setCustomText(value: string) {
    updateAt(setCustomTexts, value);
  }

  function resolvedAnswerFor(index: number): string {
    const custom = customTexts[index].trim();
    if (custom) return custom;
    return Array.from(selections[index]).join(", ");
  }

  function goNext() {
    if (!hasAnswer) return;
    if (isLastStep) {
      onSubmit(questions.map((q, i) => ({ question: q.question, answer: resolvedAnswerFor(i) })));
      return;
    }
    setStepIndex((i) => i + 1);
    setFocusIndex(0);
  }

  function goPrev() {
    if (stepIndex === 0) return;
    setStepIndex((i) => i - 1);
    setFocusIndex(0);
  }

  function activateRow(index: number) {
    if (index < current.options.length) toggleOption(current.options[index].label);
    else openCustom();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (busyNow) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        goNext();
      } else if (!isCustomOpen) {
        activateRow(focusIndex);
      }
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="SOL has a question"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "1rem",
        transform: "translateX(-50%)",
        zIndex: 50,
        // Matches the composer's own container width (see SolChatView: `maxWidth: 760`)
        // so the panel reads as belonging to the same input, not a narrower, separately-
        // sized popup floating above it.
        width: "min(760px, calc(100% - 2rem))",
        display: "flex",
        flexDirection: "column",
        borderRadius: 16,
        border: "1px solid rgba(var(--brand-rgb),0.25)",
        background: "#120a1c",
        boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.9rem 1.1rem 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: "rgba(var(--brand-rgb),0.14)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <HelpCircle size={12} color="#c4b5fd" />
          </span>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff" }}>SOL has a question</span>
        </div>
        {questions.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.15rem", flexShrink: 0 }}>
            <button
              type="button"
              onClick={goPrev}
              disabled={stepIndex === 0 || busyNow}
              aria-label="Previous question"
              style={{ display: "flex", background: "none", border: "none", padding: 3, color: stepIndex === 0 ? "rgba(240,242,255,0.2)" : "rgba(240,242,255,0.6)", cursor: stepIndex === 0 ? "default" : "pointer" }}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
              {stepIndex + 1} of {questions.length}
            </span>
            <button
              type="button"
              onClick={() => hasAnswer && setStepIndex((i) => Math.min(i + 1, questions.length - 1))}
              disabled={isLastStep || !hasAnswer || busyNow}
              aria-label="Next question"
              style={{ display: "flex", background: "none", border: "none", padding: 3, color: isLastStep || !hasAnswer ? "rgba(240,242,255,0.2)" : "rgba(240,242,255,0.6)", cursor: isLastStep || !hasAnswer ? "default" : "pointer" }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "0.7rem 1.1rem 0.25rem" }}>
        {current.header && (
          <span
            style={{
              display: "inline-block",
              fontSize: "0.64rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#c4b5fd",
              background: "rgba(var(--brand-rgb),0.12)",
              border: "1px solid rgba(var(--brand-rgb),0.25)",
              borderRadius: 999,
              padding: "0.15rem 0.55rem",
              marginBottom: "0.5rem",
            }}
          >
            {current.header}
          </span>
        )}
        <p style={{ margin: 0, fontSize: "0.92rem", fontWeight: 650, color: "#f5f5ff", lineHeight: 1.4 }}>{current.question}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "0.35rem 0.6rem" }}>
        {current.options.map((option, i) => {
          const selected = currentSelection.has(option.label);
          const focused = focusIndex === i;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setFocusIndex(i);
                toggleOption(option.label);
              }}
              onMouseEnter={() => setFocusIndex(i)}
              disabled={busyNow}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.6rem",
                width: "100%",
                textAlign: "left",
                padding: "0.55rem 0.5rem",
                borderRadius: 8,
                border: "none",
                background: focused ? "rgba(255,255,255,0.05)" : "transparent",
                color: "#f0f2ff",
                cursor: busyNow ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {/* Square + checkmark for a multiSelect question (picking one doesn't rule
                  out another); round + filled dot for a single-select one (a real radio
                  button, since picking a new option replaces the old choice) — the shape
                  itself is what tells you how the question actually behaves, not just
                  decoration. */}
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: current.multiSelect ? 4 : 999,
                  marginTop: 1,
                  border: current.multiSelect
                    ? selected
                      ? "none"
                      : "1.5px solid rgba(240,242,255,0.3)"
                    : `1.5px solid ${selected ? "var(--brand)" : "rgba(240,242,255,0.3)"}`,
                  background: current.multiSelect && selected ? "linear-gradient(135deg,var(--brand),var(--brand-deeper))" : "transparent",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {selected && current.multiSelect && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {selected && !current.multiSelect && (
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: "linear-gradient(135deg,var(--brand),var(--brand-deeper))" }} />
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0 }}>
                <span style={{ fontSize: "0.83rem", fontWeight: 500 }}>{option.label}</span>
                {option.description && <span style={{ fontSize: "0.74rem", color: "rgba(240,242,255,0.45)" }}>{option.description}</span>}
              </span>
            </button>
          );
        })}

        {isCustomOpen ? (
          <input
            autoFocus
            value={currentCustomText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={busyNow}
            placeholder="Type your own answer…"
            style={{
              margin: "0.15rem 0.5rem",
              padding: "0.5rem 0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(var(--brand-rgb),0.4)",
              background: "rgba(255,255,255,0.03)",
              color: "#f0f2ff",
              fontSize: "0.83rem",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={openCustom}
            onMouseEnter={() => setFocusIndex(current.options.length)}
            disabled={busyNow}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              textAlign: "left",
              padding: "0.55rem 0.5rem",
              borderRadius: 8,
              border: "none",
              background: focusIndex === current.options.length ? "rgba(255,255,255,0.04)" : "transparent",
              color: "rgba(240,242,255,0.4)",
              fontSize: "0.83rem",
              cursor: busyNow ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              paddingLeft: "2.15rem",
            }}
          >
            Something else…
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 1.1rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: "0.74rem", color: "rgba(240,242,255,0.4)" }}>
          {currentCustomText.trim() ? "Custom answer" : `${currentSelection.size} selected`}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!hasAnswer || busyNow}
          aria-label={isLastStep ? "Submit answers" : "Next question"}
          style={{
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: 999,
            border: "none",
            background: hasAnswer ? "linear-gradient(135deg,var(--brand),var(--brand-deeper))" : "rgba(255,255,255,0.06)",
            color: hasAnswer ? "#fff" : "rgba(240,242,255,0.3)",
            cursor: !hasAnswer || busyNow ? "not-allowed" : "pointer",
            opacity: busyNow ? 0.7 : 1,
          }}
        >
          <ArrowRight size={15} />
        </button>
      </div>

      <p style={{ margin: 0, padding: "0 1.1rem 0.7rem", fontSize: "0.66rem", color: "rgba(240,242,255,0.28)", textAlign: "center" }}>
        &uarr;&darr; to navigate &middot; Enter to select &middot; &#8984; Enter to submit
      </p>
    </div>
  );
}
