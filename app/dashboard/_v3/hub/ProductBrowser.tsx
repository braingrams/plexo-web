"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Eye, EyeOff, LayoutGrid, List, Package, Tag, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input, SegmentedControl } from "../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { HubProduct } from "@/lib/dashboardV3/hubData";
import { filterProducts, type StockFilter } from "@/lib/dashboardV3/productFilter";
import { PRODUCTS_PAGE_SIZE, paginate, pageSelection, plural, pruneSelection, readProductsLayout, saveProductsLayout, stockInfo, toggleId, togglePage, type ProductsLayout } from "@/lib/dashboardV3/productList";

export type BulkAction = "hide" | "show" | "delete" | "category";

const KIND_LABEL: Record<HubProduct["kind"], string> = { PHYSICAL: "Something I ship", DIGITAL: "A download", SERVICE: "A service or booking" };

function StatusBadges({ p }: { p: HubProduct }) {
  const s = stockInfo(p);
  return (
    <span className="plx-pstatus">
      {!p.active ? <Badge>Hidden</Badge> : null}
      <Badge tone={s.soldOut ? "warning" : "success"}>{s.badge}</Badge>
    </span>
  );
}

/**
 * The shop's products as a grid or a list, with search, pages, and a "select several" mode that shows a real
 * checkbox on every product for hiding, showing, deleting or moving them to a category in one go.
 */
