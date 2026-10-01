"use client";

import { useMemo, useState } from "react";

/**
 * Generates the exact data-plexo-commerce-* marker markup public/commerce.js's init()
 * looks for (see that file's own render-function attribute reads) — for a non-technical
 * RAW_UPLOAD site owner, this is otherwise something only someone who can read commerce.js
 * itself would know how to hand-write. Commerce still needs to be enabled on this site
 * (Dashboard → Commerce → Settings) for any of these to render anything once pasted;
 * pasting the markup itself works regardless, it just shows nothing until Commerce is on.
 */

type BlockKey = "shop_grid" | "product" | "cart_summary" | "checkout_flow" | "order_confirmation" | "order_tracking" | "newsletter_signup";

const BLOCKS: { key: BlockKey; label: string; description: string }[] = [
  { key: "shop_grid", label: "Shop grid", description: "A grid of products visitors can add to cart." },
  { key: "product", label: "Single product", description: "One specific product's add-to-cart card." },
  { key: "cart_summary", label: "Cart summary", description: "Line items + subtotal — put this on your checkout page." },
  { key: "checkout_flow", label: "Checkout form", description: "Delivery details + payment — put this on your checkout page too." },
  { key: "order_confirmation", label: "Order confirmation", description: "Shows the order a customer just paid for." },
  { key: "order_tracking", label: "Order tracking", description: "Lets a customer look up an order by number + email." },
  { key: "newsletter_signup", label: "Newsletter signup", description: "An email capture box." },
];

function buildSnippet(block: BlockKey, opts: { productId: string; category: string; limit: string; itemsPerRow: string }): string {
  switch (block) {
    case "shop_grid": {
      const attrs = [
        opts.category ? `data-plexo-commerce-category="${opts.category}"` : null,
        opts.limit ? `data-plexo-commerce-limit="${opts.limit}"` : null,
        `data-plexo-commerce-items-per-row="${opts.itemsPerRow || "3"}"`,
      ].filter(Boolean).join(" ");
      return `<div data-plexo-commerce-shopGrid ${attrs}></div>`;
    }
    case "product":
      return `<div data-plexo-commerce-product data-plexo-product-id="${opts.productId || "PASTE_PRODUCT_ID_HERE"}"></div>`;
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

export function EmbedCodeModal({ onClose }: { onClose: () => void }) {
  const [block, setBlock] = useState<BlockKey>("shop_grid");
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [itemsPerRow, setItemsPerRow] = useState("3");
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(
    () => buildSnippet(block, { productId, category, limit, itemsPerRow }),
    [block, productId, category, limit, itemsPerRow],
  );

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const active = BLOCKS.find((b) => b.key === block)!;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 9998 }} />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "100%", maxWidth: "580px", maxHeight: "85vh", overflowY: "auto",
          background: "rgba(18,16,36,0.98)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 9999,
          padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1.25rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>Embed a commerce widget</h3>
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 0" }}>
              Copy this snippet into your HTML anywhere you want it to appear. Requires Commerce to be enabled on this site.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.4)", fontSize: "1.2rem", lineHeight: 1, padding: "0.2rem" }}>
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
                background: block === b.key ? "rgba(var(--brand-rgb),0.14)" : "rgba(255,255,255,0.03)",
                border: block === b.key ? "1px solid rgba(var(--brand-rgb),0.35)" : "1px solid rgba(255,255,255,0.08)",
                color: block === b.key ? "var(--brand)" : "rgba(240,242,255,0.65)", cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>{active.description}</p>

        {block === "product" && (
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", display: "block", marginBottom: "0.3rem" }}>
              Product ID (from Commerce → Products, open the product and copy its ID from the URL)
            </label>
            <input
              type="text"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="e.g. 721cda0c-48ef-4542-8fe4-7c367b0688f9"
              style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontFamily: "inherit" }}
            />
          </div>
        )}

        {block === "shop_grid" && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", display: "block", marginBottom: "0.3rem" }}>Category slug (optional)</label>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. tea" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", display: "block", marginBottom: "0.3rem" }}>Max items</label>
              <input type="text" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 6" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", display: "block", marginBottom: "0.3rem" }}>Columns</label>
              <input type="text" value={itemsPerRow} onChange={(e) => setItemsPerRow(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontFamily: "inherit" }} />
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", display: "block", marginBottom: "0.3rem" }}>Snippet to paste</label>
          <div style={{ position: "relative" }}>
            <pre style={{ margin: 0, padding: "0.9rem 1rem", borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", fontSize: "0.8rem", color: "#c4b5fd", overflowX: "auto", fontFamily: "ui-monospace, monospace" }}>
              {snippet}
            </pre>
            <button
              type="button"
              onClick={copy}
              style={{
                position: "absolute", top: "0.6rem", right: "0.6rem",
                padding: "0.35rem 0.7rem", borderRadius: 7, fontSize: "0.72rem", fontWeight: 700,
                border: "1px solid rgba(var(--brand-rgb),0.3)", background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand)", cursor: "pointer",
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
