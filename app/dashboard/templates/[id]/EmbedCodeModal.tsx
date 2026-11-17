"use client";

import { useMemo, useState } from "react";
import { contentSnippet, type ContentLayout } from "@/lib/customContent/embed";
import { productMarker } from "@/lib/commerce/embedSnippets";
import { SiteProductPicker } from "../../_components/SiteProductPicker";

/**
 * Generates the exact data-plexo-commerce-* marker markup public/commerce.js's init()
 * looks for (see that file's own render-function attribute reads) — for a non-technical
 * RAW_UPLOAD site owner, this is otherwise something only someone who can read commerce.js
 * itself would know how to hand-write. Commerce still needs to be enabled on this site
 * (Dashboard → Commerce → Settings) for any of these to render anything once pasted;
 * pasting the markup itself works regardless, it just shows nothing until Commerce is on.
 */

type BlockKey = "content_list" | "connect_form" | "shop_grid" | "product" | "cart_summary" | "checkout_flow" | "order_confirmation" | "order_tracking" | "newsletter_signup";

const BLOCKS: { key: BlockKey; label: string; description: string }[] = [
  { key: "content_list", label: "Videos, stories & events", description: "Shows what you post under Content Types — a video gallery, stories or upcoming events. No setup needed on your site's other settings." },
  { key: "connect_form", label: "Connect a form", description: "Sends any form on your page to your Form Submissions inbox. Forms without a destination are connected automatically; this just names the form." },
  { key: "shop_grid", label: "Shop grid", description: "A grid of products visitors can add to cart." },
  { key: "product", label: "Sell one product", description: "A card with a Buy now button. Visitors pay right on your page, and every purchase is recorded as an order in Commerce." },
  { key: "cart_summary", label: "Cart summary", description: "Line items + subtotal — put this on your checkout page." },
  { key: "checkout_flow", label: "Checkout form", description: "Delivery details + payment — put this on your checkout page too." },
  { key: "order_confirmation", label: "Order confirmation", description: "Shows the order a customer just paid for." },
  { key: "order_tracking", label: "Order tracking", description: "Lets a customer look up an order by number + email." },
  { key: "newsletter_signup", label: "Newsletter signup", description: "An email capture box." },
];

function buildSnippet(block: BlockKey, opts: { productId: string; category: string; limit: string; itemsPerRow: string; contentSlug: string; contentLayout: ContentLayout; formName: string }): string {
  switch (block) {
    case "content_list":
      return contentSnippet(opts.contentSlug.trim().toLowerCase() || "videos", { layout: opts.contentLayout, limit: Number(opts.limit) || undefined });
    case "connect_form":
      return `<form data-plexo-form="${opts.formName.replace(/"/g, "") || "Contact"}">\n  <input name="name" placeholder="Your name" required>\n  <input name="email" type="email" placeholder="Your email" required>\n  <textarea name="message" placeholder="Message"></textarea>\n  <button type="submit">Send</button>\n</form>`;
    case "shop_grid": {
      const attrs = [
        opts.category ? `data-plexo-commerce-category="${opts.category}"` : null,
        opts.limit ? `data-plexo-commerce-limit="${opts.limit}"` : null,
        `data-plexo-commerce-items-per-row="${opts.itemsPerRow || "3"}"`,
      ].filter(Boolean).join(" ");
      return `<div data-plexo-commerce-shopGrid ${attrs}></div>`;
    }
    case "product":
      return opts.productId ? productMarker(opts.productId) : "Choose a product above and its snippet appears here.";
    case "cart_summary":
      return `<div data-plexo-commerce-cartSummary></div>`;
    case "checkout_flow":
      return `<div data-plexo-commerce-checkoutFlow></div>`;
    case "order_confirmation":
      return `<div data-plexo-commerce-orderConfirmation></div>`;
    case "order_tracking":
      return `<div data-plexo-commerce-orderTracking></div>`;
    case "newsletter_signup":
      return `<div data-plexo-newsletter-signup></div>`;
  }
}

type EmbedCodeModalProps = {
  onClose: () => void;
  /** The site (home page id) — lets "Sell one product" list your products to pick from. */
  siteId?: string;
  /** The page being edited, so "Add it to my page for me" knows where to put the product. */
  pageId?: string;
  /** Whether adding to the page for the owner is safe right now (false while this page has unsaved edits open). */
  canAddForMe?: boolean;
  /** Called after a product was added to the page for the owner, so the editor can show it. */
  onAdded?: () => void;
};

