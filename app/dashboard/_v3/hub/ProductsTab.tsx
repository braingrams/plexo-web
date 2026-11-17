"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, ImagePlus, Package, Plus, Rocket, SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, SegmentedControl, Select, Textarea, useToast } from "../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { HubProduct } from "@/lib/dashboardV3/hubData";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";
import { BLANK_EXTRAS, DeliveryPanel, DiscountsPanel, ProductExtras, extrasFromProduct, extrasPayload, type Extras } from "./ProductTools";
import { readProductsView, resolveProductsView, saveProductsView, type ProductsView } from "@/lib/dashboardV3/hubView";
import type { Experience } from "@/lib/dashboardV3/nav";
import { filterProducts, type StockFilter } from "@/lib/dashboardV3/productFilter";
import { CsvImportDialog } from "@/app/dashboard/commerce/[templateId]/products/CsvImportDialog";
import { AiImportDialog } from "@/app/dashboard/commerce/[templateId]/products/AiImportDialog";
import { SellProductModal } from "@/app/dashboard/commerce/[templateId]/products/SellProductModal";
import "@/app/dashboard/commerce/_components/cmx.css";

type Form = { id?: string; name: string; price: string; kind: HubProduct["kind"]; description: string; stock: string; minutes: string; link: string; imageUrl: string; active: boolean; x: Extras };
const BLANK: Form = { name: "", price: "", kind: "PHYSICAL", description: "", stock: "", minutes: "60", link: "", imageUrl: "", active: true, x: BLANK_EXTRAS };

const KIND_LABEL: Record<HubProduct["kind"], string> = { PHYSICAL: "Something I ship", DIGITAL: "A download", SERVICE: "A service or booking" };

