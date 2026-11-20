"use client";

import { useCallback, useState } from "react";
import { Button } from "../../ui";
import { useReportDirty } from "./ShopNav";
import { isDirty, saveStatus } from "@/lib/commerce/shopSettingsForm";

/**
 * One form's state: the values, whether they differ from what is saved, and a save that says plainly what happened.
 * `save` returns an error sentence to show, or nothing on success (optionally the values as the server now has them).
 */
export function useSettingsForm<T>(initial: T, save: (values: T) => Promise<{ error?: string; saved?: T } | void>) {
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = isDirty(saved, values);
  useReportDirty(dirty);

  const patch = useCallback((p: Partial<T>) => {
    setJustSaved(false);
    setError(null);
    setValues((v) => ({ ...v, ...p }));
  }, []);
  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await save(values);
      if (r && r.error) {
        setError(r.error);
        return false;
      }
      const next = (r && r.saved) || values;
      setSaved(next);
      setValues(next);
      setJustSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save that just now. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [save, values]);
  const discard = useCallback(() => {
    setValues(saved);
    setError(null);
  }, [saved]);
  const fail = useCallback((message: string) => setError(message), []);

  return { values, patch, dirty, saving, error, fail, submit, discard, status: saveStatus({ dirty, saving, justSaved, error }) };
}

/** The bar at the bottom of a settings screen: what state your changes are in, and the buttons. */
export function SaveBar({ form, label = "Save changes" }: { form: Pick<ReturnType<typeof useSettingsForm>, "status" | "dirty" | "saving" | "submit" | "discard">; label?: string }) {
  return (
    <div className="plx-hsavebar" data-tone={form.status.tone} role="region" aria-label="Save your changes">
      <span className="plx-hsavebar__text" role={form.status.tone === "error" ? "alert" : "status"} aria-live="polite">
        <i aria-hidden className="plx-hsavebar__dot" />
        {form.status.text}
      </span>
      <span className="plx-hsavebar__btns">
        {form.dirty ? <Button variant="ghost" disabled={form.saving} onClick={form.discard}>Undo changes</Button> : null}
        <Button loading={form.saving} disabled={!form.dirty} onClick={() => void form.submit()}>{label}</Button>
      </span>
    </div>
  );
}

/** A group of settings: a title, one sentence of help, then the controls. */
export function Group({ title, help, status, children }: { title: string; help?: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="plx-grp">
      <header className="plx-grp__head">
        <div>
          <h3 className="plx-h3">{title}</h3>
          {help ? <p className="plx-small" style={{ margin: "2px 0 0" }}>{help}</p> : null}
        </div>
        {status}
      </header>
      <div className="plx-grp__body">{children}</div>
    </section>
  );
}

/** A yes/no setting with a switch and a plain sentence. */
export function Switch({ label, help, checked, onChange, disabled }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="plx-toggle">
      <span>
        <b>{label}</b>
        {help ? <span className="plx-small" style={{ display: "block" }}>{help}</span> : null}
      </span>
      <input type="checkbox" className="plx-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** One PUT to the shop's settings. Returns an error sentence or the new settings. */
export async function putSettings(templateId: string, body: Record<string, unknown>): Promise<{ error?: string; settings?: Record<string, unknown>; warning?: string }> {
  try {
    const res = await fetch(`/api/v1/commerce/${templateId}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "We couldn't save your settings just now. Please try again in a moment." };
    return { settings: data.settings, warning: data.warning };
  } catch {
    return { error: "We couldn't reach Plexo. Check your internet and try again." };
  }
}
