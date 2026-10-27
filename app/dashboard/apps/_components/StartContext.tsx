"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, FileText, Image as ImageIcon, Loader2, Paperclip, Palette, TriangleAlert, Upload, X } from "lucide-react";
import type { ModelTier } from "../../sol/_components/types";
import { MAX_START_FILES, START_FILE_ACCEPT, uploadStartFile, type StartFile, type StartFileRole, type StartHandoff } from "./startHandoff";
import { accent, border, fill, ink, muted, surface, tint } from "./appPlan";

// Everything the owner can hand SOL before it starts building — the more it has, the less it
// has to guess. Files upload the moment they're picked, so "Build my app" never waits on them.

const randomId = () => Math.random().toString(36).slice(2, 10);

export function useStartContext() {
  const [files, setFiles] = useState<StartFile[]>([]);
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  const add = useCallback((role: StartFileRole, picked: FileList | File[] | null) => {
    if (!picked) return;
    setNotice(null);
    let list = Array.from(picked);
    if (role !== "reference") list = list.slice(0, 1);
    const room = MAX_START_FILES - filesRef.current.filter((f) => !(role !== "reference" && f.role === role)).length;
    if (list.length > room) {
      setNotice(`You can add up to ${MAX_START_FILES} files.`);
      list = list.slice(0, Math.max(room, 0));
    }
    if (!list.length) return;
    const entries: StartFile[] = list.map((file) => ({ id: randomId(), name: file.name, size: file.size, role, status: "uploading" }));
    // A logo or brand guide is a single slot — a new pick replaces the old one.
    setFiles((prev) => [...prev.filter((f) => role === "reference" || f.role !== role), ...entries]);
    list.forEach((file, i) => {
      const id = entries[i].id;
      uploadStartFile(file)
        .then(({ url, type }) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "ready", url, type } : f))))
        .catch((err) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: err instanceof Error ? err.message : "Upload failed." } : f))));
    });
  }, []);

  const remove = useCallback((id: string) => setFiles((prev) => prev.filter((f) => f.id !== id)), []);

  const uploading = files.some((f) => f.status === "uploading");
  const failed = files.some((f) => f.status === "error");
  const ready: StartHandoff["files"] = files
    .filter((f): f is StartFile & { url: string; type: NonNullable<StartFile["type"]> } => f.status === "ready" && !!f.url && !!f.type)
    .map((f) => ({ role: f.role, type: f.type, url: f.url, name: f.name }));

  const reset = useCallback(() => {
    setFiles([]);
    setNotes("");
    setNotice(null);
  }, []);

  return { files, notes, setNotes, add, remove, uploading, failed, ready, notice, reset };
}
export type StartContextState = ReturnType<typeof useStartContext>;

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function FileChip({ file, onRemove }: { file: StartFile; onRemove: () => void }) {
  const Icon = file.type === "image" || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.name) ? ImageIcon : FileText;
  const bad = file.status === "error";
  return (
    <div
      title={bad ? file.error : file.name}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 10px", borderRadius: 11, border: `1px solid ${bad ? "rgba(248,113,113,0.5)" : border}`, background: surface, minWidth: 0, maxWidth: "100%" }}
    >
      <Icon size={15} color={bad ? "#f87171" : accent} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{file.name}</span>
        <span style={{ fontSize: 11.5, color: bad ? "#f87171" : muted }}>{file.status === "uploading" ? "Uploading…" : bad ? file.error : formatSize(file.size)}</span>
      </span>
      {file.status === "uploading" ? <Loader2 size={14} color={muted} className="ah-spin" style={{ flexShrink: 0 }} /> : bad ? <TriangleAlert size={14} color="#f87171" style={{ flexShrink: 0 }} /> : null}
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} style={{ background: "none", border: "none", padding: 3, cursor: "pointer", color: muted, display: "flex", flexShrink: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
}

export function FileChips({ files, onRemove }: { files: StartFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {files.map((f) => <FileChip key={f.id} file={f} onRemove={() => onRemove(f.id)} />)}
    </div>
  );
}

const ghostButton: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 11, border: `1px solid ${border}`, background: surface, color: ink, fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };

const TIER_CHOICES: Array<{ value: ModelTier; label: string; hint: string }> = [
  { value: "MEDIUM", label: "Advanced", hint: "Stronger thinking — best for detailed briefs" },
  { value: "BASIC", label: "Standard", hint: "Fast and efficient for simpler apps" },
];

