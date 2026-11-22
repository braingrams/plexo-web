"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, HeartHandshake, Plus, Store, Tag, X } from "lucide-react";
import { contentSnippet, type ContentLayout } from "@/lib/customContent/embed";
import { productMarker } from "@/lib/commerce/embedSnippets";
import { SiteProductPicker } from "../../_components/SiteProductPicker";

export type BlockKey =
  | "donation_form"
  | "shop_grid"
  | "product"
  | "connect_form"
  | "newsletter_signup"
  | "content_list"
  | "cart_summary"
  | "checkout_flow"
  | "order_confirmation"
  | "order_tracking";

type BlockDef = {
  key: BlockKey;
  label: string;
  intent: string;
  description: string;
  category: "popular" | "commerce_extra";
};

const BLOCKS: BlockDef[] = [
  {
    key: "donation_form",
    label: "Donation form",
    intent: "I want to accept donations",
    description: "Supporters can choose one-time or monthly gifts and pay securely via Stripe, Paystack or bank transfer.",
    category: "popular",
  },
  {
    key: "shop_grid",
    label: "Shop grid",
    intent: "I want to embed a shop grid here",
    description: "Shows your products in an interactive grid with pictures, prices, and Add to Cart buttons.",
    category: "popular",
  },
  {
    key: "product",
    label: "Sell one product",
    intent: "I want to sell one product here",
    description: "A card with a direct Buy Now button. Visitors pay right on your page, and purchases are recorded in Commerce.",
    category: "popular",
  },
  {
    key: "connect_form",
    label: "Contact or custom form",
    intent: "I want to collect form submissions",
    description: "Sends any form submissions to your site's Form Submissions inbox. Keep your own styling or use the ready-made template.",
    category: "popular",
  },
  {
    key: "newsletter_signup",
    label: "Newsletter signup",
    intent: "I want an email newsletter signup",
    description: "An email capture box that saves subscribers to your MailDrip newsletter group.",
    category: "popular",
  },
  {
    key: "content_list",
    label: "Videos, stories & events",
    intent: "I want dynamic content (videos, stories, events)",
    description: "Shows what you post under Content Types — a video gallery, stories, or upcoming events.",
    category: "popular",
  },
  {
    key: "cart_summary",
    label: "Cart summary",
    intent: "I want a cart summary",
    description: "Line items + subtotal. Put this on your custom checkout page.",
    category: "commerce_extra",
  },
  {
    key: "checkout_flow",
    label: "Checkout form",
    intent: "I want a checkout form",
    description: "Delivery details + payment inputs for a multi-page custom store flow.",
    category: "commerce_extra",
  },
  {
    key: "order_confirmation",
    label: "Order confirmation",
    intent: "I want an order confirmation block",
    description: "Shows order receipt details to a customer after successful payment.",
    category: "commerce_extra",
  },
  {
    key: "order_tracking",
    label: "Order tracking",
    intent: "I want order tracking",
    description: "Lets a customer look up their order status by order number and email.",
    category: "commerce_extra",
  },
];

function buildSnippet(
  block: BlockKey,
  opts: {
    campaignId: string;
    productId: string;
    category: string;
    limit: string;
    itemsPerRow: string;
    contentSlug: string;
    contentLayout: ContentLayout;
    formName: string;
  },
): string {
  switch (block) {
    case "donation_form":
      return `<div data-plexo-donation="${opts.campaignId || "default"}"></div>`;
    case "shop_grid": {
      const attrs = [
        opts.category ? `data-plexo-commerce-category="${opts.category}"` : null,
        opts.limit ? `data-plexo-commerce-limit="${opts.limit}"` : null,
        `data-plexo-commerce-items-per-row="${opts.itemsPerRow || "3"}"`,
      ]
        .filter(Boolean)
        .join(" ");
      return `<div data-plexo-commerce-shopGrid ${attrs}></div>`;
    }
    case "product":
      return opts.productId ? productMarker(opts.productId) : "Choose a product above and its snippet appears here.";
    case "connect_form":
      return `<form data-plexo-form="${opts.formName.replace(/"/g, "") || "Contact"}">\n  <input name="name" placeholder="Your name" required>\n  <input name="email" type="email" placeholder="Your email" required>\n  <textarea name="message" placeholder="Message"></textarea>\n  <button type="submit">Send</button>\n</form>`;
    case "newsletter_signup":
      return `<div data-plexo-newsletter-signup></div>`;
    case "content_list":
      return contentSnippet(opts.contentSlug.trim().toLowerCase() || "videos", {
        layout: opts.contentLayout,
        limit: Number(opts.limit) || undefined,
      });
    case "cart_summary":
      return `<div data-plexo-commerce-cartSummary></div>`;
    case "checkout_flow":
      return `<div data-plexo-commerce-checkoutFlow></div>`;
    case "order_confirmation":
      return `<div data-plexo-commerce-orderConfirmation></div>`;
    case "order_tracking":
      return `<div data-plexo-commerce-orderTracking></div>`;
  }
}

type CampaignItem = { id: string; name: string; active?: boolean };

