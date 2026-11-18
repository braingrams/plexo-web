"use client";

import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { fillMergeTags, sampleValues } from "@/lib/email/mergeTags";
import { SegmentedControl } from "../ui";

/** An email as it will look: sandboxed (scripts never run), merge tags shown with sample values, desktop or phone width. */
export function EmailPreview({ html, empty = "Your email shows here as you type.", height = "100%" }: { html: string; empty?: string; height?: number | string }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [filled, setFilled] = useState(true);
  const doc = useMemo(() => (filled ? fillMergeTags(html, sampleValues()) : html), [html, filled]);
  return (
    <div className="plx-emprev" style={{ height }}>
      <div className="plx-emprev__bar">
        <SegmentedControl
          label="Screen size"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "Computer", icon: <Monitor size={16} aria-hidden /> },
            { value: "phone", label: "Phone", icon: <Smartphone size={16} aria-hidden /> },
          ]}
        />
        <label className="plx-emprev__fill">
          <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
          <span>Show sample names</span>
        </label>
      </div>
      <div className="plx-emprev__stage">
        {html.trim() ? (
          <iframe title="Email preview" className={`plx-emprev__frame plx-emprev__frame--${device}`} srcDoc={doc} sandbox="" />
        ) : (
          <p className="plx-small plx-emprev__empty">{empty}</p>
        )}
      </div>
    </div>
  );
}
