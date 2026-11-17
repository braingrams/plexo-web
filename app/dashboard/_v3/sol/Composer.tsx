"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FileText, ImagePlus, LoaderCircle, Square, TriangleAlert, X } from "lucide-react";
import { VoiceRecorderButton } from "../../sol/_components/VoiceRecorderButton";
import { MODEL_TIER_OPTIONS, type ModelTier, type PendingAttachment } from "../../sol/_components/types";
import { ACCEPTED_FILE_TYPES, useComposer, type ComposerProps } from "../../sol/_components/useComposer";

// Plain names for the three levels (the descriptions in types.ts are written for the old screens).
const TIERS: Record<ModelTier, { name: string; note: string }> = {
  BASIC: { name: "Quick", note: "Fast, for everyday jobs" },
  MEDIUM: { name: "Smart", note: "Thinks harder about bigger jobs" },
  HIGH: { name: "Smartest", note: "Best for building a whole site or app" },
};

function TierMenu({ value, onChange, disabled, note }: { value: ModelTier; onChange: (t: ModelTier) => void; disabled?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="sol3-tier" ref={wrap} title={note}>
      <button type="button" className="sol3-tier__btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={`How SOL thinks: ${TIERS[value].name}`} onClick={() => setOpen((v) => !v)}>
        {TIERS[value].name}
        {disabled ? null : <ChevronDown size={16} aria-hidden />}
      </button>
      {open ? (
        <div className="sol3-tier__menu" role="listbox" aria-label="How SOL thinks">
          {MODEL_TIER_OPTIONS.map((t) => (
            <button key={t.value} type="button" role="option" aria-selected={t.value === value} className="sol3-tier__opt" onClick={() => { onChange(t.value); setOpen(false); }}>
              <span>
                <b>{TIERS[t.value].name}</b>
                <small>{TIERS[t.value].note}</small>
              </span>
              {t.value === value ? <Check size={18} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Attachment({ a, onRemove }: { a: PendingAttachment; onRemove: () => void }) {
  return (
    <div className="sol3-att" data-status={a.status}>
      {a.status === "uploading" ? <LoaderCircle size={16} className="plx-spin" aria-hidden /> : a.status === "error" ? <TriangleAlert size={16} aria-hidden /> : a.file.type.startsWith("image/") ? <ImagePlus size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
      <span title={a.error ?? a.file.name}>{a.status === "error" ? "Couldn't add it" : a.file.name}</span>
      <button type="button" aria-label={`Remove ${a.file.name}`} onClick={onRemove}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** The chat box: type, add a picture, speak, pick how SOL thinks, send (or stop). */
export function SolComposer(props: ComposerProps & { autoFocus?: boolean }) {
  const { streaming, disabled, modelTier, onModelTierChange, onStop, placeholder, tierNote, autoFocus } = props;
  const c = useComposer(props);
  useEffect(() => {
    if (autoFocus && !disabled) c.textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);
  return (
    <div>
      <div className="sol3-composer">
        {c.attachments.length > 0 || c.transcribingFile ? (
          <div className="sol3-atts">
            {c.attachments.map((a) => (
              <Attachment key={a.clientId} a={a} onRemove={() => c.removeAttachment(a.clientId)} />
            ))}
            {c.transcribingFile ? <div className="sol3-att"><LoaderCircle size={16} className="plx-spin" aria-hidden /><span>Turning your recording into words…</span></div> : null}
          </div>
        ) : null}
        <textarea
          ref={c.textareaRef}
          value={c.text}
          onChange={(e) => c.setText(e.target.value)}
          onKeyDown={c.handleKeyDown}
          onPaste={c.handlePaste}
          placeholder={placeholder ?? "Tell SOL what you'd like to do…"}
          aria-label="Message SOL"
          rows={1}
          disabled={disabled}
        />
        <div className="sol3-composer__row">
          <input ref={c.fileInputRef} type="file" multiple accept={ACCEPTED_FILE_TYPES} hidden onChange={(e) => { void c.handleFilesPicked(e.target.files); e.target.value = ""; }} />
          <button type="button" className="plx-iconbtn" aria-label="Add a picture or file" title="Add a picture or file" disabled={disabled} onClick={() => c.fileInputRef.current?.click()}>
            <ImagePlus size={19} aria-hidden />
          </button>
          <TierMenu value={modelTier} onChange={onModelTierChange} disabled={disabled || streaming || !!tierNote} note={tierNote} />
          <span className="sol3-composer__sp" />
          <VoiceRecorderButton v3 disabled={disabled} onTranscribed={(t) => { if (!t) return; c.setText((prev) => (prev ? `${prev} ${t}` : t)); c.textareaRef.current?.focus(); }} />
          {streaming ? (
            <button type="button" className="sol3-send" data-stop="true" aria-label="Stop" title="Stop" onClick={onStop}>
              <Square size={15} fill="currentColor" aria-hidden />
            </button>
          ) : (
            <button type="button" className="sol3-send" aria-label="Send message" title="Send" disabled={!c.canSend} onClick={c.handleSend}>
              <ArrowUp size={20} strokeWidth={2.6} aria-hidden />
            </button>
          )}
        </div>
      </div>
      <p className="sol3-hint">
        <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
      </p>
    </div>
  );
}
