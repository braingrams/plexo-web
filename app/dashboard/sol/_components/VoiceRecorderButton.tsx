"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, TriangleAlert } from "lucide-react";
import { uploadAndTranscribe } from "./transcribeUpload";

type RecorderState = "idle" | "recording" | "uploading" | "transcribing" | "error";

const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return null;
}

/**
 * Records a short voice note (MediaRecorder + getUserMedia), shows a live input-level
 * meter via a native Web Audio AnalyserNode (no extra dependency), then runs it through
 * the two-step upload -> transcribe flow so the composer can be populated with the
 * transcript text for the user to review/edit — never auto-sent.
 */
export function VoiceRecorderButton({ onTranscribed, disabled }: { onTranscribed: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanupAudioGraph = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanupAudioGraph, [cleanupAudioGraph]);

  function tickLevel() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    setLevel(Math.min(1, rms * 4));
    rafRef.current = requestAnimationFrame(tickLevel);
  }

  async function startRecording() {
    setErrorMessage(null);
    const mimeType = pickMimeType();
    if (!mimeType || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setErrorMessage("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const ctx = new AudioContextCtor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        rafRef.current = requestAnimationFrame(tickLevel);
      }

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void handleRecordingStopped(mimeType);
      recorder.start();
      mediaRecorderRef.current = recorder;
      setState("recording");
    } catch {
      setState("error");
      setErrorMessage("Microphone access was denied.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    cleanupAudioGraph();
  }

  async function handleRecordingStopped(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    if (blob.size < 500) {
      // Effectively empty — the user tapped record/stop with nothing said.
      setState("idle");
      return;
    }
    setState("uploading");
    try {
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      const text = await uploadAndTranscribe(blob, `voice-note.${ext}`, mimeType.split(";")[0], setState);
      onTranscribed(text);
      setState("idle");
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : "Voice note failed.");
    }
  }

  const busy = state === "uploading" || state === "transcribing";

  function handleClick() {
    if (disabled || busy) return;
    if (state === "recording") {
      stopRecording();
      return;
    }
    if (state === "error") {
      setState("idle");
      setErrorMessage(null);
      return;
    }
    void startRecording();
  }

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        aria-label={state === "recording" ? "Stop recording" : "Record a voice note"}
        title={errorMessage ?? undefined}
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          border: "none",
          display: "grid",
          placeItems: "center",
          cursor: disabled || busy ? "not-allowed" : "pointer",
          background: state === "recording" ? "rgba(248,113,113,0.15)" : "transparent",
          color: state === "recording" ? "#f87171" : state === "error" ? "#f87171" : "rgba(240,242,255,0.55)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {state === "recording" && (
          <span
            style={{
              position: "absolute",
              inset: 2,
              borderRadius: 8,
              boxShadow: `0 0 0 ${2 + level * 6}px rgba(248,113,113,${0.15 + level * 0.25})`,
              transition: "box-shadow 60ms linear",
              pointerEvents: "none",
            }}
          />
        )}
        {busy ? (
          <Loader2 size={16} style={{ animation: "sol-spin 0.9s linear infinite" }} />
        ) : state === "recording" ? (
          <Square size={14} fill="currentColor" />
        ) : state === "error" ? (
          <TriangleAlert size={16} />
        ) : (
          <Mic size={16} />
        )}
      </button>
      {busy && (
        <span style={{ position: "absolute", top: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", fontSize: "0.62rem", color: "rgba(240,242,255,0.45)", whiteSpace: "nowrap" }}>
          {state === "uploading" ? "Uploading…" : "Transcribing…"}
        </span>
      )}
    </div>
  );
}