export function ProductsTab({ siteId, products, currency, experience, startWithService }: { siteId: string; products: HubProduct[]; currency: string; experience: Experience; startWithService?: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const [form, setForm] = useState<Form | null>(startWithService ? { ...BLANK, kind: "SERVICE" } : null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/v1/commerce/${siteId}/products`;
  const [view, setView] = useState<ProductsView>(() => resolveProductsView(experience, null));
  const [search, setSearch] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [importing, setImporting] = useState<null | "csv" | "sol">(null);
  const [sellTarget, setSellTarget] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hiding, setHiding] = useState(false);
  const [section, setSection] = useState<"products" | "discounts" | "delivery">("products");
  // The owner's own choice (kept on this device) beats the default for their experience.
  useEffect(() => setView(readProductsView(experience)), [experience]);
  const full = view === "full";
  const switchView = (v: ProductsView) => {
    setView(v);
    saveProductsView(v);
    if (v === "simple") setSection("products");
  };
  const shown = filterProducts(products, search, stock);
  async function hidePicked() {
    setHiding(true);
    try {
      // The same call the old page used: "delete" on a product hides it from the shop and keeps its orders.
      await Promise.all([...picked].map((id) => hubApi(`${base}/${id}`, { method: "DELETE" })));
      show({ title: `${picked.size} product${picked.size === 1 ? "" : "s"} hidden`, description: "They are off your shop now. Open one to show it again.", tone: "success" });
      setPicked(new Set());
      setPicking(false);
      router.refresh();
    } catch (e) {
      show({ title: "We couldn't hide them all", description: errMsg(e), tone: "danger" });
    } finally {
      setHiding(false);
    }
  }
  const categories = [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))];

  async function open(p?: HubProduct) {
    setError(null);
    if (!p) return setForm({ ...BLANK });
    setForm({ id: p.id, name: p.name, price: String(p.priceMinor / 100), kind: p.kind, description: p.description ?? "", stock: p.stockQuantity == null ? "" : String(p.stockQuantity), minutes: "60", link: "", imageUrl: p.imageUrl ?? "", active: p.active, x: BLANK_EXTRAS });
    // The list is light; fetch the rest of this product so saving never wipes what isn't shown here.
    try {
      const r = await hubApi<{ product: { durationMinutes?: number | null; digitalExternalUrl?: string | null } & Record<string, unknown> }>(`${base}/${p.id}`);
      setForm((f) => (f && f.id === p.id ? { ...f, minutes: String(r.product.durationMinutes ?? 60), link: r.product.digitalExternalUrl ?? "", x: extrasFromProduct(r.product) } : f));
    } catch {}
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { url } = await hubApi<{ url: string }>("/api/v1/media/upload", { method: "POST", body }, "We couldn't upload that photo. Try a smaller picture.");
      setForm((f) => (f ? { ...f, imageUrl: url } : f));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form) return;
    const price = Number(form.price.replace(/,/g, ""));
    if (!form.name.trim()) return setError("Please give your product a name.");
    if (form.price.trim() === "" || !Number.isFinite(price) || price < 0) return setError("Please add a price, like 5000.");
    if (!full && form.kind === "DIGITAL" && !form.link.trim()) return setError("Paste the link where buyers get their download.");
    const extra = full ? extrasPayload(form.x, form.kind, price) : null;
    if (typeof extra === "string") return setError(extra);
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      priceMinor: extra?.priceMinor ?? Math.round(price * 100),
      imageUrl: form.imageUrl || null,
      active: form.active,
      ...(form.kind === "PHYSICAL" && !(extra && extra.fields.variants) ? { stockQuantity: form.stock.trim() === "" ? 0 : Number(form.stock) || 0 } : {}),
      ...(form.kind === "SERVICE" ? { durationMinutes: Number(form.minutes) || 60 } : {}),
      ...(form.kind === "DIGITAL" && !full ? { digitalDeliveryMethod: "EXTERNAL_LINK", digitalExternalUrl: form.link.trim() } : {}),
      ...(extra ? extra.fields : {}),
      ...(extra && form.kind === "DIGITAL" && form.x.dMethod === "EXTERNAL_LINK" ? { digitalExternalUrl: form.link.trim() || null } : {}),
    };
    try {
      await hubApi(form.id ? `${base}/${form.id}` : base, { method: form.id ? "PATCH" : "POST", json: payload }, "We couldn't save that product. Please try again.");
      show({ title: form.id ? "Product saved" : "Product added", description: form.id ? undefined : "It's in your shop now.", tone: "success" });
      setForm(null);
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form?.id) return;
    if (!window.confirm(`Delete "${form.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await hubApi(`${base}/${form.id}`, { method: "DELETE" });
      setForm(null);
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <>
      <TabBar
        title="Your products"
        sub={products.length ? "Tap a product to change its price, photo or words." : "Add what you sell. It shows up in your shop straight away."}
        action={
          <Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => open()} data-tour="hub-add-product">
            Add a product
          </Button>
        }
      />
      <div className="plx-viewswitch" data-tour="hub-product-tools">
        {full ? (
          <SegmentedControl label="Product tools" value={section} onChange={setSection} options={[{ value: "products", label: "Products" }, { value: "discounts", label: "Discounts" }, { value: "delivery", label: "Delivery" }]} />
        ) : null}
        <Button variant={full ? "ghost" : "secondary"} size="sm" leftIcon={<SlidersHorizontal size={16} aria-hidden />} onClick={() => switchView(full ? "simple" : "full")} aria-pressed={full}>
          {full ? "Simple view" : "Show full product tools"}
        </Button>
        {!full ? <span className="plx-small">Sizes and colours, discounts, downloads, stock and delivery.</span> : null}
      </div>
      {full && section === "products" ? (
        <div className="plx-viewswitch">
          <Button variant="secondary" size="sm" leftIcon={<FileSpreadsheet size={16} aria-hidden />} onClick={() => setImporting("csv")}>
            Add many from a spreadsheet
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Plus size={16} aria-hidden />} onClick={() => setImporting("sol")}>
            Let SOL read my list
          </Button>
          {products.length > 1 ? (
            <Button variant={picking ? "primary" : "ghost"} size="sm" aria-pressed={picking} onClick={() => { setPicking((v) => !v); setPicked(new Set()); }}>
              {picking ? "Done choosing" : "Hide several at once"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {products.length > 4 && (!full || section === "products") ? (
        <div className="plx-viewswitch">
          <Input label="Search your products" hideLabel type="search" fieldClassName="plx-hsearch" placeholder="Search your products" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SegmentedControl label="Show" value={stock} onChange={setStock} options={[{ value: "all", label: "All" }, { value: "in", label: "In stock" }, { value: "out", label: "Sold out" }]} />
        </div>
      ) : null}
      {picking && full && section === "products" ? (
        <div className="plx-inlinemsg">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span>{picked.size ? `${picked.size} chosen. Tap more to add them.` : "Tap the products you want to hide from your shop."}</span>
            <Button size="sm" variant="danger" disabled={!picked.size} loading={hiding} onClick={hidePicked}>
              Hide {picked.size || ""} from my shop
            </Button>
          </div>
        </div>
      ) : null}
      {full && section === "discounts" ? <DiscountsPanel siteId={siteId} currency={currency} /> : full && section === "delivery" ? <DeliveryPanel siteId={siteId} currency={currency} /> : products.length === 0 ? (
        <EmptyState title="Add your first product" body="A name, a price and a photo is all it takes. Your shop, basket and checkout are already set up for you." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => open()}>Add a product</Button>} illustration={<Package size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : (
        <Card padding="none" className="plx-listcard" data-tour="hub-products">
          <ul className="plx-list">
            {shown.length === 0 ? <li className="plx-hrow"><span className="plx-small">Nothing matches that. Try another word or show all.</span></li> : null}
            {shown.map((p) => (
              <li key={p.id} style={{ display: "contents" }}>
                <button type="button" className="plx-hrow" aria-pressed={picking ? picked.has(p.id) : undefined} style={picking && picked.has(p.id) ? { background: "var(--plx-tint)" } : undefined} onClick={() => (picking ? setPicked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; }) : open(p))}>
                  <span className="plx-hrow__thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Package size={22} aria-hidden />}</span>
                  <span className="plx-hrow__main">
                    <span className="plx-hrow__title">{p.name}</span>
                    <span className="plx-hrow__sub">
                      {KIND_LABEL[p.kind]}
                      {p.kind === "PHYSICAL" && p.stockQuantity != null ? ` · ${p.stockQuantity} in stock` : ""}
                    </span>
                  </span>
                  <span className="plx-hrow__end">
                    {!p.active ? <Badge>Hidden</Badge> : p.kind === "PHYSICAL" && p.stockQuantity === 0 ? <Badge tone="warning">Sold out</Badge> : null}
                    <span className="plx-hrow__price">{formatMoney(p.priceMinor, currency)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        width={full ? 680 : 560}
        title={form?.id ? "Change product" : "Add a product"}
        closeOnBackdrop={false}
        footer={
          <>
            {form?.id ? (
              <Button variant="ghost" onClick={remove} disabled={busy} style={{ marginRight: "auto", color: "var(--plx-danger)" }}>
                Delete
              </Button>
            ) : null}
            {form?.id ? (
              <Button variant="secondary" leftIcon={<Rocket size={16} aria-hidden />} disabled={busy} onClick={() => { setSellTarget({ id: form.id as string, name: form.name }); setForm(null); }}>
                Put it on my page
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={save}>
              {form?.id ? "Save" : "Add product"}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="plx-form">
            <Input label="What is it called?" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Jollof spice mix" autoComplete="off" />
            <div className="plx-form__two">
              <Input label={`Price (${currency})`} inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="5000" />
              <Select label="What kind is it?" value={form.kind} onChange={(e) => set({ kind: e.target.value as Form["kind"] })} options={(Object.keys(KIND_LABEL) as HubProduct["kind"][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
            </div>
            {form.kind === "PHYSICAL" && !(full && form.x.hasOptions) ? <Input label="How many do you have?" inputMode="numeric" value={form.stock} onChange={(e) => set({ stock: e.target.value })} placeholder="20" /> : null}
            {form.kind === "SERVICE" ? <Input label="How long does it take (minutes)?" inputMode="numeric" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} /> : null}
            {form.kind === "DIGITAL" && !full ? <Input label="Link to your download" help="Buyers get this link by email after they pay." value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" /> : null}
            {form.kind === "DIGITAL" && full && form.x.dMethod === "EXTERNAL_LINK" ? <Input label="Link to your download" help="Buyers get this link by email after they pay." value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" /> : null}
            <Textarea label="Tell people about it" optional value={form.description} onChange={(e) => set({ description: e.target.value })} />
            <div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="plx-hrow__thumb" style={{ width: 72, height: 72 }}>{form.imageUrl ? <img src={form.imageUrl} alt="" /> : <ImagePlus size={24} aria-hidden />}</span>
                <Button variant="secondary" loading={uploading} leftIcon={<ImagePlus size={18} aria-hidden />} onClick={() => fileRef.current?.click()}>
                  {form.imageUrl ? "Change photo" : "Add a photo"}
                </Button>
              </div>
            </div>
            {full ? <ProductExtras siteId={siteId} kind={form.kind} x={form.x} set={(p) => setForm((f) => (f ? { ...f, x: { ...f.x, ...p } } : f))} categories={categories} currency={currency} setError={setError} basePrice={form.price} /> : null}
            <label className="plx-toggle">
              <span>
                <b>Show it in my shop</b>
                <span className="plx-small" style={{ display: "block" }}>Turn off to hide it for now.</span>
              </span>
              <input type="checkbox" className="plx-switch" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            </label>
            {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
          </div>
        ) : null}
      </Modal>
      {importing === "csv" ? <CsvImportDialog templateId={siteId} onClose={() => setImporting(null)} onImported={() => { setImporting(null); router.refresh(); }} /> : null}
      {importing === "sol" ? <AiImportDialog templateId={siteId} onClose={() => setImporting(null)} onImported={() => { setImporting(null); router.refresh(); }} /> : null}
      {sellTarget ? <SellProductModal siteId={siteId} product={sellTarget} onClose={() => setSellTarget(null)} /> : null}
    </>
  );
}