/** Standard or Advanced, chosen before SOL starts. Advanced by default; locked plans see Standard only. */
export function QualityChoice({ value, onChange, locked }: { value: ModelTier; onChange: (t: ModelTier) => void; locked?: { note: string } | null }) {
  const current = locked ? "BASIC" : value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: ink }}>How should SOL build it?</div>
      <div role="radiogroup" aria-label="How should SOL build it?" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {TIER_CHOICES.map((c) => {
          const on = current === c.value;
          const disabled = !!locked && c.value !== "BASIC";
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(c.value)}
              style={{ flex: "1 1 200px", minWidth: 0, textAlign: "left", padding: "11px 14px", borderRadius: 13, fontFamily: "inherit", color: ink, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, border: on ? `2px solid ${accent}` : `1px solid ${border}`, margin: on ? 0 : 1, background: on ? tint(accent, 10) : surface }}
            >
              <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{c.label}</span>
              <span style={{ display: "block", fontSize: 12.5, color: muted, marginTop: 2 }}>{c.hint}</span>
            </button>
          );
        })}
      </div>
      {locked && <span style={{ fontSize: 12.5, color: muted }}>{locked.note}</span>}
    </div>
  );
}

/** "Attach files" — for the describe-it-yourself box, where the brief often lives in a document. */
export function AttachFiles({ ctx }: { ctx: StartContextState }) {
  const input = useRef<HTMLInputElement>(null);
  const references = ctx.files.filter((f) => f.role === "reference");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => input.current?.click()} style={ghostButton}>
          <Paperclip size={15} /> Attach files
        </button>
        <span style={{ fontSize: 12.5, color: muted }}>Got a brief, wireframes or screenshots? Add them — Word, PDF, images or text.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={START_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            ctx.add("reference", e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <FileChips files={references} onRemove={ctx.remove} />
      {ctx.notice && <span role="status" style={{ fontSize: 12.5, color: "#f59e0b" }}>{ctx.notice}</span>}
    </div>
  );
}

function Slot({ ctx, role, icon: Icon, title, hint, accept, multiple }: { ctx: StartContextState; role: StartFileRole; icon: typeof Upload; title: string; hint: string; accept: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const mine = ctx.files.filter((f) => f.role === role);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: ink }}>{title}</div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          ctx.add(role, e.dataTransfer.files);
        }}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 13, border: `1.5px dashed ${over ? accent : border}`, background: over ? tint(accent, 8) : "transparent", cursor: "pointer" }}
      >
        <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: tint(accent, 14), color: accent, flexShrink: 0 }}><Icon size={17} /></span>
        <span style={{ fontSize: 13, color: muted, lineHeight: 1.4 }}>{hint}</span>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => {
            ctx.add(role, e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <FileChips files={mine} onRemove={ctx.remove} />
    </div>
  );
}

export function NotesField({ ctx }: { ctx: StartContextState }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: ink }}>Anything else SOL should know</span>
      <textarea
        value={ctx.notes}
        onChange={(e) => ctx.setNotes(e.target.value)}
        rows={4}
        placeholder="Pages you need, wording to use, who your visitors are, things to avoid, links to sites you like…"
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 14, borderRadius: 13, border: `1px solid ${border}`, background: surface, color: ink, fontSize: 14, lineHeight: 1.5, fontFamily: "inherit", outline: "none" }}
      />
    </label>
  );
}

/**
 * "More details" — closed by default so first-timers never see it, open to anyone who wants
 * SOL to build from their real material instead of guessing. `showReference` adds the general
 * file slot (the describe screen already has its own Attach button).
 */
export function MoreDetails({ ctx, showReference, hideNotes, defaultOpen = false }: { ctx: StartContextState; showReference?: boolean; hideNotes?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const count = ctx.files.filter((f) => f.role !== "reference").length + (!hideNotes && ctx.notes.trim() ? 1 : 0);
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 16, background: fill(2), overflow: "hidden" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "none", border: "none", color: ink, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>Advanced: give SOL more to work from {count > 0 && <span style={{ color: accent }}>· {count} added</span>}</span>
          <span style={{ display: "block", fontSize: 12.5, color: muted, marginTop: 2 }}>Logo, brand guide, documents and notes. Optional — skip it and SOL will choose sensibly.</span>
        </span>
        <ChevronDown size={18} color={muted} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>
      {open && (
        <div className="ah-fade" style={{ padding: "4px 16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
          {!hideNotes && <NotesField ctx={ctx} />}
          <Slot ctx={ctx} role="logo" icon={ImageIcon} title="Your logo" hint="Drop your logo here or click to choose one (PNG, JPG or WebP)" accept="image/png,image/jpeg,image/webp" />
          <Slot ctx={ctx} role="design" icon={Palette} title="Brand or design guide" hint="Colours, fonts and style rules — a PDF, Word file or screenshot of your design system" accept={START_FILE_ACCEPT} />
          {showReference && <Slot ctx={ctx} role="reference" icon={Upload} title="Briefs, wireframes and other documents" hint="Anything SOL should follow closely. Add several if you like." accept={START_FILE_ACCEPT} multiple />}
          {ctx.notice && <span role="status" style={{ fontSize: 12.5, color: "#f59e0b" }}>{ctx.notice}</span>}
        </div>
      )}
    </div>
  );
}
