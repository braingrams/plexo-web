"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Tag, Trash2, Truck, Upload, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Skeleton, Textarea, useToast } from "../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { draftsFromProduct, MAX_OPTIONS, splitValues, syncVariantRows, variantPayload, type OptionDraft, type VariantDraft } from "@/app/dashboard/commerce/[templateId]/products/VariantsEditor";
import { errMsg, hubApi } from "./hubApi";

/* ------------------------------------------------------------------ the extra fields in the product editor */

export type DigitalMethod = "FILE_DOWNLOAD" | "EXTERNAL_LINK" | "ACCESS_LIST";
export type Extras = {
  category: string;
  compareAt: string;
  sku: string;
  hasOptions: boolean;
  options: OptionDraft[];
  rows: VariantDraft[];
  dMethod: DigitalMethod;
  dFileUrl: string;
  dFileName: string;
  dInstructions: string;
  dPassword: string;
  dHasPassword: boolean;
  dMaxDownloads: string;
  dExpiry: string;
};
export const BLANK_EXTRAS: Extras = { category: "", compareAt: "", sku: "", hasOptions: false, options: [{ name: "Size", values: "" }], rows: [], dMethod: "FILE_DOWNLOAD", dFileUrl: "", dFileName: "", dInstructions: "", dPassword: "", dHasPassword: false, dMaxDownloads: "", dExpiry: "" };

type FullProduct = Record<string, unknown> & { category?: { name: string } | null; compareAtPriceMinor?: number | null; sku?: string | null; options?: unknown; variants?: unknown };

/** What the editor needs from the complete product record. */
export function extrasFromProduct(p: FullProduct): Extras {
  const { options, rows } = draftsFromProduct(p);
  return {
    category: p.category?.name ?? "",
    compareAt: p.compareAtPriceMinor != null ? String(p.compareAtPriceMinor / 100) : "",
    sku: (p.sku as string | null) ?? "",
    hasOptions: rows.length > 0,
    options: options.length ? options : BLANK_EXTRAS.options,
    rows,
    dMethod: (p.digitalDeliveryMethod as DigitalMethod | undefined) ?? "FILE_DOWNLOAD",
    dFileUrl: (p.digitalFileUrl as string | null) ?? "",
    dFileName: (p.digitalFileName as string | null) ?? "",
    dInstructions: (p.digitalAccessInstructions as string | null) ?? "",
    dPassword: "",
    dHasPassword: Boolean(p.hasDigitalAccessPassword),
    dMaxDownloads: p.digitalMaxDownloads != null ? String(p.digitalMaxDownloads) : "",
    dExpiry: p.digitalLinkExpiryDays != null ? String(p.digitalLinkExpiryDays) : "",
  };
}

/** The extra fields to send when saving in the full view, or a plain sentence saying what to fix. */
export function extrasPayload(x: Extras, kind: "PHYSICAL" | "SERVICE" | "DIGITAL", basePrice: number): { fields: Record<string, unknown>; priceMinor?: number } | string {
  const fields: Record<string, unknown> = {
    category: x.category.trim() || null,
    compareAtPriceMinor: x.compareAt.trim() === "" ? null : Math.round(Number(x.compareAt) * 100),
    sku: x.sku.trim() || null,
  };
  if (fields.compareAtPriceMinor !== null && (!Number.isFinite(fields.compareAtPriceMinor) || (fields.compareAtPriceMinor as number) < 0)) return "The “was” price should be a number, like 6000.";
  let priceMinor: number | undefined;
  if (x.hasOptions && kind !== "SERVICE") {
    const built = variantPayload(x.options, x.rows);
    if (typeof built === "string") return built;
    fields.options = built.options;
    fields.variants = built.variants;
    const prices = (built.variants as { priceMinor: number }[]).map((v) => v.priceMinor);
    if (prices.length) priceMinor = Math.min(...prices);
  } else {
    fields.options = null;
    fields.variants = null;
  }
  void basePrice;
  if (kind === "DIGITAL") {
    fields.digitalDeliveryMethod = x.dMethod;
    fields.digitalFileUrl = x.dMethod === "FILE_DOWNLOAD" ? x.dFileUrl || null : null;
    fields.digitalFileName = x.dMethod === "FILE_DOWNLOAD" ? x.dFileName || null : null;
    fields.digitalAccessInstructions = x.dMethod === "ACCESS_LIST" ? x.dInstructions || null : null;
    if (x.dMethod === "ACCESS_LIST" && x.dPassword) fields.digitalAccessPassword = x.dPassword;
    fields.digitalMaxDownloads = x.dMaxDownloads ? Number(x.dMaxDownloads) : null;
    fields.digitalLinkExpiryDays = x.dExpiry ? Number(x.dExpiry) : null;
    if (x.dMethod === "FILE_DOWNLOAD" && !x.dFileUrl) return "Upload the file buyers will download.";
    if (x.dMethod === "ACCESS_LIST" && !x.dInstructions.trim()) return "Say how buyers get access, like “We'll email you an invite”.";
  }
  return { fields, priceMinor };
}

