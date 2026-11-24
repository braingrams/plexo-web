"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, PencilLine } from "lucide-react";
import type { AskUserAnswer, AskUserQuestionSpec, ToolUseBlock } from "../../sol/_components/types";
import { SKIP_ANSWER } from "@/lib/ai/solBrief";
import { Button } from "../ui/Button";

function questionsOf(block: ToolUseBlock): AskUserQuestionSpec[] {
  const raw = (block.input as { questions?: AskUserQuestionSpec[] } | undefined)?.questions;
  return Array.isArray(raw) ? raw : [];
}

/**
 * SOL asking you something: one question at a time, with big tappable choices (and "Something
 * else" for your own words). Arrow keys + Enter work too. Every question needs an answer, or
 * "Skip, you choose" (SOL decides that one). With several questions, "Just build it" skips the
 * rest and lets SOL decide.
 */
/**
 * `docked`: the card sits in its own space under the message list (SOL Studio): its choices scroll inside it and the
 * buttons are a fixed row at its bottom, so Next / Send is always visible however many choices or lines of text there are.
 */
export function AskCard({ block, onSubmit, busy, docked }: { block: ToolUseBlock; onSubmit: (answers: AskUserAnswer[]) => void; busy?: boolean; docked?: boolean }) {
  const questions = useMemo(() => questionsOf(block), [block]);
  const ref = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Array<Set<string>>>(() => questions.map(() => new Set<string>()));
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ""));
  const [customOpen, setCustomOpen] = useState<boolean[]>(() => questions.map(() => false));
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step]);

  // Opening "Something else" grows the card: bring the text box fully into view, clear of the pinned buttons.
  const customShown = !!customOpen[step];
  useEffect(() => {
    if (!customShown) return;
    // After the browser's own focus-scroll has settled, so this one has the last word.
    const id = window.setTimeout(() => areaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
    return () => window.clearTimeout(id);
  }, [customShown, step]);

  if (questions.length === 0) return null;
  const q = questions[step];
  const rows = q.options.length + 1;
  const sel = picked[step];
  const hasAnswer = sel.size > 0 || custom[step].trim().length > 0;
  const last = step === questions.length - 1;

  const put = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, value: T) =>
    setter((prev) => {
      const next = [...prev];
      next[step] = value;
      return next;
    });

  function toggle(label: string) {
    const set = new Set(q.multiSelect ? sel : []);
    if (q.multiSelect && sel.has(label)) set.delete(label);
    else if (!q.multiSelect && sel.has(label)) {
      // picking the only chosen choice again clears it
    } else set.add(label);
    put(setPicked, set);
    put<string>(setCustom, "");
    put<boolean>(setCustomOpen, false);
  }
  function openCustom() {
    put<boolean>(setCustomOpen, true);
    put(setPicked, new Set<string>());
    setFocus(rows - 1);
  }
  const answerFor = (i: number) => custom[i].trim() || Array.from(picked[i]).join(", ") || SKIP_ANSWER;

  function next() {
    if (!hasAnswer || busy) return;
    if (last) return onSubmit(questions.map((qq, i) => ({ question: qq.question, answer: answerFor(i) })));
    setStep((s) => s + 1);
    setFocus(0);
  }
  // "Skip, you choose": this question is SOL's call; clears anything half-typed so the answer is unambiguous.
  function skip() {
    if (busy) return;
    put(setPicked, new Set<string>());
    put<string>(setCustom, "");
    if (last) return onSubmit(questions.map((qq, i) => ({ question: qq.question, answer: i === step ? SKIP_ANSWER : answerFor(i) })));
    setStep((s) => s + 1);
    setFocus(0);
  }
  // "Just build it": keep what was answered so far, SOL decides the rest.
  function justBuild() {
    if (busy) return;
    onSubmit(questions.map((qq, i) => ({ question: qq.question, answer: i < step || (i === step && hasAnswer) ? answerFor(i) : SKIP_ANSWER })));
  }
  function back() {
    if (step === 0) return;
    setStep((s) => s - 1);
    setFocus(0);
  }
  function onKey(e: React.KeyboardEvent) {
    if (busy || (e.target as HTMLElement).tagName === "TEXTAREA") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) next();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setFocus((i) => Math.min(i + 1, rows - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocus((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) next();
      else if (focus < q.options.length) toggle(q.options[focus].label);
      else openCustom();
    }
  }

  return (
    <div className={docked ? "sol3-card sol3-ask sol3-ask--docked" : "sol3-card sol3-ask"} ref={ref} tabIndex={-1} onKeyDown={onKey} role="group" aria-label="A question from SOL">
      <div className="sol3-ask__body">
        <div className="sol3-ask__top">
          <span className="sol3-ask__eyebrow">{q.header || "A quick question"}</span>
          {questions.length > 1 ? (
            <span className="sol3-ask__progress">
              <span className="sol3-ask__count">Question {step + 1} of {questions.length}</span>
              <span className="sol3-ask__dots" aria-hidden>
                {questions.map((_, i) => (
                  <i key={i} data-on={i <= step} />
                ))}
              </span>
            </span>
          ) : null}
        </div>
        <h4>{q.question}</h4>
        {q.multiSelect ? <p className="sol3-ask__hint">Pick as many as you like.</p> : null}
        <div className="sol3-opts" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
          {q.options.map((o, i) => (
            <button key={o.label} type="button" role={q.multiSelect ? "checkbox" : "radio"} aria-checked={sel.has(o.label)} data-multi={!!q.multiSelect} data-focus={focus === i} disabled={busy} className="sol3-opt" onClick={() => { setFocus(i); toggle(o.label); }}>
              <span className="sol3-opt__mark">{sel.has(o.label) ? <Check size={15} strokeWidth={3} aria-hidden /> : null}</span>
              <span>
                <span className="sol3-opt__label">{o.label}</span>
                {o.description ? <span className="sol3-opt__desc">{o.description}</span> : null}
              </span>
            </button>
          ))}
          <button type="button" role={q.multiSelect ? "checkbox" : "radio"} aria-checked={customOpen[step]} data-multi={!!q.multiSelect} data-focus={focus === rows - 1} disabled={busy} className="sol3-opt" onClick={openCustom}>
            <span className="sol3-opt__mark">{customOpen[step] ? <Check size={15} strokeWidth={3} aria-hidden /> : null}</span>
            <span className="sol3-opt__label" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <PencilLine size={17} aria-hidden /> Something else
            </span>
          </button>
        </div>
        {customOpen[step] ? <textarea ref={areaRef} autoFocus aria-label="Your own answer" placeholder="Type your answer…" value={custom[step]} onChange={(e) => put<string>(setCustom, e.target.value)} disabled={busy} /> : null}
      </div>
      <div className="sol3-ask__foot">
        <span className="sol3-ask__aside">
          {step > 0 ? (
            <Button variant="ghost" leftIcon={<ChevronLeft size={18} aria-hidden />} onClick={back} disabled={busy}>
              Back
            </Button>
          ) : null}
          <Button variant="ghost" onClick={skip} disabled={busy}>
            Skip, you choose
          </Button>
          {questions.length > 1 && !last ? (
            <Button variant="ghost" onClick={justBuild} disabled={busy}>
              Just build it
            </Button>
          ) : null}
        </span>
        <Button disabled={!hasAnswer} loading={busy} rightIcon={last ? undefined : <ArrowRight size={18} aria-hidden />} onClick={next}>
          {last ? "Send my answers" : "Next"}
        </Button>
      </div>
    </div>
  );
}
