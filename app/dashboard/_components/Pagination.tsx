"use client";

import Link from "next/link";
import { PAGE_SIZE_OPTIONS, pageWindow } from "@/lib/pagination";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  /** Client-fetched lists: handle the change yourself. */
  onChange?: (next: { page: number; pageSize: number }) => void;
  /** Server-rendered lists: the page's own path (e.g. "/dashboard/marketplace/payouts"); each page becomes a link with ?page=&pageSize=. */
  basePath?: string;
  /** Other query params to keep in those links (a filter, a search). */
  keepParams?: Record<string, string | undefined>;
  /** What the rows are called: "orders", "messages". */
  noun?: string;
  disabled?: boolean;
};

const btn = (active: boolean, off: boolean): React.CSSProperties => ({
  minWidth: 34, height: 34, padding: "0 0.6rem", display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: 8, fontSize: "0.8rem", fontWeight: active ? 800 : 600, fontFamily: "inherit", textDecoration: "none",
  border: active ? "1px solid var(--brand)" : "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)",
  background: active ? "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 16%, transparent)" : "color-mix(in srgb, var(--plx-text, #fff) 3%, transparent)",
  color: active ? "var(--plx-link, var(--brand))" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 75%, transparent)", cursor: off ? "default" : "pointer", opacity: off ? 0.4 : 1,
});

/** "Showing 26–50 of 312" with Previous / numbered pages / Next and a page-size choice. Renders nothing for an empty list. */
export function Pagination({ page, pageSize, total, onChange, basePath, keepParams, noun = "items", disabled }: Props) {
  if (total === 0) return null;
  const hrefFor = basePath === undefined ? undefined : (next: { page: number; pageSize: number }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keepParams ?? {})) if (v) q.set(k, v);
    q.set("page", String(next.page));
    q.set("pageSize", String(next.pageSize));
    return `${basePath}?${q.toString()}`;
  };
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  function go(next: { page: number; pageSize: number }, label: string, active: boolean, off: boolean, key: string) {
    const style = btn(active, off || !!disabled);
    if (off || disabled || active) {
      return (
        <span key={key} role="button" aria-disabled="true" aria-current={active ? "page" : undefined} aria-label={label} style={style}>
          {key === "prev" ? "‹ Previous" : key === "next" ? "Next ›" : next.page}
        </span>
      );
    }
    const content = key === "prev" ? "‹ Previous" : key === "next" ? "Next ›" : next.page;
    if (hrefFor) return <Link key={key} href={hrefFor(next)} aria-label={label} style={style} scroll={false}>{content}</Link>;
    return <button key={key} type="button" aria-label={label} style={style} onClick={() => onChange?.(next)}>{content}</button>;
  }

  return (
    <nav aria-label="Pages" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginTop: "1rem" }}>
      <span style={{ fontSize: "0.8rem", color: "var(--plx-muted, rgba(240,242,255,0.55))" }}>
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
        {go({ page: current - 1, pageSize }, "Previous page", false, current <= 1, "prev")}
        {pageWindow(current, pageCount).map((p, i) =>
          p === null ? <span key={`gap${i}`} aria-hidden="true" style={{ padding: "0 0.25rem", color: "var(--plx-muted, rgba(240,242,255,0.4))" }}>…</span>
            : go({ page: p, pageSize }, `Page ${p}`, p === current, false, `p${p}`),
        )}
        {go({ page: current + 1, pageSize }, "Next page", false, current >= pageCount, "next")}
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.5rem", fontSize: "0.78rem", color: "var(--plx-muted, rgba(240,242,255,0.55))" }}>
          Per page
          <select
            value={pageSize}
            disabled={disabled}
            onChange={(e) => {
              const next = { page: 1, pageSize: Number(e.target.value) };
              if (hrefFor) window.location.assign(hrefFor(next));
              else onChange?.(next);
            }}
            style={{ height: 34, borderRadius: 8, border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)", background: "color-mix(in srgb, var(--plx-text, #fff) 4%, transparent)", color: "var(--plx-text, #f0f2ff)", fontSize: "0.8rem", fontFamily: "inherit", padding: "0 0.4rem" }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n} style={{ color: "#000" }}>{n}</option>)}
          </select>
        </label>
      </div>
    </nav>
  );
}