type EmbedCodeModalProps = {
  onClose: () => void;
  siteId?: string;
  pageId?: string;
  canAddForMe?: boolean;
  onAdded?: () => void;
  onInsertSnippet?: (snippet: string) => void;
};

export function EmbedCodeModal({ onClose, siteId, pageId, canAddForMe = true, onAdded, onInsertSnippet }: EmbedCodeModalProps) {
  const [block, setBlock] = useState<BlockKey>("donation_form");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [newCampaignName, setNewCampaignName] = useState("General Support");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [itemsPerRow, setItemsPerRow] = useState("3");
  const [contentSlug, setContentSlug] = useState("videos");
  const [contentLayout, setContentLayout] = useState<ContentLayout>("gallery");
  const [formName, setFormName] = useState("Contact");
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ ok: boolean; message: string; warnings: string[] } | null>(null);

  // Load donation campaigns for this site so the dropdown is auto-filled
  useEffect(() => {
    if (!siteId) return;
    let active = true;
    fetch(`/api/v1/commerce/${siteId}/donations`)
      .then((r) => r.json())
      .then((data) => {
        if (!active || !data || !Array.isArray(data.campaigns)) return;
        setCampaigns(data.campaigns);
        if (data.campaigns.length > 0) {
          const first = data.campaigns[0];
          setCampaignId(first.id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [siteId]);

  async function createDonationCampaign() {
    if (!siteId) return;
    setCreatingCampaign(true);
    try {
      const res = await fetch(`/api/v1/commerce/${siteId}/donations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCampaignName.trim() || "General Support",
          allowCustomAmount: true,
          allowMonthly: true,
          presetAmounts: [
            { amountMinor: 2500, label: "$25" },
            { amountMinor: 5000, label: "$50" },
            { amountMinor: 10000, label: "$100" },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.campaign?.id) {
        setCampaigns((prev) => [data.campaign, ...prev]);
        setCampaignId(data.campaign.id);
      }
    } catch {
      // Keep default
    } finally {
      setCreatingCampaign(false);
    }
  }

  const snippet = useMemo(
    () =>
      buildSnippet(block, {
        campaignId,
        productId,
        category,
        limit,
        itemsPerRow,
        contentSlug,
        contentLayout,
        formName,
      }),
    [block, campaignId, productId, category, limit, itemsPerRow, contentSlug, contentLayout, formName],
  );

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleInsert() {
    if (!onInsertSnippet) return;
    onInsertSnippet(snippet);
    setInserted(true);
    setTimeout(() => {
      setInserted(false);
      onClose();
    }, 450);
  }

  const active = BLOCKS.find((b) => b.key === block)!;

  async function addForMe() {
    if (!siteId || !productId) return;
    setAdding(true);
    setAddResult(null);
    try {
      const res = await fetch(`/api/v1/commerce/${siteId}/products/${productId}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
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

  const visibleBlocks = BLOCKS.filter((b) => showAdvanced || b.category === "popular");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--plx-overlay, rgba(0,0,0,0.5))", backdropFilter: "blur(4px)", zIndex: 9998 }} />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "100%",
          maxWidth: "600px",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--ed-panel)",
          backdropFilter: "blur(20px)",
          border: "1px solid var(--ed-w-080)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          zIndex: 9999,
          padding: "1.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.2rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--ed-text)", margin: 0 }}>Add to your page</h3>
            <p style={{ fontSize: "0.83rem", color: "var(--ed-t-450)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
              Choose what you want to place on your website. Insert it directly into the page or copy the snippet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              minWidth: 32,
              borderRadius: 8,
              background: "var(--ed-w-030)",
              border: "1px solid var(--ed-w-080)",
              cursor: "pointer",
              color: "var(--ed-t-500)",
              transition: "all 0.15s ease",
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Action pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          {visibleBlocks.map((b) => {
            const isSelected = block === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setBlock(b.key)}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: 999,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  background: isSelected ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "var(--ed-w-030)",
                  border: isSelected ? "1px solid color-mix(in srgb, var(--brand) 45%, transparent)" : "1px solid var(--ed-w-080)",
                  color: isSelected ? "var(--ed-accent-text)" : "var(--ed-t-650)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {b.label}
              </button>
            );
          })}
          {!showAdvanced && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              style={{
                padding: "0.45rem 0.75rem",
                borderRadius: 999,
                fontSize: "0.76rem",
                fontWeight: 600,
                background: "none",
                border: "1px dashed var(--ed-w-100)",
                color: "var(--ed-t-450)",
                cursor: "pointer",
              }}
            >
              + More checkout widgets
            </button>
          )}
        </div>

        {/* Selected intent explanation */}
        <div style={{ padding: "0.75rem 1rem", borderRadius: 10, background: "var(--ed-w-030)", border: "1px solid var(--ed-w-060)" }}>
          <strong style={{ fontSize: "0.85rem", color: "var(--ed-text)", display: "block" }}>{active.intent}</strong>
          <p style={{ fontSize: "0.8rem", color: "var(--ed-t-500)", margin: "0.25rem 0 0", lineHeight: 1.45 }}>{active.description}</p>
        </div>

        {/* Block specific configuration */}
        {block === "donation_form" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {campaigns.length > 0 ? (
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>
                  Which donation form?
                </label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.75rem",
                    borderRadius: 8,
                    fontSize: "0.84rem",
                    border: "1px solid var(--ed-w-100)",
                    background: "var(--ed-w-030)",
                    color: "var(--ed-text)",
                    fontFamily: "inherit",
                  }}
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>
                    Donation form name
                  </label>
                  <input
                    type="text"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="General Support"
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.7rem",
                      borderRadius: 8,
                      fontSize: "0.82rem",
                      border: "1px solid var(--ed-w-100)",
                      background: "var(--ed-w-030)",
                      color: "var(--ed-text)",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                {siteId && (
                  <button
                    type="button"
                    onClick={() => void createDonationCampaign()}
                    disabled={creatingCampaign}
                    style={{
                      padding: "0.55rem 0.9rem",
                      borderRadius: 8,
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      background: "var(--ed-cta)",
                      color: "var(--ed-on-brand)",
                      border: "none",
                      cursor: creatingCampaign ? "default" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {creatingCampaign ? "Creating…" : "Create & select"}
                  </button>
                )}
              </div>
            )}
            <p style={{ fontSize: "0.74rem", color: "var(--ed-t-400)", margin: 0, lineHeight: 1.45 }}>
              Plexo automatically hooks up preset buttons, a custom donation amount input, monthly gift toggle, and loads Stripe / Paystack checkout when visitors click donate.
            </p>
          </div>
        )}

        {block === "content_list" && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Content name</label>
              <input
                type="text"
                value={contentSlug}
                onChange={(e) => setContentSlug(e.target.value)}
                placeholder="videos"
                style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }}
              />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Layout style</label>
              <select
                value={contentLayout}
                onChange={(e) => setContentLayout(e.target.value as ContentLayout)}
                style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }}
              >
                <option value="gallery">Video gallery</option>
                <option value="stories">Story cards</option>
                <option value="events">Upcoming events</option>
                <option value="posts">Latest blog posts</option>
                <option value="list">Simple list</option>
              </select>
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>How many</label>
              <input
                type="text"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="All"
                style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }}
              />
            </div>
          </div>
        )}

        {block === "connect_form" && (
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block", marginBottom: "0.3rem" }}>Form name (shown in Form Submissions inbox)</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Contact"
              style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }}
            />
            <p style={{ fontSize: "0.72rem", color: "var(--ed-t-400)", margin: "0.4rem 0 0" }}>
              Already have your own form in HTML? Just add <code>data-plexo-form=&quot;{formName || "Contact"}&quot;</code> to your <code>&lt;form&gt;</code> tag to keep your exact fields and styles.
            </p>
          </div>
        )}

        {block === "product" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-550)", display: "block" }}>Which product?</label>
            {siteId ? (
              <SiteProductPicker siteId={siteId} value={productId} onChange={(id) => { setProductId(id); setAddResult(null); }} />
            ) : (
              <p style={{ fontSize: "0.8rem", color: "var(--ed-t-500)", margin: 0 }}>Open this from your site&apos;s editor to pick from your products.</p>
            )}
            {siteId && pageId && productId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <button
                  type="button"
                  onClick={() => void addForMe()}
                  disabled={adding || !canAddForMe}
                  style={{
                    padding: "0.55rem 0.9rem",
                    borderRadius: 9,
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    border: "none",
                    color: "var(--ed-on-brand)",
                    background: "var(--ed-cta)",
                    cursor: adding || !canAddForMe ? "default" : "pointer",
                    opacity: adding || !canAddForMe ? 0.6 : 1,
                  }}
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
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. merch" style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", fontFamily: "inherit" }} />
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

        {/* Snippet display and action buttons */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ed-t-650)", margin: 0 }}>Code snippet</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {onInsertSnippet && (
                <button
                  type="button"
                  onClick={handleInsert}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0.4rem 0.85rem",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    border: "none",
                    background: inserted ? "var(--ed-success, #22c55e)" : "var(--ed-cta)",
                    color: "var(--ed-on-brand)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {inserted ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                  {inserted ? "Inserted!" : "Insert into page"}
                </button>
              )}
              <button
                type="button"
                onClick={copy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0.4rem 0.8rem",
                  borderRadius: 8,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)",
                  background: copied ? "color-mix(in srgb, var(--ed-success, #22c55e) 15%, transparent)" : "color-mix(in srgb, var(--brand) 14%, transparent)",
                  color: copied ? "var(--ed-success, #22c55e)" : "var(--ed-accent-text)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>
          </div>
          <div style={{ borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid var(--ed-w-080)", overflow: "hidden" }}>
            <pre
              style={{
                margin: 0,
                padding: "0.9rem 1rem",
                fontSize: "0.82rem",
                lineHeight: 1.5,
                color: "var(--ed-lavender)",
                overflowX: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {snippet}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
}
