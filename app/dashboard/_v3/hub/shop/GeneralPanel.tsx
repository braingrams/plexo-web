"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge, Button, Input } from "../../ui";
import { SUPPORTED_STORE_CURRENCIES } from "@/lib/commerce/currency";
import type { CommerceButtonRadius, CommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { ColorSwatchPicker } from "@/app/dashboard/templates/[id]/ColorSwatchPicker";
import { cleanShopAddress, emailProblem, shopAddressProblem } from "@/lib/commerce/shopSettingsForm";
import { ProductPagePicker } from "./ProductPagePicker";
import { Group, SaveBar, Switch, putSettings, useSettingsForm } from "./useSettingsForm";

export type GeneralInitial = {
  siteName: string;
  enabled: boolean;
  currency: string;
  storefrontSlug: string | null;
  notificationEmail: string;
  hasOrders: boolean;
  productDetailLayout: { templateId: string; ready: boolean } | null;
  themeAccentColor: string | null;
  themeButtonRadius: CommerceButtonRadius | null;
  autoDetectedTheme: CommerceTheme | null;
};

const SHAPES: { id: CommerceButtonRadius; label: string; radius: string }[] = [
  { id: "sharp", label: "Square", radius: "4px" },
  { id: "rounded", label: "Rounded", radius: "12px" },
  { id: "pill", label: "Pill", radius: "999px" },
];

type V = { name: string; enabled: boolean; currency: string; slug: string; email: string; accent: string | null; radius: CommerceButtonRadius | null };

/** Shop settings, General: is the shop on, its name and address, money, who gets order alerts, and how its buttons look. */
export function GeneralPanel({ templateId, initial }: { templateId: string; initial: GeneralInitial }) {
  const router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  const start: V = { name: initial.siteName, enabled: initial.enabled, currency: initial.currency, slug: initial.storefrontSlug ?? "", email: initial.notificationEmail, accent: initial.themeAccentColor, radius: initial.themeButtonRadius };

  const form = useSettingsForm<V>(start, async (v) => {
    if (!v.name.trim()) return { error: "Give your shop a name. It's how you'll recognise it in Plexo." };
    const mail = emailProblem(v.email);
    if (mail) return { error: mail };
    if (v.enabled && initial.storefrontSlug !== null && v.slug !== (initial.storefrontSlug ?? "")) {
      const bad = shopAddressProblem(v.slug);
      if (bad) return { error: bad };
    }
    if (v.name.trim() !== initial.siteName) {
      const r = await fetch(`/api/templates/${templateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name.trim() }) });
      if (!r.ok) return { error: "We couldn't rename your shop. Please try again." };
    }
    const res = await putSettings(templateId, {
      enabled: v.enabled,
      currency: v.currency,
      notificationEmail: v.email.trim(),
      ...(v.enabled && v.slug.trim() ? { storefrontSlug: v.slug.trim() } : {}),
      themeAccentColor: v.accent ?? "",
      themeButtonRadius: v.radius ?? "",
    });
    if (res.error) return { error: res.error };
    setWarning(res.warning ?? null);
    router.refresh();
    return { saved: { ...v, name: v.name.trim(), email: v.email.trim() } };
  });
  const v = form.values;
  const effColor = v.accent ?? initial.autoDetectedTheme?.accentColor ?? "var(--plx-brand)";
  const effRadius = v.radius ?? initial.autoDetectedTheme?.buttonRadius ?? "sharp";

  return (
    <div className="plx-hset" data-tour="shop-general">
      <Group
        title="Your shop"
        help={v.enabled ? "On: customers can add things to their basket and pay." : "Off: nothing can be bought. Your pages stay as they are."}
        status={<Switch label={v.enabled ? "On" : "Off"} checked={v.enabled} onChange={(enabled) => form.patch({ enabled })} />}
      >
        <Input label="Shop name" help="Only you see this. Visitors see what is on your pages." value={v.name} onChange={(e) => form.patch({ name: e.target.value })} />
        {v.enabled && initial.storefrontSlug !== null ? (
          <Input label="Shop page address" help="Where your products are listed, like yoursite.com/shop." value={v.slug} onChange={(e) => form.patch({ slug: cleanShopAddress(e.target.value) })} placeholder="shop" />
        ) : null}
      </Group>

      {v.enabled ? (
        <>
          <Group title="Money" help={initial.hasOrders ? "This can't be changed once you have orders, so past prices stay correct." : "Every price in your shop uses this. Changing it later doesn't convert prices you've already set."}>
            <div className="plx-ccy" role="radiogroup" aria-label="Shop currency">
              {SUPPORTED_STORE_CURRENCIES.map((c) => (
                <button key={c.code} type="button" role="radio" aria-checked={v.currency === c.code} disabled={initial.hasOrders && c.code !== initial.currency} title={c.label} onClick={() => form.patch({ currency: c.code })}>
                  <b>{c.symbol}</b>
                  <span>{c.code}</span>
                </button>
              ))}
            </div>
          </Group>

          <Group title="Who to tell about orders" help="We email this address every time someone buys. Leave it empty to use your account email.">
            <Input label="Email for order alerts" type="email" inputMode="email" value={v.email} onChange={(e) => form.patch({ email: e.target.value })} placeholder="you@example.com" autoComplete="email" />
          </Group>

          <Group title="Product page" help="One design shows every product on its own page. We set up a good one for you." status={initial.productDetailLayout ? <Badge tone={initial.productDetailLayout.ready ? "success" : "warning"}>{initial.productDetailLayout.ready ? "Live" : "Needs a fix"}</Badge> : <Badge tone="warning">Not made yet</Badge>}>
            <ProductPagePicker templateId={templateId} layout={initial.productDetailLayout} />
          </Group>

          <Group title="Buttons and basket" help="They match your site's colours by themselves. Change them only if you want something different.">
            <div className="plx-form">
              <div>
                <b>Button colour</b>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                  <ColorSwatchPicker value={effColor} onChange={(c) => form.patch({ accent: c })} />
                  <span className="plx-small">{v.accent ? "Your own colour" : "Matched to your site"}</span>
                  {v.accent ? <Button size="sm" variant="ghost" onClick={() => form.patch({ accent: null })}>Match my site again</Button> : null}
                </div>
              </div>
              <div>
                <b>Button shape</b>
                <div className="plx-hchips" role="radiogroup" aria-label="Button shape" style={{ marginTop: 8 }}>
                  {SHAPES.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={effRadius === s.id} className="plx-hchip" style={{ borderRadius: s.radius }} onClick={() => form.patch({ radius: s.id })}>{s.label}</button>
                  ))}
                  {v.radius ? <Button size="sm" variant="ghost" onClick={() => form.patch({ radius: null })}>Match my site again</Button> : null}
                </div>
              </div>
            </div>
          </Group>
        </>
      ) : (
        <p className="plx-small">Switch your shop on to choose your currency, order alerts and how your product pages look.</p>
      )}

      {warning ? <div className="plx-inlinemsg" role="status">{warning}</div> : null}
      <SaveBar form={form} />
    </div>
  );
}