export function ProductBrowser({ products, currency, onOpen, onBulk, bulkBusy }: { products: HubProduct[]; currency: string; onOpen: (p: HubProduct) => void; onBulk: (action: BulkAction, ids: string[]) => void; bulkBusy?: BulkAction | null }) {
  const [layout, setLayout] = useState<ProductsLayout>("grid");
  const [search, setSearch] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [page, setPage] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // The owner's own choice (kept on this device) beats the default.
  useEffect(() => setLayout(readProductsLayout()), []);
  const switchLayout = (l: ProductsLayout) => {
    setLayout(l);
    saveProductsLayout(l);
  };

  const filtered = useMemo(() => filterProducts(products, search, stock), [products, search, stock]);
  const paged = paginate(filtered, page, PRODUCTS_PAGE_SIZE);
  const pageIds = paged.items.map((p) => p.id);
  // A product that was deleted, or filtered out of the pages, can't stay chosen.
  useEffect(() => setChosen((c) => pruneSelection(c, products.map((p) => p.id))), [products]);
  useEffect(() => {
    if (page !== paged.page) setPage(paged.page);
  }, [page, paged.page]);

  const sel = pageSelection(chosen, pageIds);
  const stopSelecting = () => {
    setSelecting(false);
    setChosen(new Set());
  };
  const pick = (p: HubProduct) => (selecting ? setChosen((c) => toggleId(c, p.id)) : onOpen(p));
  const ids = [...chosen];
  const showSearch = products.length > 4;

  return (
    <div className="plx-pbrowse">
      <div className="plx-toolbar">
        {showSearch ? <Input label="Search your products" hideLabel type="search" fieldClassName="plx-hsearch" placeholder="Search your products" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /> : <span />}
        <div className="plx-ptools">
          {showSearch ? <SegmentedControl label="Show" value={stock} onChange={(v) => { setStock(v); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "in", label: "In stock" }, { value: "out", label: "Out of stock" }]} /> : null}
          <SegmentedControl label="How to show your products" value={layout} onChange={switchLayout} options={[{ value: "grid", label: "Grid", icon: <LayoutGrid size={16} aria-hidden /> }, { value: "list", label: "List", icon: <List size={16} aria-hidden /> }]} />
          {products.length > 1 ? (
            <Button variant={selecting ? "primary" : "secondary"} size="sm" leftIcon={<CheckSquare size={16} aria-hidden />} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              {selecting ? "Done" : "Select several"}
            </Button>
          ) : null}
        </div>
      </div>

      {selecting ? (
        <div className="plx-bulkbar" role="region" aria-label="Actions for the products you chose">
          <label className="plx-check">
            <input type="checkbox" checked={sel === "all"} ref={(el) => { if (el) el.indeterminate = sel === "some"; }} onChange={() => setChosen((c) => togglePage(c, pageIds))} />
            <span>Select all on this page</span>
          </label>
          <span className="plx-bulkbar__n" aria-live="polite">{chosen.size ? `${chosen.size} chosen` : "Tick the products you want to change."}</span>
          <div className="plx-bulkbar__btns">
            <Button size="sm" variant="secondary" leftIcon={<EyeOff size={16} aria-hidden />} disabled={!chosen.size} loading={bulkBusy === "hide"} onClick={() => onBulk("hide", ids)}>Hide</Button>
            <Button size="sm" variant="secondary" leftIcon={<Eye size={16} aria-hidden />} disabled={!chosen.size} loading={bulkBusy === "show"} onClick={() => onBulk("show", ids)}>Show</Button>
            <Button size="sm" variant="secondary" leftIcon={<Tag size={16} aria-hidden />} disabled={!chosen.size} loading={bulkBusy === "category"} onClick={() => onBulk("category", ids)}>Change category</Button>
            <Button size="sm" variant="danger" leftIcon={<Trash2 size={16} aria-hidden />} disabled={!chosen.size} loading={bulkBusy === "delete"} onClick={() => onBulk("delete", ids)}>Delete</Button>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <Card><p className="plx-small">Nothing matches that. Try another word, or show all your products.</p></Card>
      ) : layout === "grid" ? (
        <ul className="plx-pgrid">
          {paged.items.map((p) => {
            const on = chosen.has(p.id);
            return (
              <li key={p.id} className="plx-pcard" data-chosen={on || undefined}>
                {selecting ? (
                  <label className="plx-pcard__check plx-check">
                    <input type="checkbox" checked={on} onChange={() => setChosen((c) => toggleId(c, p.id))} aria-label={`Choose ${p.name}`} />
                  </label>
                ) : null}
                <button type="button" className="plx-pcard__open" onClick={() => pick(p)} aria-label={selecting ? undefined : `Change ${p.name}`}>
                  <span className="plx-pcard__img">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Package size={32} aria-hidden />}</span>
                  <span className="plx-pcard__body">
                    <span className="plx-pcard__name">{p.name}</span>
                    <span className="plx-pcard__meta">{p.category ?? KIND_LABEL[p.kind]}</span>
                    <span className="plx-pcard__foot">
                      <b className="plx-hrow__price">{formatMoney(p.priceMinor, currency)}</b>
                      <StatusBadges p={p} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card padding="none" className="plx-listcard">
          <div className="plx-plist__head" aria-hidden data-selecting={selecting || undefined}>
            <span />
            <span>Product</span>
            <span>Category</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Status</span>
          </div>
          <ul className="plx-list">
            {paged.items.map((p) => {
              const on = chosen.has(p.id);
              const s = stockInfo(p);
              return (
                <li key={p.id} className="plx-plist__row" data-chosen={on || undefined} data-selecting={selecting || undefined}>
                  {selecting ? (
                    <label className="plx-check plx-plist__check">
                      <input type="checkbox" checked={on} onChange={() => setChosen((c) => toggleId(c, p.id))} aria-label={`Choose ${p.name}`} />
                    </label>
                  ) : null}
                  <button type="button" className="plx-plist__open" onClick={() => pick(p)} aria-label={selecting ? undefined : `Change ${p.name}`}>
                    <span className="plx-hrow__thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Package size={22} aria-hidden />}</span>
                    <span className="plx-hrow__main">
                      <span className="plx-hrow__title">{p.name}</span>
                      <span className="plx-hrow__sub">{KIND_LABEL[p.kind]}</span>
                    </span>
                    <span className="plx-plist__cat">{p.category ?? "No category"}</span>
                    <span className="plx-hrow__price">{formatMoney(p.priceMinor, currency)}</span>
                    <span className="plx-plist__stock">{s.count != null ? s.count : "Any"}</span>
                    <StatusBadges p={p} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {paged.pages > 1 ? (
        <nav className="plx-hub__bar" aria-label="More products">
          <Button variant="secondary" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>Previous</Button>
          <span className="plx-small">Showing {paged.from}–{paged.to} of {plural(paged.total, "product")} · Page {paged.page} of {paged.pages}</span>
          <Button variant="secondary" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>Next</Button>
        </nav>
      ) : null}
    </div>
  );
}
