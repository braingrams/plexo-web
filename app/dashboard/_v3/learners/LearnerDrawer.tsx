"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, Lock, Mail, UserCheck, UserMinus, X } from "lucide-react";
import { Avatar, Badge, Button, Portal, ProgressBar, Skeleton } from "../ui";
import { hubApi } from "../hub/hubApi";
import { displayName, lastActiveLabel, learnerState, progressPercent, type LearnerRow } from "@/lib/dashboardV3/learners";
import { lessonStates, type LessonLite, type LessonProgressState, type ProgressRow } from "@/lib/dashboardV3/lessonRules";
import { StatePills } from "./LearnersView";

const STEP_ICON: Record<LessonProgressState, React.ReactNode> = {
  done: <Check size={16} aria-hidden />,
  open: <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />,
  waiting: <Clock size={15} aria-hidden />,
  locked: <Lock size={14} aria-hidden />,
};
const STEP_TEXT: Record<LessonProgressState, string> = { done: "Finished", open: "Can open", waiting: "Needs your OK", locked: "Not open yet" };

/** One learner: where they are in every lesson, and the things you can do for them. */
export function LearnerDrawer({ courseId, row, lessons, onClose, onResend, onApprove, onRemove, onRestore, previewProgress }: {
  courseId: string;
  row: LearnerRow;
  lessons: LessonLite[];
  onClose: () => void;
  onResend: (r: LearnerRow) => void;
  onApprove: (r: LearnerRow) => void;
  onRemove: (r: LearnerRow) => void;
  onRestore: (r: LearnerRow) => void;
  /** Dev preview only: skip the network and use this. */
  previewProgress?: ProgressRow[];
}) {
  const [progress, setProgress] = useState<ProgressRow[] | null>(previewProgress ?? null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previewProgress) return;
    let off = false;
    setProgress(null);
    hubApi<{ progress: ProgressRow[] }>(`/api/v1/lms/funnels/${courseId}/enrollments/${encodeURIComponent(row.email)}`)
      .then((r) => !off && setProgress(r.progress))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [courseId, row.email, row.waitingLessonId, previewProgress]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  const total = lessons.length;
  const state = learnerState(row, total);
  const steps = progress ? lessonStates(lessons, row.enrolledAt, progress) : null;
  const name = displayName(row);

  return (
    <Portal>
      <div className="plx-drawer-ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="plx-drawer" role="dialog" aria-modal="true" aria-label={`${name}, progress`} tabIndex={-1}>
          <div className="plx-drawer__head">
            <Avatar name={name} size={48} />
            <div>
              <h2>{name}</h2>
              <p>{row.email}</p>
              <div style={{ marginTop: 8 }}><StatePills row={row} total={total} /></div>
            </div>
            <button type="button" className="plx-iconbtn" onClick={onClose} aria-label="Close"><X size={20} aria-hidden /></button>
          </div>
          <div className="plx-drawer__body">
            <ProgressBar value={row.completedPageCount} max={Math.max(1, total)} label={`${Math.min(row.completedPageCount, total)} of ${total} lessons finished (${progressPercent(row.completedPageCount, total)}%)`} />
            <div className="plx-lfacts">
              <div><b>{new Date(row.enrolledAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</b><span>Signed up</span></div>
              <div><b>{lastActiveLabel(row.lastActiveAt)}</b><span>Last active</span></div>
              <div><b>{row.paymentStatus === "PAID" ? "Paid" : row.paymentStatus === "REFUNDED" ? "Refunded" : "Free"}</b><span>How they joined</span></div>
            </div>
            <div>
              <h3 className="plx-h3" style={{ marginBottom: 6 }}>Lesson by lesson</h3>
              {failed ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">We couldn&apos;t load their lessons. Close this and try again.</div> : null}
              {!steps && !failed ? <div style={{ display: "grid", gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 36 }} />)}</div> : null}
              {steps && steps.length === 0 ? <p className="plx-small">This course has no lessons yet.</p> : null}
              {steps ? (
                <ol className="plx-steps-l">
                  {steps.map(({ lesson, state: s, doneAt }, i) => (
                    <li key={lesson.id} data-state={s}>
                      <span className="plx-steps-l__dot">{STEP_ICON[s]}</span>
                      <span className="plx-steps-l__t">{i + 1}. {lesson.title}</span>
                      <span className="plx-steps-l__s">{s === "done" && doneAt ? `Done ${new Date(doneAt).toLocaleDateString("en", { day: "numeric", month: "short" })}` : STEP_TEXT[s]}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            {state === "waiting" ? <div className="plx-inlinemsg plx-inlinemsg--warn">They finished everything before this lesson and are waiting for you to let them in.</div> : null}
          </div>
          <div className="plx-drawer__foot">
            {state === "waiting" ? <Button leftIcon={<UserCheck size={18} aria-hidden />} onClick={() => onApprove(row)}>Let them in</Button> : null}
            {state !== "removed" ? <Button variant="secondary" leftIcon={<Mail size={18} aria-hidden />} onClick={() => onResend(row)}>Send access link again</Button> : null}
            {state === "removed" ? (
              <Button onClick={() => onRestore(row)}>Let them back in</Button>
            ) : (
              <Button variant="ghost" leftIcon={<UserMinus size={18} aria-hidden />} onClick={() => onRemove(row)}>Remove from course</Button>
            )}
            {state === "removed" ? <Badge tone="warning">Removed</Badge> : null}
          </div>
        </div>
      </div>
    </Portal>
  );
}
