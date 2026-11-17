"use client";

import { ArrowUp, Plus, Square } from "lucide-react";
import { AttachmentChip } from "./AttachmentChip";
import { VoiceRecorderButton } from "./VoiceRecorderButton";
import { ModelTierSelector } from "./ModelTierSelector";
import { ACCEPTED_FILE_TYPES, useComposer, type ComposerProps } from "./useComposer";

const PLACEHOLDER = "Ask SOL to publish a page…";

export function Composer(props: ComposerProps) {
  const { streaming, disabled, modelTier, onModelTierChange, onStop, placeholder, tierNote } = props;
  const { text, setText, attachments, transcribingFile, textareaRef, fileInputRef, handleFilesPicked, handlePaste, removeAttachment, handleSend, handleKeyDown, canSend } = useComposer(props);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(18,14,28,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "0.6rem 0.7rem",
        boxShadow: "0 20px 50px -20px rgba(0,0,0,0.55)",
      }}
    >
      {(attachments.length > 0 || transcribingFile) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", padding: "0.3rem 0.3rem 0" }}>
          {attachments.map((a) => (
            <AttachmentChip key={a.clientId} attachment={a} onRemove={() => removeAttachment(a.clientId)} />
          ))}
          {transcribingFile && (
            <div style={{ display: "flex", alignItems: "center", padding: "0.4rem 0.7rem", borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: "0.72rem", color: "rgba(240,242,255,0.5)" }}>
              Transcribing audio…
            </div>
          )}
        </div>
      )}

      {/* The text box gets the full width on top; the tools sit in a row underneath —
          add a file on the left; the model, voice and send on the right. */}
        <textarea
          ref={textareaRef}
          className="sol-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder ?? PLACEHOLDER}
          rows={1}
          disabled={disabled}
          style={{
            width: "100%",
            display: "block",
            resize: "none",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#f3f0fa",
            fontSize: "0.92rem",
            lineHeight: 1.5,
            fontFamily: "inherit",
            maxHeight: 220,
            padding: "0.45rem 0.35rem 0.25rem",
          }}
        />

      <div className="sol-composer-row" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILE_TYPES} style={{ display: "none" }} onChange={(e) => { void handleFilesPicked(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(240,242,255,0.65)",
            display: "grid",
            placeItems: "center",
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
          }}
        >
          <Plus size={17} />
        </button>

        <span style={{ flex: 1 }} />

        <div style={{ flexShrink: 0 }} title={tierNote}>
          <ModelTierSelector
            value={modelTier}
            onChange={onModelTierChange}
            disabled={disabled || streaming || !!tierNote}
            className="sol-composer-tier-select"
            menuWidth={260}
          />
        </div>

        <div style={{ marginBottom: "0.1rem", flexShrink: 0 }}>
          <VoiceRecorderButton
            disabled={disabled}
            onTranscribed={(transcript) => {
              if (!transcript) return;
              setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
              textareaRef.current?.focus();
            }}
          />
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="sol-send-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "#f0f2ff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="sol-send-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "none",
              background: canSend ? "linear-gradient(135deg,var(--brand-light),var(--brand-deep))" : "rgba(255,255,255,0.06)",
              color: canSend ? "#fff" : "rgba(240,242,255,0.3)",
              display: "grid",
              placeItems: "center",
              cursor: canSend ? "pointer" : "not-allowed",
              boxShadow: canSend ? "0 6px 20px -4px rgba(var(--brand-rgb),0.7)" : "none",
              transition: "transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease",
              flexShrink: 0,
            }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <style>{`
        .sol-send-btn:hover:not(:disabled) { transform: scale(1.06); }
        .sol-send-btn:active:not(:disabled) { transform: scale(0.94); }
        /* Plain, borderless model-tier switcher inside the composer row — CustomSelect's
           own default trigger has a border/background meant for a standalone dropdown
           sitting on its own; here it's one control among several in a single toolbar row,
           so it should read as flush with the row, not as its own boxed element. */
        .sol-composer-tier-select {
          width: auto !important;
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          padding: 0.4rem 0.5rem !important;
          gap: 0.3rem !important;
          color: rgba(240,242,255,0.6) !important;
          font-size: 0.78rem !important;
        }
        .sol-composer-tier-select:hover { background: rgba(255,255,255,0.05) !important; }
        /* Narrow phones: let the tools row wrap rather than squeeze its controls. */
        @media (max-width: 480px) {
          .sol-composer-row { flex-wrap: wrap; }
        }
      `}</style>
    </div>
  );
}
