"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Layers, Mail, Layout, Search, X } from "lucide-react";
import type { MarketplaceListItem } from "@/lib/marketplace";
import { designKindLabel, designPrice, designsHref } from "@/lib/dashboardV3/designs";
import { Badge, Button, ButtonLink, EmptyState, Input, SegmentedControl, Select } from "../ui";
import { DesignPreview } from "./DesignPreview";

type Current = { category?: string; kind?: string; free?: string; q?: string; sort: string };

export function DesignsBrowser({ designs, total, categories, current, page, pageCount }: { designs: MarketplaceListItem[]; total: number; categories: string[]; current: Current; page: number; pageCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(current.q ?? "");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const go = (next: Partial<Current>) => {
    const merged = { ...current, q: search, ...next };
    startTransition(() => router.push(designsHref(merged)));
  };
  const clearAll = () => {
    setSearch("");
    startTransition(() => router.push(designsHref({ sort: current.sort })));
  };

  const kindLabel = current.kind === "LANDING_PAGE" ? "Web pages" : current.kind === "EMAIL" ? "Emails" : null;
  const priceLabel = current.free === "true" ? "Free" : current.free === "false" ? "Paid" : null;
  const chips: { label: string; clear: () => void }[] = [
    ...(current.q ? [{ label: `“${current.q}”`, clear: () => { setSearch(""); go({ q: undefined }); } }] : []),
    ...(kindLabel ? [{ label: kindLabel, clear: () => go({ kind: undefined }) }] : []),
    ...(priceLabel ? [{ label: priceLabel, clear: () => go({ free: undefined }) }] : []),
    ...(current.category ? [{ label: current.category, clear: () => go({ category: undefined }) }] : []),
  ];

  return (
    <div className="plx-dz" data-busy={pending || undefined}>
      <div className="plx-dzbar">
        <div className="plx-dzbar__row">
          <form className="plx-dzbar__search" role="search" onSubmit={(e) => { e.preventDefault(); go({ q: search }); }}>
            <Search size={18} aria-hidden />
            <Input label="Search designs" hideLabel type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, like “restaurant” or “portfolio”" />
          </form>
          <Select
            fieldClassName="plx-dzbar__sel"
            label="Sort by"
            value={current.sort}
            onChange={(e) => go({ sort: e.target.value })}
            options={[{ value: "latest", label: "Newest first" }, { value: "popular", label: "Most used" }]}
          />
          {categories.length > 0 ? (
            <Select
              fieldClassName="plx-dzbar__sel"
              label="Kind of business"
              value={current.category ?? ""}
              onChange={(e) => go({ category: e.target.value || undefined })}
              options={[{ value: "", label: "All kinds of business" }, ...[...categories].sort((a, b) => a.localeCompare(b)).map((c) => ({ value: c, label: c }))]}
            />
          ) : null}
        </div>
        <div className="plx-dzbar__row" style={{ alignItems: "center" }}>
          <SegmentedControl
            label="What it is"
            value={(current.kind === "LANDING_PAGE" || current.kind === "EMAIL" ? current.kind : "all") as "all" | "LANDING_PAGE" | "EMAIL"}
            onChange={(v) => go({ kind: v === "all" ? undefined : v })}
            options={[{ value: "all", label: "All", icon: <Layers size={16} aria-hidden /> }, { value: "LANDING_PAGE", label: "Web pages", icon: <Layout size={16} aria-hidden /> }, { value: "EMAIL", label: "Emails", icon: <Mail size={16} aria-hidden /> }]}
          />
          <SegmentedControl
            label="Price"
            value={(current.free === "true" || current.free === "false" ? current.free : "any") as "any" | "true" | "false"}
            onChange={(v) => go({ free: v === "any" ? undefined : v })}
            options={[{ value: "any", label: "Any price" }, { value: "true", label: "Free" }, { value: "false", label: "Paid" }]}
          />
          <span className="plx-dzbar__count" aria-live="polite">
            {total} {total === 1 ? "design" : "designs"}
          </span>
        </div>
        {chips.length > 0 ? (
          <div className="plx-dzchips">
            {chips.map((c) => (
              <button key={c.label} type="button" className="plx-dzchip" onClick={c.clear} aria-label={`Remove “${c.label}”`}>
                {c.label} <X size={16} aria-hidden />
              </button>
            ))}
            <Button variant="link" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>

      {designs.length === 0 ? (
        <EmptyState
          title="No designs match yet"
          body={chips.length > 0 ? "Try fewer filters or a different word. You can also start from a blank page and make your own." : "New designs are added all the time. Check back soon."}
          action={chips.length > 0 ? <Button onClick={clearAll}>Show all designs</Button> : undefined}
        />
      ) : (
        <ul className="plx-dzgrid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {designs.map((d) => (
            <li key={d.id} className="plx-dzcard">
              <Link href={`/dashboard/marketplace/${d.id}`} className="plx-dzcard__thumb" aria-label={`Open ${d.name}`} tabIndex={-1}>
                {d.compiledHtml ? (
                  <iframe title={`Picture of ${d.name}`} srcDoc={d.compiledHtml} sandbox="" tabIndex={-1} loading="lazy" className="plx-dzcard__frame" />
                ) : (
                  <span className="plx-dzcard__ph">
                    <Layers size={34} aria-hidden />
                  </span>
                )}
                <span className="plx-dzcard__price">
                  <Badge tone={d.priceCents === 0 ? "success" : "neutral"}>{designPrice(d.priceCents)}</Badge>
                </span>
              </Link>
              <div className="plx-dzcard__body">
                <div style={{ minWidth: 0 }}>
                  <h3 className="plx-dzcard__name">
                    <Link href={`/dashboard/marketplace/${d.id}`}>{d.name}</Link>
                  </h3>
                  <p className="plx-dzcard__meta">
                    {designKindLabel(d.kind)}
                    {d.category ? ` · ${d.category}` : ""}
                  </p>
                </div>
                <Button variant="secondary" size="sm" leftIcon={<Eye size={16} aria-hidden />} onClick={() => setPreviewId(d.id)} aria-label={`Preview ${d.name}`}>
                  Preview
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <nav className="plx-dzpager" aria-label="More designs">
          <span>
            Page {page} of {pageCount}
          </span>
          <div>
            {page > 1 ? (
              <ButtonLink variant="secondary" href={designsHref({ ...current, page: page - 1 })} scroll={false}>
                Previous
              </ButtonLink>
            ) : null}
            {page < pageCount ? (
              <ButtonLink variant="secondary" href={designsHref({ ...current, page: page + 1 })} scroll={false}>
                Next
              </ButtonLink>
            ) : null}
          </div>
        </nav>
      ) : null}

      <DesignPreview designId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
