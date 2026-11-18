"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MousePointer2, Pause, Play, PlayCircle, X } from "lucide-react";
import { guideFor, type GuideStep } from "@/lib/dashboardV3/helpGuides";
import { Button } from "./Button";
import { Modal } from "./Modal";

const isVideo = (url: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);

/**
 * The short looping clip of exactly one step ("Watch how"). Plays inline, muted, on a loop, and
 * can be paused. Until a real recording exists (`src` unset), an animated stand-in shows the
 * idea — a pointer filling a box and pressing the button — so the slot is never empty.
 */
export function HelpMediaPlayer({ src, title, poster }: { src?: string | null; title: string; poster?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      video.current?.pause();
      setPaused(true);
    }
  }, []);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };
  return (
    <div className="plx-helpmedia__frame">
      {src && isVideo(src) ? (
        <>
          <video ref={video} src={src} poster={poster} autoPlay loop muted playsInline aria-label={title} />
          <Button variant="secondary" size="sm" iconOnly className="plx-helpmedia__pause" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
          </Button>
        </>
      ) : src ? (
        // GIF / animated image recordings.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={title} />
      ) : (
        <GuidePlayer title={title} />
      )}
    </div>
  );
}

/** What the pointer shows for one step: the exact button, box, tab or choice, on the screen it lives on. */
function Mock({ step }: { step: GuideStep }) {
  switch (step.kind) {
    case "field":
      return (
        <div className="plx-guide__mock">
          <span className="plx-guide__lab">{step.target}</span>
          <span className="plx-guide__input"><i /></span>
        </div>
      );
    case "tab":
      return (
        <div className="plx-guide__mock plx-guide__tabs">
          <span className="plx-guide__tab">&nbsp;</span>
          <span className="plx-guide__tab plx-guide__tab--on">{step.target}</span>
          <span className="plx-guide__tab">&nbsp;</span>
        </div>
      );
    case "choice":
      return (
        <div className="plx-guide__mock">
          <span className="plx-guide__lab">{step.target}</span>
          <span className="plx-guide__choices"><span>&nbsp;</span><span className="plx-guide__choice--on">&nbsp;</span></span>
        </div>
      );
    default:
      return (
        <div className="plx-guide__mock">
          <span className="plx-guide__ghost" />
          <span className="plx-guide__btn">{step.target}</span>
        </div>
      );
  }
}

/** A short, animated, step-by-step walk-through written for this exact topic (see lib/dashboardV3/helpGuides.ts). */
function GuidePlayer({ title }: { title: string }) {
  const guide = guideFor(title);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);
  const count = guide.steps.length;
  useEffect(() => {
    if (paused || count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), 3400);
    return () => clearInterval(t);
  }, [paused, count]);
  const step = guide.steps[Math.min(i, count - 1)];
  return (
    <div className="plx-guide">
      <p className="plx-guide__intro">{guide.intro}</p>
      <div className="plx-guide__stage" key={i} aria-hidden>
        <span className="plx-guide__where">{step.where}</span>
        <Mock step={step} />
        <MousePointer2 className="plx-guide__cursor" fill="currentColor" aria-hidden />
      </div>
      <ol className="plx-guide__steps">
        {guide.steps.map((st, n) => (
          <li key={st.text}>
            <button type="button" className="plx-guide__step" aria-current={n === i ? "step" : undefined} onClick={() => { setI(n); setPaused(true); }}>
              <span>{n + 1}</span>
              {st.text}
            </button>
          </li>
        ))}
      </ol>
      {count > 1 ? (
        <Button variant="link" size="sm" className="plx-guide__pause" onClick={() => setPaused((v) => !v)} leftIcon={paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}>
          {paused ? "Play steps" : "Pause"}
        </Button>
      ) : null}
    </div>
  );
}

/** "Watch how" toggle that opens the clip inline, right under the step it explains. */
export function HelpMedia({ src, title, caption, label = "Watch how", defaultOpen = false }: { src?: string | null; title: string; caption?: string; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="plx-helpmedia">
      <Button
        variant="link"
        size="sm"
        className="plx-helpmedia__toggle"
        aria-expanded={open}
        aria-controls={id}
        leftIcon={open ? <X size={18} aria-hidden /> : <PlayCircle size={18} aria-hidden />}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide video" : label}
      </Button>
      {open ? (
        <div id={id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <HelpMediaPlayer src={src} title={title} />
          {caption && src ? <span className="plx-helpmedia__caption">{caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small "Watch a 1-minute video" link for a section header; plays in a dialog. */
export function HelpVideoLink({ src, title, label = "Watch a 1-minute video" }: { src?: string | null; title: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="link" size="sm" leftIcon={<PlayCircle size={18} aria-hidden />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width={680}>
        <HelpMediaPlayer src={src} title={title} />
      </Modal>
    </>
  );
}