export function EmbedCodeModal({ onClose, siteId, pageId, canAddForMe = true, onAdded }: EmbedCodeModalProps) {
  const [block, setBlock] = useState<BlockKey>("content_list");
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [itemsPerRow, setItemsPerRow] = useState("3");
  const [contentSlug, setContentSlug] = useState("videos");
  const [contentLayout, setContentLayout] = useState<ContentLayout>("gallery");
  const [formName, setFormName] = useState("Contact");
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ ok: boolean; message: string; warnings: string[] } | null>(null);

  const snippet = useMemo(
    () => buildSnippet(block, { productId, category, limit, itemsPerRow, contentSlug, contentLayout, formName }),
    [block, productId, category, limit, itemsPerRow, contentSlug, contentLayout, formName],
  );

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const active = BLOCKS.find((b) => b.key === block)!;

  async function addForMe() {
    if (!siteId || !productId) return;
    setAdding(true);
    setAddResult(null);
    try {
      const res = await fetch(`/api/v1/commerce/${siteId}/products/${productId}/sell`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setAddResult({ ok: false, message: data.error || "We couldn't add it. Please try again.", warnings: [] });
      else {
        setAddResult({ ok: true, message: data.message, warnings: data.warnings ?? [] });
        onAdded?.();
      }
    } catch {
      setAddResult({ ok: false, message: "We couldn't add it. Check your connection and try again.", warnings: [] });
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--plx-overlay, rgba(0,0,0,0.5))", backdropFilter: "blur(4px)", zIndex: 9998 }} />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "100%", maxWidth: "580px", maxHeight: "85vh", overflowY: "auto",
          background: "var(--ed-panel)", backdropFilter: "blur(20px)",
          border: "1px solid var(--ed-w-080)", borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 9999,
          padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1.25rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--ed-text)", margin: 0 }}>Add to a page</h3>
            <p style={{ fontSize: "0.78rem", color: "var(--ed-t-450)", margin: "0.3rem 0 0" }}>
              Copy this snippet into your HTML anywhere you want it to appear. Works in the visual builder (an HTML block), raw HTML pages and React projects. Shop blocks need Commerce enabled.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ed-t-400)", fontSize: "1.2rem", lineHeight: 1, padding: "0.2rem" }}>
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {BLOCKS.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setBlock(b.key)}
              style={{
                padding: "0.4rem 0.75rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600,
                background: block === b.key ? "color-mix(in srgb, var(--brand) 14%, transparent)" : "var(--ed-w-030)",
                border: block === b.key ? "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" : "1px solid var(--ed-w-080)",
                color: block === b.key ? "var(--ed-accent-text)" : "var(--ed-t-650)", cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--ed-t-400)", margin: 0 }}>{active.description}</p>

        {block === "content_list" && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Content name (as in Content Types)</label>
              <input type="text" value={contentSlug} onChange={(e) => setContentSlug(e.target.value)} placeholder="videos" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Look</label>
              <select value={contentLayout} onChange={(e) => setContentLayout(e.target.value as ContentLayout)} style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }}>
                <option value="gallery">Video gallery</option><option value="stories">Story cards</option><option value="events">Upcoming events</option><option value="posts">Latest blog posts (name: blog)</option><option value="list">Simple list</option>
              </select>
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>How many</label>
              <input type="text" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="All" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            </div>
          </div>
        )}

        {block === "connect_form" && (
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Form name (shown in your Form Submissions inbox)</label>
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Contact" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            <p style={{ fontSize: "0.72rem", color: "var(--ed-t-400)", margin: "0.4rem 0 0" }}>Already have a form? Just add <code>data-plexo-form="{formName || "Contact"}"</code> to its opening tag — keep your own fields and styling.</p>
          </div>
        )}

        {block === "product" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block" }}>Which product?</label>
            {siteId ? (
              <SiteProductPicker siteId={siteId} value={productId} onChange={(id) => { setProductId(id); setAddResult(null); }} />
            ) : (
              <p style={{ fontSize: "0.8rem", color: "var(--ed-t-500)", margin: 0 }}>Open this from your site's editor to pick from your products.</p>
            )}
            {siteId && pageId && productId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <button
                  type="button"
                  onClick={() => void addForMe()}
                  disabled={adding || !canAddForMe}
                  style={{ padding: "0.55rem 0.9rem", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, border: "none", color: "var(--ed-on-brand)", background: "var(--ed-cta)", cursor: adding || !canAddForMe ? "default" : "pointer", opacity: adding || !canAddForMe ? 0.6 : 1 }}
                >
                  {adding ? "Adding…" : "Add it to my page for me"}
                </button>
                {!canAddForMe && <p style={{ fontSize: "0.72rem", color: "var(--ed-warning)", margin: 0 }}>Save your changes first, then I can add it for you — or copy the snippet below.</p>}
                {addResult && (
                  <div style={{ fontSize: "0.78rem", lineHeight: 1.5, color: addResult.ok ? "var(--ed-success)" : "var(--ed-danger)" }}>
                    {addResult.message}
                    {addResult.warnings.map((w) => (
                      <p key={w} style={{ margin: "0.3rem 0 0", color: "var(--ed-warning)" }}>{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {block === "shop_grid" && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Category slug (optional)</label>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. tea" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Max items</label>
              <input type="text" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 6" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Columns</label>
              <input type="text" value={itemsPerRow} onChange={(e) => setItemsPerRow(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Snippet to paste</label>
          <div style={{ position: "relative" }}>
            <pre style={{ margin: 0, padding: "0.9rem 1rem", borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid var(--ed-w-080)", fontSize: "0.8rem", color: "var(--ed-lavender)", overflowX: "auto", fontFamily: "ui-monospace, monospace" }}>
              {snippet}
            </pre>
            <button
              type="button"
              onClick={copy}
              style={{
                position: "absolute", top: "0.6rem", right: "0.6rem",
                padding: "0.35rem 0.7rem", borderRadius: 7, fontSize: "0.72rem", fontWeight: 700,
                border: "1px solid color-mix(in srgb, var(--brand) 30%, transparent)", background: "color-mix(in srgb, var(--brand) 12%, transparent)", color: "var(--ed-accent-text)", cursor: "pointer",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
