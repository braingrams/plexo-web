"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MousePointer2, Pause, Play, PlayCircle, X } from "lucide-react";
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
        <div className="plx-demo" role="img" aria-label={`${title} (a short animation)`}>
          <span className="plx-demo__bar" />
          <span className="plx-demo__field" />
          <span className="plx-demo__field plx-demo__field--b" />
          <span className="plx-demo__btn" />
          <span className="plx-demo__done">Done</span>
          <MousePointer2 className="plx-demo__cursor" fill="currentColor" aria-hidden />
        </div>
      )}
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
          {caption ? <span className="plx-helpmedia__caption">{caption}</span> : null}
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
