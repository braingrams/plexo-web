"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, CircleX, FileText, LoaderCircle, TriangleAlert } from "lucide-react";
import type { AskUserAnswer, AskUserQuestionSpec, ToolUseBlock } from "../../sol/_components/types";
import { Button } from "../ui/Button";
import { friendlyStep } from "./logic";

function pretty(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type State = "running" | "success" | "error" | "cancelled";
const stateOf = (s: ToolUseBlock["status"]): State => (s === "success" ? "success" : s === "error" ? "error" : s === "cancelled" ? "cancelled" : "running");

/**
 * One thing SOL did, in plain words: a quiet spinner while it runs, a check when it's done, and
 * the details one tap away. Actions that need a yes get a clear confirmation card instead.
 */
export function Step({ block, onConfirm, confirmBusy, resolvingConfirmation }: { block: ToolUseBlock; onConfirm?: (decision: "confirmed" | "declined") => void; confirmBusy?: boolean; resolvingConfirmation?: boolean }) {
  const [open, setOpen] = useState(false);

  if (block.status === "awaiting_confirmation") {
    const busy = confirmBusy || resolvingConfirmation;
    return (
      <div className="sol3-card sol3-confirm" role="group" aria-label="SOL needs your OK">
        <div className="sol3-confirm__head">
          <span className="sol3-confirm__ico">
            <TriangleAlert size={20} aria-hidden />
          </span>
          <div>
            <h4>{friendlyStep(block.name, "doing")}?</h4>
            <p>SOL is waiting for your OK before it goes ahead. It can&apos;t always be undone.</p>
          </div>
        </div>
        {onConfirm ? (
          <div className="sol3-actions">
            <Button loading={busy} loadingLabel={resolvingConfirmation ? "Getting ready" : "Confirming"} onClick={() => onConfirm("confirmed")}>
              Yes, go ahead
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onConfirm("declined")}>
              No, cancel
            </Button>
          </div>
        ) : null}
        <button type="button" className="sol3-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={16} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }} />
          {open ? "Hide what it will do" : "See what it will do"}
        </button>
        {open ? <Detail block={block} /> : null}
      </div>
    );
  }

  const state = stateOf(block.status);
  const label =
    block.status === "preparing"
      ? `${friendlyStep(block.name, "doing")}…`
      : state === "running"
        ? `${friendlyStep(block.name, "doing")}…`
        : state === "error"
          ? `${friendlyStep(block.name, "doing")} didn't work`
          : state === "cancelled"
            ? `${friendlyStep(block.name, "doing")} (cancelled)`
            : friendlyStep(block.name, "done");
  return (
    <div className="sol3-step" data-state={state} data-open={open}>
      <button type="button" className="sol3-step__row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="sol3-step__ico" aria-hidden>
          {state === "running" ? <LoaderCircle size={17} className="plx-spin" /> : state === "success" ? <Check size={18} strokeWidth={2.6} /> : <CircleX size={18} />}
        </span>
        <span className="sol3-step__text">{label}</span>
        <ChevronDown size={16} className="sol3-step__chev" aria-hidden />
      </button>
      {open ? <Detail block={block} /> : null}
    </div>
  );
}

/**
 * A run of steps as one quiet list. While SOL is working every step shows; once they are all done
 * (three or more) they fold into one line ("Finished 4 steps") that opens on a tap.
 */
export function StepList({ blocks }: { blocks: ToolUseBlock[] }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const settled = blocks.length >= 3 && blocks.every((b) => b.status === "success");
  const expanded = open ?? !settled;
  const steps = (
    <div className="sol3-steps">
      {blocks.map((b, i) => (
        <Step key={b.id || i} block={b} />
      ))}
    </div>
  );
  if (!settled) return steps;
  return (
    <div className="sol3-steps-group" data-open={expanded}>
      <button type="button" className="sol3-steps-group__btn" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <span className="sol3-step__ico" aria-hidden><Check size={18} strokeWidth={2.6} /></span>
        <span className="sol3-step__text">Finished {blocks.length} steps</span>
        <ChevronDown size={16} className="sol3-step__chev" aria-hidden />
      </button>
      {expanded ? steps : null}
    </div>
  );
}

function Detail({ block }: { block: ToolUseBlock }) {
  return (
    <div className="sol3-step__detail">
      <div>
        <h5>What SOL asked for</h5>
        <pre>{pretty(block.input)}</pre>
      </div>
      {block.result !== undefined ? (
        <div>
          <h5>What came back</h5>
          <pre>{pretty(block.result)}</pre>
        </div>
      ) : null}
    </div>
  );
}

/** A finished question, folded away to one quiet line. */
export function AnswerRecap({ block }: { block: ToolUseBlock }) {
  const questions = useMemo(() => {
    const raw = (block.input as { questions?: AskUserQuestionSpec[] } | undefined)?.questions;
    return Array.isArray(raw) ? raw : [];
  }, [block]);
  const [open, setOpen] = useState(false);
  if (questions.length === 0) return null;
  const structured = Array.isArray(block.result) ? (block.result as AskUserAnswer[]) : null;
  const asText = typeof block.result === "string" ? block.result : null;
  const count = structured?.length ?? questions.length;
  return (
    <div className="sol3-recap">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <FileText size={16} aria-hidden /> You answered {count} {count === 1 ? "question" : "questions"}
        </span>
        <span style={{ color: "var(--plx-link)" }}>{open ? "Hide" : "View"}</span>
      </button>
      {open
        ? structured
          ? structured.map((a, i) => (
              <p key={i} className="sol3-recap__a" style={{ margin: 0 }}>
                <span>{questions[i]?.header ?? "Question"}: </span>
                <b>{a.answer || "—"}</b>
              </p>
            ))
          : <p className="sol3-recap__a" style={{ margin: 0 }}>{asText || "—"}</p>
        : null}
    </div>
  );
}
