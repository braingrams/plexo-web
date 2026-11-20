"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, FileSpreadsheet, Package, Plus, Rocket, SlidersHorizontal } from "lucide-react";
import { Button, EmptyState, Input, Modal, SegmentedControl, Select, Textarea, useToast } from "../ui";
import type { HubProduct } from "@/lib/dashboardV3/hubData";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";
import { BLANK_EXTRAS, DeliveryPanel, DiscountsPanel, ProductExtras, extrasFromProduct, extrasPayload, type Extras } from "./ProductTools";
import { readProductsView, resolveProductsView, saveProductsView, type ProductsView } from "@/lib/dashboardV3/hubView";
import { joinImages, plural, splitImages } from "@/lib/dashboardV3/productList";
import { ProductBrowser, type BulkAction } from "./ProductBrowser";
import { ProductImages, RelatedPicker } from "./ProductMedia";
import type { Experience } from "@/lib/dashboardV3/nav";
import { CsvImportDialog } from "@/app/dashboard/commerce/[templateId]/products/CsvImportDialog";
import { AiImportDialog } from "@/app/dashboard/commerce/[templateId]/products/AiImportDialog";
import { SellProductModal } from "@/app/dashboard/commerce/[templateId]/products/SellProductModal";
import "@/app/dashboard/commerce/_components/cmx.css";
import { GateOrError } from "../../_components/UpgradePrompt";

type Form = { id?: string; name: string; price: string; kind: HubProduct["kind"]; description: string; stock: string; minutes: string; link: string; images: string[]; related: string[]; /** The rest of the product has arrived (so saving can send it all). */ loaded: boolean; /** The detailed fields are showing even in the simple view. */ adv: boolean; active: boolean; x: Extras };
const BLANK: Form = { name: "", price: "", kind: "PHYSICAL", description: "", stock: "", minutes: "60", link: "", images: [], related: [], loaded: true, adv: false, active: true, x: BLANK_EXTRAS };

const KIND_LABEL: Record<HubProduct["kind"], string> = { PHYSICAL: "Something I ship", DIGITAL: "A download", SERVICE: "A service or booking" };

