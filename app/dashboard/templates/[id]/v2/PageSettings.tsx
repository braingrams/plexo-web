"use client";

import { useEffect, useState } from "react";
import { Trash2, Undo2 } from "lucide-react";

import type { V2Meta } from "@/lib/v2/design";

// The editor's "Page settings" panel (in its left rail, no top-bar button): the page's name and address, how
// it looks in search and when shared, an owner's own script, and the less common actions. The
// classic editor kept these in several places; here they are one calm panel.

type Props = {
  name: string;
  /** null for the home page (it has no address of its own). */
  slug: string | null;
  meta: V2Meta;
  customJs: string;
  readOnly?: boolean;
  /** An email has a name and nothing else a web page has: no address, search details, scripts, or classic editor to go back to. */
  email?: boolean;
  /** Name/address are saved straight away, like the Pages panel does. Resolves to an error message, or null when saved. */
  onRename: (next: { name: string; slug?: string }) => Promise<string | null>;
  onMeta: (next: V2Meta) => void;
  onCustomJs: (code: string) => void;
  onDelete: () => void;
  /** Present only while this page can still go back to the classic editor. */
  onGoBack?: () => Promise<string | null>;
};

const field = {
  width: "100%",
  padding: "0.45rem 0.6rem",
  borderRadius: 8,
  border: "1px solid var(--ed-w-120)",
  background: "var(--ed-w-040)",
  color: "inherit",
  fontSize: "0.8rem",
  fontFamily: "inherit",
} as const;
const label = { display: "block", fontSize: "0.72rem", fontWeight: 600, color: "var(--ed-t-600)", marginBottom: 4 } as const;
const hint = { margin: "4px 0 0", fontSize: "0.7rem", color: "var(--ed-t-450)", lineHeight: 1.4 } as const;

export function PageSettings(props: Props) {
  const { slug, readOnly, email } = props;
  const [name, setName] = useState(props.name);
  const [address, setAddress] = useState(slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(props.name);
    setAddress(slug ?? "");
  }, [props.name, slug]);

  const saveNames = async () => {
    const nextName = name.trim();
    const nextSlug = address.trim();
    if (!nextName || (nextName === props.name && nextSlug === (slug ?? ""))) return;
    setError(await props.onRename({ name: nextName, ...(slug !== null && nextSlug ? { slug: nextSlug } : {}) }));
  };

  const setMeta = (key: keyof V2Meta, value: string) => props.onMeta({ ...props.meta, [key]: value });

  // Shown inside the editor's own "Page settings" panel (left rail), so there is no button or popover of its own.
  return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, color: "var(--ed-text)" }}>
          <div>
            <label style={label} htmlFor="ps-name">{email ? "Email name" : "Page name"}</label>
            <input id="ps-name" style={field} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} onBlur={() => void saveNames()} />
          </div>
          {email ? null : slug !== null ? (
            <div>
              <label style={label} htmlFor="ps-address">Page address</label>
              <input id="ps-address" style={field} value={address} disabled={readOnly} onChange={(e) => setAddress(e.target.value)} onBlur={() => void saveNames()} placeholder="about-us" />
              <p style={hint}>Use lowercase letters, numbers and hyphens. This is the end of the web address.</p>
            </div>
          ) : (
            <p style={{ ...hint, margin: 0 }}>This is your home page, so it lives at the main address of your site.</p>
          )}
          {error && <p role="alert" style={{ margin: 0, fontSize: "0.75rem", color: "var(--ed-danger)" }}>{error}</p>}

          {!email && (<fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }} disabled={readOnly}>
            <legend style={{ ...label, fontSize: "0.78rem", color: "var(--ed-text)", marginBottom: 6 }}>How this page shows up on Google and when shared</legend>
            <div>
              <label style={label} htmlFor="ps-title">Title</label>
              <input id="ps-title" style={field} value={props.meta.htmlTitle ?? ""} maxLength={200} onChange={(e) => setMeta("htmlTitle", e.target.value)} placeholder={props.name} />
            </div>
            <div>
              <label style={label} htmlFor="ps-desc">Short description</label>
              <textarea id="ps-desc" style={{ ...field, minHeight: 64, resize: "vertical" }} value={props.meta.metaDescription ?? ""} maxLength={300} onChange={(e) => setMeta("metaDescription", e.target.value)} placeholder="One or two sentences about this page" />
            </div>
            <div>
              <label style={label} htmlFor="ps-og">Picture for shared links</label>
              <input id="ps-og" style={field} value={props.meta.ogImageUrl ?? ""} onChange={(e) => setMeta("ogImageUrl", e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label style={label} htmlFor="ps-icon">Small icon in the browser tab</label>
              <input id="ps-icon" style={field} value={props.meta.favicon ?? ""} onChange={(e) => setMeta("favicon", e.target.value)} placeholder="https://…" />
            </div>
          </fieldset>)}

          {!email && (<details>
            <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>Your own script</summary>
            <p style={hint}>Only add code you trust, such as a tracking or chat snippet. It runs on this page for your visitors.</p>
            <textarea aria-label="Your own script" style={{ ...field, minHeight: 90, marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: "0.72rem" }} disabled={readOnly} value={props.customJs} onChange={(e) => props.onCustomJs(e.target.value)} spellCheck={false} />
          </details>)}

          {!readOnly && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, borderTop: "1px solid var(--ed-w-080)" }}>
              {!email && props.onGoBack && !confirmBack && (
                <button type="button" onClick={() => setConfirmBack(true)} style={linkButton}>
                  <Undo2 size={14} /> Go back to the classic editor
                </button>
              )}
              {!email && props.onGoBack && confirmBack && (
                <div style={{ padding: "0.7rem", borderRadius: 10, background: "color-mix(in srgb, var(--ed-warning) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--ed-warning) 25%, transparent)", fontSize: "0.76rem", lineHeight: 1.45 }}>
                  This puts the page back the way it was before you tried the new editor. <strong>Anything you changed since will be lost.</strong>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const problem = await props.onGoBack!();
                        setBusy(false);
                        if (problem) setError(problem);
                      }}
                      style={{ ...linkButton, color: "var(--ed-warning)" }}
                    >
                      {busy ? "Going back…" : "Yes, go back"}
                    </button>
                    <button type="button" onClick={() => setConfirmBack(false)} style={linkButton}>Keep the new editor</button>
                  </div>
                </div>
              )}
              <button type="button" onClick={props.onDelete} style={{ ...linkButton, color: "var(--ed-danger)" }}>
                <Trash2 size={14} /> {email ? "Delete this email" : "Delete this page"}
              </button>
            </div>
          )}
        </div>
  );
}

const linkButton = { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, color: "var(--ed-t-750)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, fontFamily: "inherit" } as const;