const METHODS: { id: DigitalMethod; title: string; body: string }[] = [
  { id: "FILE_DOWNLOAD", title: "A file they download", body: "Upload it once. Buyers get a safe link after paying." },
  { id: "EXTERNAL_LINK", title: "A link I already have", body: "Google Drive, a video, a members page…" },
  { id: "ACCESS_LIST", title: "I'll give them access", body: "For things you set up by hand, like a group invite." },
];

export function ProductExtras({ siteId, kind, x, set, categories, currency, setError, basePrice }: { siteId: string; kind: "PHYSICAL" | "SERVICE" | "DIGITAL"; x: Extras; set: (p: Partial<Extras>) => void; categories: string[]; currency: string; setError: (m: string | null) => void; basePrice: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function setOptions(options: OptionDraft[]) {
    set({ options, rows: syncVariantRows(options, x.rows, { price: basePrice || "0" }) });
  }
  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const presign = await hubApi<{ url: string; fields: Record<string, string>; publicUrl: string }>(`/api/v1/commerce/${siteId}/digital-upload`, { method: "POST", json: { filename: file.name, contentType: file.type || "application/octet-stream" } }, "We couldn't start that upload. Please try again.");
      const body = new FormData();
      for (const [k, v] of Object.entries(presign.fields)) body.append(k, v);
      body.append("file", file);
      const up = await fetch(presign.url, { method: "POST", body });
      if (!up.ok) throw new Error("The upload didn't finish. Check your internet and try again.");
      set({ dFileUrl: presign.publicUrl, dFileName: file.name });
    } catch (e) {
      setError(errMsg(e, "The upload didn't finish. Please try again."));
    } finally {
      setUploading(false);
    }
  }
  const updateRow = (i: number, patch: Partial<VariantDraft>) => set({ rows: x.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const count = x.options.filter((o) => o.name.trim() && splitValues(o.values).length).length;

  return (
    <div className="plx-pt">
      <div className="plx-form__two">
        <div>
          <Input label="Category" optional list="plx-cats" value={x.category} onChange={(e) => set({ category: e.target.value })} placeholder="Spices" autoComplete="off" />
          <datalist id="plx-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <Input label="Price before the sale" optional help={`Shows crossed out (${currency}).`} inputMode="decimal" value={x.compareAt} onChange={(e) => set({ compareAt: e.target.value })} placeholder="6000" />
      </div>
      {kind !== "SERVICE" && !x.hasOptions ? <Input label="Your own code for it" optional help="A short code like JSM-01, handy for your records." value={x.sku} onChange={(e) => set({ sku: e.target.value })} /> : null}

      {kind !== "SERVICE" ? (
        <section className="plx-pt__sec" aria-label="Options">
          <label className="plx-toggle">
            <span>
              <b>It comes in different sizes or colours</b>
              <span className="plx-small" style={{ display: "block" }}>Each combination gets its own price and stock.</span>
            </span>
            <input type="checkbox" className="plx-switch" checked={x.hasOptions} onChange={(e) => set({ hasOptions: e.target.checked, rows: e.target.checked ? syncVariantRows(x.options, x.rows, { price: basePrice || "0" }) : x.rows })} />
          </label>
          {x.hasOptions ? (
            <>
              {x.options.map((o, i) => (
                <div key={i} className="plx-pt__opt">
                  <Input label={i === 0 ? "Option" : `Option ${i + 1}`} value={o.name} onChange={(e) => setOptions(x.options.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))} placeholder="Size" />
                  <Input label="Choices, separated by commas" value={o.values} onChange={(e) => setOptions(x.options.map((p, j) => (j === i ? { ...p, values: e.target.value } : p)))} placeholder="Small, Medium, Large" />
                  {x.options.length > 1 ? (
                    <Button variant="ghost" iconOnly aria-label={`Remove ${o.name || "option"}`} onClick={() => setOptions(x.options.filter((_, j) => j !== i))}><X size={18} aria-hidden /></Button>
                  ) : null}
                </div>
              ))}
              {x.options.length < MAX_OPTIONS ? (
                <div><Button variant="secondary" size="sm" leftIcon={<Plus size={16} aria-hidden />} onClick={() => setOptions([...x.options, { name: "", values: "" }])}>Add another option</Button></div>
              ) : null}
              {x.rows.length ? (
                <div className="plx-pt__rows" role="table" aria-label="Prices and stock">
                  <div className="plx-pt__rowh" role="row"><span role="columnheader">Choice</span><span role="columnheader">Price</span><span role="columnheader">In stock</span><span role="columnheader">Show</span></div>
                  {x.rows.map((r, i) => (
                    <div className="plx-pt__row" role="row" key={Object.values(r.options).join("|")}>
                      <b role="cell">{Object.values(r.options).join(" / ")}</b>
                      <Input hideLabel label="Price" inputMode="decimal" value={r.price} onChange={(e) => updateRow(i, { price: e.target.value })} />
                      <Input hideLabel label="Stock" inputMode="numeric" value={r.stock} placeholder="Any" onChange={(e) => updateRow(i, { stock: e.target.value })} />
                      <input type="checkbox" className="plx-switch" aria-label={`Show ${Object.values(r.options).join(" / ")}`} checked={r.active} onChange={(e) => updateRow(i, { active: e.target.checked })} />
                    </div>
                  ))}
                </div>
              ) : <p className="plx-small">Add the choices above and each combination appears here.</p>}
              {count > 0 ? <p className="plx-small">Leave stock empty if you never run out.</p> : null}
            </>
          ) : null}
        </section>
      ) : null}

      {kind === "DIGITAL" ? (
        <section className="plx-pt__sec" aria-label="Delivery of the download">
          <b>How do buyers get it?</b>
          <div className="plx-starts" role="radiogroup" aria-label="How buyers get it">
            {METHODS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={x.dMethod === m.id} className="plx-start" onClick={() => set({ dMethod: m.id })}>
                <span className="plx-start__t">{m.title}</span>
                <span className="plx-start__d">{m.body}</span>
              </button>
            ))}
          </div>
          {x.dMethod === "FILE_DOWNLOAD" ? (
            <div className="plx-pt__file">
              <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              <Button variant="secondary" loading={uploading} leftIcon={<Upload size={18} aria-hidden />} onClick={() => fileRef.current?.click()}>{x.dFileName ? "Change the file" : "Upload the file"}</Button>
              <span className="plx-small">{x.dFileName ? x.dFileName : "Any file type. Big files are fine."}</span>
            </div>
          ) : null}
          {x.dMethod === "ACCESS_LIST" ? (
            <>
              <Textarea label="What should buyers do?" value={x.dInstructions} onChange={(e) => set({ dInstructions: e.target.value })} placeholder="We'll email you an invite within a day." />
              <Input label="Password for them" optional help={x.dHasPassword ? "A password is saved. Type a new one to change it." : "Shown only to people who paid."} value={x.dPassword} onChange={(e) => set({ dPassword: e.target.value })} />
            </>
          ) : null}
          <div className="plx-form__two">
            <Input label="Most downloads per buyer" optional inputMode="numeric" value={x.dMaxDownloads} onChange={(e) => set({ dMaxDownloads: e.target.value })} placeholder="No limit" />
            <Input label="Link works for (days)" optional inputMode="numeric" value={x.dExpiry} onChange={(e) => set({ dExpiry: e.target.value })} placeholder="Forever" />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ discounts */

type Discount = { id: string; code: string; type: "PERCENT" | "FIXED"; value: number; active: boolean; expiresAt: string | null; usageLimit: number | null; usedCount: number };

export function DiscountsPanel({ siteId, currency }: { siteId: string; currency: string }) {
  const { show } = useToast();
  const base = `/api/v1/commerce/${siteId}/discounts`;
  const [list, setList] = useState<Discount[] | null>(null);
  const [form, setForm] = useState<{ code: string; type: "PERCENT" | "FIXED"; value: string; expires: string; limit: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => hubApi<{ discounts: Discount[] }>(base).then((r) => setList(r.discounts), (e) => setLoadError(errMsg(e, "We couldn't load your discount codes."))), [base]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form) return;
    const value = Math.round(form.type === "PERCENT" ? Number(form.value) : Number(form.value) * 100);
    if (!form.code.trim()) return setError("Type the code people will enter, like WELCOME10.");
    if (!Number.isFinite(value) || value <= 0 || (form.type === "PERCENT" && value > 100)) return setError(form.type === "PERCENT" ? "Choose a percentage between 1 and 100." : "Type how much comes off, like 500.");
    setBusy(true);
    setError(null);
    try {
      await hubApi(base, { method: "POST", json: { code: form.code, type: form.type, value, expiresAt: form.expires || undefined, usageLimit: form.limit ? Number(form.limit) : undefined } }, "We couldn't save that code. Please try again.");
      show({ title: "Discount code added", tone: "success" });
      setForm(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(d: Discount) {
    try {
      await hubApi(`${base}/${d.id}`, { method: "PATCH", json: { active: !d.active } });
      setList((l) => l?.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)) ?? l);
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    }
  }
  async function remove(d: Discount) {
    if (!window.confirm(`Delete the code ${d.code}? People will no longer be able to use it.`)) return;
    try {
      await hubApi(`${base}/${d.id}`, { method: "DELETE" });
      setList((l) => l?.filter((x) => x.id !== d.id) ?? l);
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    }
  }
  const open = () => { setError(null); setForm({ code: "", type: "PERCENT", value: "", expires: "", limit: "" }); };

  return (
    <>
      {loadError ? <p className="plx-field__error" role="alert">{loadError}</p> : !list ? <Card><Skeleton height={20} width="30%" style={{ marginBottom: 14 }} /><Skeleton height={56} /></Card> : list.length === 0 ? (
        <EmptyState title="Offer a discount" body="Make a code like WELCOME10 and share it. People type it at checkout and the price drops." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={open}>Make a discount code</Button>} illustration={<Tag size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : (
        <Card padding="none" className="plx-listcard">
          <div className="plx-pt__bar"><span className="plx-small">Codes people can use at checkout.</span><Button size="sm" leftIcon={<Plus size={16} aria-hidden />} onClick={open}>New code</Button></div>
          <ul className="plx-list">
            {list.map((d) => (
              <li key={d.id} className="plx-hrow">
                <span className="plx-hrow__main">
                  <span className="plx-hrow__title plx-mono">{d.code}</span>
                  <span className="plx-hrow__sub">{d.type === "PERCENT" ? `${d.value}% off` : `${formatMoney(d.value, currency)} off`} · used {d.usedCount}{d.usageLimit ? ` of ${d.usageLimit}` : ""} {d.expiresAt ? `· ends ${new Date(d.expiresAt).toLocaleDateString()}` : ""}</span>
                </span>
                <span className="plx-hrow__end">
                  {d.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
                  <Button variant="secondary" size="sm" onClick={() => toggle(d)}>{d.active ? "Turn off" : "Turn on"}</Button>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${d.code}`} onClick={() => remove(d)}><Trash2 size={18} aria-hidden /></Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="New discount code" closeOnBackdrop={false} footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={create}>Save code</Button></>}>
        {form ? (
          <div className="plx-form">
            <Input label="Code people type" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" autoComplete="off" />
            <div className="plx-form__two">
              <Select label="Takes off" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "PERCENT" | "FIXED" })} options={[{ value: "PERCENT", label: "A percentage" }, { value: "FIXED", label: `An amount (${currency})` }]} />
              <Input label={form.type === "PERCENT" ? "How many percent" : "How much"} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === "PERCENT" ? "10" : "500"} />
            </div>
            <div className="plx-form__two">
              <Input label="Ends on" optional type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
              <Input label="Most uses" optional inputMode="numeric" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="No limit" />
            </div>
            {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ delivery */

type Method = { id: string; name: string; type: "PICKUP" | "COURIER"; feeMinor: number; description: string | null; estimatedTimeLabel: string | null; countries: string[]; states: string[]; status: "ACTIVE" | "INACTIVE" };
type MForm = { id?: string; name: string; type: "PICKUP" | "COURIER"; free: boolean; fee: string; where: string; time: string; note: string; active: boolean };

export function DeliveryPanel({ siteId, currency }: { siteId: string; currency: string }) {
  const { show } = useToast();
  const base = `/api/v1/commerce/${siteId}`;
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [flags, setFlags] = useState<{ deliveryEnabled: boolean; pickupEnabled: boolean } | null>(null);
  const [form, setForm] = useState<MForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([hubApi<{ methods: Method[] }>(`${base}/delivery-methods`), hubApi<{ settings: { deliveryEnabled?: boolean; pickupEnabled?: boolean } }>(`${base}/settings`)]);
      setMethods(m.methods);
      setFlags({ deliveryEnabled: s.settings?.deliveryEnabled ?? true, pickupEnabled: s.settings?.pickupEnabled ?? true });
    } catch (e) {
      setLoadError(errMsg(e, "We couldn't load your delivery options."));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function flag(patch: Partial<{ deliveryEnabled: boolean; pickupEnabled: boolean }>) {
    if (!flags) return;
    const next = { ...flags, ...patch };
    setFlags(next);
    try {
      await hubApi(`${base}/settings`, { method: "PUT", json: patch }, "We couldn't save that. Please try again.");
    } catch (e) {
      setFlags(flags);
      show({ title: errMsg(e), tone: "danger" });
    }
  }
  const edit = (m?: Method) => {
    setError(null);
    setForm(m ? { id: m.id, name: m.name, type: m.type, free: m.feeMinor === 0, fee: m.feeMinor ? String(m.feeMinor / 100) : "", where: [...m.states, ...m.countries].join(", "), time: m.estimatedTimeLabel ?? "", note: m.description ?? "", active: m.status === "ACTIVE" } : { name: "", type: "COURIER", free: false, fee: "", where: "", time: "", note: "", active: true });
  };
  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Give this option a name, like “Lagos delivery”.");
    const fee = form.free ? 0 : Math.round(Number(form.fee) * 100);
    if (!form.free && (!Number.isFinite(fee) || fee < 0 || form.fee.trim() === "")) return setError("Type what it costs, like 1500, or choose “Free”.");
    setBusy(true);
    setError(null);
    const places = form.where.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await hubApi(form.id ? `${base}/delivery-methods/${form.id}` : `${base}/delivery-methods`, { method: form.id ? "PATCH" : "POST", json: { name: form.name.trim(), type: form.type, feeMinor: fee, states: places, countries: [], estimatedTimeLabel: form.time.trim() || undefined, description: form.note.trim(), status: form.active ? "ACTIVE" : "INACTIVE" } }, "We couldn't save that delivery option. Please try again.");
      show({ title: "Delivery option saved", tone: "success" });
      setForm(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Method) {
    if (!window.confirm(`Delete "${m.name}"? Customers will no longer see it at checkout.`)) return;
    try {
      await hubApi(`${base}/delivery-methods/${m.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    }
  }

  if (loadError) return <p className="plx-field__error" role="alert">{loadError}</p>;
  if (!methods || !flags) return <Card><Skeleton height={20} width="30%" style={{ marginBottom: 14 }} /><Skeleton height={56} /></Card>;
  return (
    <>
      <Card>
        <div className="plx-settings">
          <label className="plx-toggle"><span><b>I deliver to customers</b><span className="plx-small" style={{ display: "block" }}>Turn off if buyers always collect.</span></span><input type="checkbox" className="plx-switch" checked={flags.deliveryEnabled} onChange={(e) => flag({ deliveryEnabled: e.target.checked })} /></label>
          <label className="plx-toggle"><span><b>Customers can collect in person</b><span className="plx-small" style={{ display: "block" }}>Adds a free pickup option at checkout.</span></span><input type="checkbox" className="plx-switch" checked={flags.pickupEnabled} onChange={(e) => flag({ pickupEnabled: e.target.checked })} /></label>
        </div>
      </Card>
      {methods.length === 0 ? (
        <EmptyState compact title="Add a delivery option" body="Say where you deliver and what it costs, like “Lagos, 1,500”." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => edit()}>Add a delivery option</Button>} illustration={<Truck size={56} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : (
        <Card padding="none" className="plx-listcard">
          <div className="plx-pt__bar"><span className="plx-small">What customers can choose at checkout.</span><Button size="sm" leftIcon={<Plus size={16} aria-hidden />} onClick={() => edit()}>Add option</Button></div>
          <ul className="plx-list">
            {methods.map((m) => (
              <li key={m.id} style={{ display: "contents" }}>
                <div className="plx-hrow">
                  <button type="button" className="plx-hrow__main plx-linklike" onClick={() => edit(m)}>
                    <span className="plx-hrow__title">{m.name}</span>
                    <span className="plx-hrow__sub">{m.type === "PICKUP" ? "Pickup" : "Delivery"} · {m.feeMinor ? formatMoney(m.feeMinor, currency) : "Free"}{m.estimatedTimeLabel ? ` · ${m.estimatedTimeLabel}` : ""}</span>
                  </button>
                  <span className="plx-hrow__end">{m.status === "ACTIVE" ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}<Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${m.name}`} onClick={() => remove(m)}><Trash2 size={18} aria-hidden /></Button></span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Change delivery option" : "Add a delivery option"} closeOnBackdrop={false} footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        {form ? (
          <div className="plx-form">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lagos delivery" />
            <div className="plx-form__two">
              <Select label="Kind" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "PICKUP" | "COURIER" })} options={[{ value: "COURIER", label: "I deliver it" }, { value: "PICKUP", label: "They collect it" }]} />
              <Input label={`What it costs (${currency})`} disabled={form.free} inputMode="decimal" value={form.free ? "" : form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder={form.free ? "Free" : "1500"} />
            </div>
            <label className="plx-toggle"><span><b>It's free</b></span><input type="checkbox" className="plx-switch" checked={form.free} onChange={(e) => setForm({ ...form, free: e.target.checked })} /></label>
            {form.type === "COURIER" ? <Input label="Where to" optional help="Places this covers, separated by commas. Leave empty for everywhere." value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} placeholder="Lagos, Abuja" /> : null}
            <Input label="How long it takes" optional value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="1 to 2 days" />
            <Textarea label={form.type === "PICKUP" ? "Pickup address" : "Note for customers"} optional value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <label className="plx-toggle"><span><b>Offer this at checkout</b></span><input type="checkbox" className="plx-switch" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></label>
            {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
