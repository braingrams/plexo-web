"use client";

import "../hub/hub.css";
import "./settings.css";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui";

/** A value to copy, in a box with a Copy button (also used for the one-link AI cards). */
export function CopyBox({ value, label, wrap }: { value: string; label: string; wrap?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="plx-copybox" style={{ marginTop: 0 }}>
      <code aria-label={label} style={wrap ? undefined : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</code>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** One setting you switch on or off, with a plain sentence under it. */
export function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="plx-toggle" style={{ cursor: disabled ? "default" : "pointer" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <b style={{ fontSize: 15 }}>{title}</b>
        {description ? <span className="plx-small">{description}</span> : null}
      </span>
      <input type="checkbox" className="plx-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="plx-set__head">
      <h1 className="plx-h1">{title}</h1>
      {children ? <p>{children}</p> : null}
    </header>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <div className={`plx-inlinemsg${tone === "warn" ? " plx-inlinemsg--warn" : tone === "bad" ? " plx-inlinemsg--bad" : ""}`} role={tone === "bad" ? "alert" : undefined}>
      {children}
    </div>
  );
}