export function ProductsTab({ siteId, products, currency, experience, startNew }: { siteId: string; products: HubProduct[]; currency: string; experience: Experience; /** Open the add form straight away (from "Add a product" on Home or the menu). */ startNew?: "product" | "service" }) {
  const router = useRouter();
  const { show } = useToast();
  const [form, setForm] = useState<Form | null>(startNew === "service" ? { ...BLANK, kind: "SERVICE" } : startNew === "product" ? { ...BLANK } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/commerce/${siteId}/products`;
  const [view, setView] = useState<ProductsView>(() => resolveProductsView(experience, null));
  const [importing, setImporting] = useState<null | "csv" | "sol">(null);
  const [sellTarget, setSellTarget] = useState<{ id: string; name: string } | null>(null);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);
  const [bulkCategory, setBulkCategory] = useState<{ ids: string[]; name: string } | null>(null);
  const [section, setSection] = useState<"products" | "discounts" | "delivery">("products");
  // The owner's own choice (kept on this device) beats the default for their experience.
  useEffect(() => setView(readProductsView(experience)), [experience]);
  const full = view === "full";
  // The detailed fields show in the full view, or when the owner asks for them in this one product (no need to switch views).
  const advOn = full || !!form?.adv;
  const switchView = (v: ProductsView) => {
    setView(v);
    saveProductsView(v);
    if (v === "simple") setSection("products");
  };
  async function bulk(action: BulkAction, ids: string[]) {
    if (!ids.length) return;
    if (action === "category") return setBulkCategory({ ids, name: "" });
    if (action === "delete" && !window.confirm(`Delete ${plural(ids.length, "product")}? They come off your shop and can't be bought. Past orders keep their details.`)) return;
    setBulkBusy(action);
    try {
      // Hiding and deleting use the same calls the old page did ("delete" takes it off the shop and keeps its orders).
      await Promise.all(ids.map((id) => (action === "hide" || action === "delete" ? hubApi(`${base}/${id}`, { method: "DELETE" }) : hubApi(`${base}/${id}`, { method: "PATCH", json: { active: true } }))));
      show({ title: action === "show" ? `${plural(ids.length, "product")} shown in your shop` : action === "hide" ? `${plural(ids.length, "product")} hidden` : `${plural(ids.length, "product")} deleted`, description: action === "hide" ? "They are off your shop now. Select them and tap Show to bring them back." : undefined, tone: "success" });
      router.refresh();
    } catch (e) {
      show({ title: "We couldn't change them all", description: errMsg(e, "Please try again."), tone: "danger" });
      router.refresh();
    } finally {
      setBulkBusy(null);
    }
  }
  async function applyCategory() {
    if (!bulkCategory) return;
    setBulkBusy("category");
    try {
      await Promise.all(bulkCategory.ids.map((id) => hubApi(`${base}/${id}`, { method: "PATCH", json: { category: bulkCategory.name.trim() || null } })));
      show({ title: bulkCategory.name.trim() ? `${plural(bulkCategory.ids.length, "product")} moved to ${bulkCategory.name.trim()}` : `Category cleared on ${plural(bulkCategory.ids.length, "product")}`, tone: "success" });
      setBulkCategory(null);
      router.refresh();
    } catch (e) {
      show({ title: "We couldn't change the category", description: errMsg(e, "Please try again."), tone: "danger" });
    } finally {
      setBulkBusy(null);
    }
  }
  const categories = [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))];

  async function open(p?: HubProduct) {
    setError(null);
    if (!p) return setForm({ ...BLANK });
    setForm({ id: p.id, name: p.name, price: String(p.priceMinor / 100), kind: p.kind, description: p.description ?? "", stock: p.stockQuantity == null ? "" : String(p.stockQuantity), minutes: "60", link: "", images: joinImages(p.imageUrl, []), related: [], loaded: false, adv: false, active: p.active, x: BLANK_EXTRAS });
    // The list is light; fetch the rest of this product so saving never wipes what isn't shown here.
    try {
      const r = await hubApi<{ product: { durationMinutes?: number | null; digitalExternalUrl?: string | null; imageUrl?: string | null; galleryImageUrls?: string[]; relatedProductIds?: string[] } & Record<string, unknown> }>(`${base}/${p.id}`);
      setForm((f) => (f && f.id === p.id ? { ...f, minutes: String(r.product.durationMinutes ?? 60), link: r.product.digitalExternalUrl ?? "", images: joinImages(r.product.imageUrl ?? p.imageUrl, r.product.galleryImageUrls), related: r.product.relatedProductIds ?? [], loaded: true, x: extrasFromProduct(r.product) } : f));
    } catch {}
  }

  async function save() {
    if (!form) return;
    const price = Number(form.price.replace(/,/g, ""));
    if (!form.name.trim()) return setError("Please give your product a name.");
    if (form.price.trim() === "" || !Number.isFinite(price) || price < 0) return setError("Please add a price, like 5000.");
    if (!advOn && form.kind === "DIGITAL" && !form.link.trim()) return setError("Paste the link where buyers get their download.");
    const extra = advOn ? extrasPayload(form.x, form.kind, price) : null;
    if (typeof extra === "string") return setError(extra);
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      priceMinor: extra?.priceMinor ?? Math.round(price * 100),
      imageUrl: splitImages(form.images).imageUrl || null,
      // Only send what we know: if the rest of the product never loaded, saving must not wipe its gallery or "sold together".
      ...(form.loaded ? { galleryImageUrls: splitImages(form.images).galleryImageUrls, relatedProductIds: form.related } : {}),
      active: form.active,
      ...(form.kind === "PHYSICAL" && !(extra && extra.fields.variants) ? { stockQuantity: form.stock.trim() === "" ? 0 : Number(form.stock) || 0 } : {}),
      ...(form.kind === "SERVICE" ? { durationMinutes: Number(form.minutes) || 60 } : {}),
      ...(form.kind === "DIGITAL" && !advOn ? { digitalDeliveryMethod: "EXTERNAL_LINK", digitalExternalUrl: form.link.trim() } : {}),
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
        </div>
      ) : null}
      {full && section === "discounts" ? <DiscountsPanel siteId={siteId} currency={currency} /> : full && section === "delivery" ? <DeliveryPanel siteId={siteId} currency={currency} /> : products.length === 0 ? (
        <EmptyState title="Add your first product" body="A name, a price and a photo is all it takes. Your shop, basket and checkout are already set up for you." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => open()}>Add a product</Button>} illustration={<Package size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : (
        <ProductBrowser products={products} currency={currency} onOpen={open} onBulk={bulk} bulkBusy={bulkBusy} />
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        width={advOn ? 680 : 560}
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
            {form.kind === "PHYSICAL" && !(advOn && form.x.hasOptions) ? <Input label="How many do you have?" inputMode="numeric" value={form.stock} onChange={(e) => set({ stock: e.target.value })} placeholder="20" /> : null}
            {form.kind === "SERVICE" ? <Input label="How long does it take (minutes)?" inputMode="numeric" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} /> : null}
            {form.kind === "DIGITAL" && !advOn ? <Input label="Link to your download" help="Buyers get this link by email after they pay." value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" /> : null}
            {form.kind === "DIGITAL" && advOn && form.x.dMethod === "EXTERNAL_LINK" ? <Input label="Link to your download" help="Buyers get this link by email after they pay." value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" /> : null}
            <Textarea label="Tell people about it" optional value={form.description} onChange={(e) => set({ description: e.target.value })} />
            <ProductImages images={form.images} onChange={(images) => set({ images })} onError={setError} />
            {advOn ? <ProductExtras siteId={siteId} kind={form.kind} x={form.x} set={(p) => setForm((f) => (f ? { ...f, x: { ...f.x, ...p } } : f))} categories={categories} currency={currency} setError={setError} basePrice={form.price} /> : null}
            <RelatedPicker options={products.filter((p) => p.id !== form.id)} chosen={form.related} onChange={(related) => set({ related })} />
            {!full ? (
              <Button variant="ghost" size="sm" className="plx-adv-toggle" aria-expanded={form.adv} leftIcon={form.adv ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />} onClick={() => set({ adv: !form.adv })}>
                {form.adv ? "Hide advanced settings" : "Show advanced settings"}
              </Button>
            ) : null}
            <label className="plx-toggle">
              <span>
                <b>Show it in my shop</b>
                <span className="plx-small" style={{ display: "block" }}>Turn off to hide it for now.</span>
              </span>
              <input type="checkbox" className="plx-switch" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            </label>
            <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError>
          </div>
        ) : null}
      </Modal>
      <Modal open={!!bulkCategory} onClose={() => setBulkCategory(null)} title="Change category" description={bulkCategory ? `For ${plural(bulkCategory.ids.length, "product")}. Leave it empty to take them out of any category.` : undefined} footer={<><Button variant="secondary" onClick={() => setBulkCategory(null)}>Cancel</Button><Button loading={bulkBusy === "category"} onClick={applyCategory}>Save</Button></>}>
        {bulkCategory ? (
          <div className="plx-form">
            <Input label="Category" list="plx-bulk-cats" value={bulkCategory.name} onChange={(e) => setBulkCategory({ ...bulkCategory, name: e.target.value })} placeholder="Spices" autoComplete="off" />
            <datalist id="plx-bulk-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        ) : null}
      </Modal>
      {importing === "csv" ? <CsvImportDialog templateId={siteId} onClose={() => setImporting(null)} onImported={() => { setImporting(null); router.refresh(); }} /> : null}
      {importing === "sol" ? <AiImportDialog templateId={siteId} onClose={() => setImporting(null)} onImported={() => { setImporting(null); router.refresh(); }} /> : null}
      {sellTarget ? <SellProductModal siteId={siteId} product={sellTarget} onClose={() => setSellTarget(null)} /> : null}
    </>
  );
}
