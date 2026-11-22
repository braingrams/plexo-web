"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, MessageCircle, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Input, Select, Textarea } from "../../ui";
import type { CheckoutField, CheckoutFieldType } from "@/lib/commerce/checkoutFields";
import { CHECKOUT_COUNTRIES, checkoutCountryName } from "@/lib/commerce/countries";
import { questionProblem, receiveProblem } from "@/lib/commerce/shopSettingsForm";
import { defaultTerms, termsPromptForSol, termsUrlProblem } from "@/lib/commerce/terms";
import { solStudioHref } from "@/lib/dashboardV3/solStudioLink";
import { Group, SaveBar, Switch, putSettings, useSettingsForm } from "./useSettingsForm";

const MAX_FIELDS = 20;
const TYPE_LABELS: Record<CheckoutFieldType, string> = { text: "Short answer", textarea: "Long answer", select: "Pick from a list", date: "A date", phone: "A phone number" };
const SUGGESTIONS: { label: string; type: CheckoutFieldType; placeholder?: string }[] = [
  { label: "Gift message", type: "textarea", placeholder: "Add a note for the person receiving it" },
  { label: "Preferred delivery date", type: "date" },
  { label: "Nearest landmark", type: "text", placeholder: "e.g. Opposite the filling station" },
  { label: "Another phone number", type: "phone" },
  { label: "How did you hear about us?", type: "text" },
];

type Q = { key: string; id: string; label: string; type: CheckoutFieldType; required: boolean; placeholder: string; optionsText: string; limited: boolean; countries: string[] };
type V = { questions: Q[]; delivery: boolean; pickup: boolean; location: string; instructions: string; terms: string; termsUrl: string; orderSuccessMessage: string; orderEmailSubject: string; orderEmailMessage: string };

let counter = 0;
const draft = (f: Partial<CheckoutField> = {}): Q => ({ key: f.id || `new-${Date.now()}-${++counter}`, id: f.id ?? "", label: f.label ?? "", type: f.type ?? "text", required: f.required ?? false, placeholder: f.placeholder ?? "", optionsText: (f.options ?? []).join("\n"), limited: !!f.countries?.length, countries: f.countries ?? [] });

export type CheckoutInitial = { fields: CheckoutField[]; deliveryEnabled: boolean; pickupEnabled: boolean; pickupLocation: string | null; pickupInstructions: string | null; termsText?: string | null; termsUrl?: string | null; orderSuccessMessage?: string | null; orderEmailSubject?: string | null; orderEmailMessage?: string | null; shopName?: string; contactEmail?: string };

/** Shop settings, Checkout: how people receive things, and any extra questions you want answered before they pay. */
export function CheckoutPanel({ templateId, initial }: { templateId: string; initial: CheckoutInitial }) {
  const start: V = {
    questions: initial.fields.map((f) => draft(f)),
    delivery: initial.deliveryEnabled,
    pickup: initial.pickupEnabled,
    location: initial.pickupLocation ?? "",
    instructions: initial.pickupInstructions ?? "",
    terms: initial.termsText ?? "",
    termsUrl: initial.termsUrl ?? "",
    orderSuccessMessage: initial.orderSuccessMessage ?? "",
    orderEmailSubject: initial.orderEmailSubject ?? "",
    orderEmailMessage: initial.orderEmailMessage ?? "",
  };
  const form = useSettingsForm<V>(start, async (v) => {
    const bad = receiveProblem(v.delivery, v.pickup) ?? questionProblem(v.questions);
    if (bad) return { error: bad };
    if (v.questions.some((q) => q.type === "select" && q.optionsText.split("\n").map((o) => o.trim()).filter(Boolean).length < 2)) return { error: "A “pick from a list” question needs at least two choices, one on each line." };
    if (v.pickup && !v.location.trim()) return { error: "Say where people collect their orders, like “12 Allen Avenue, Ikeja”." };
    const urlBad = termsUrlProblem(v.termsUrl);
    if (urlBad) return { error: urlBad };
    const res = await putSettings(templateId, {
      termsText: v.terms,
      termsUrl: v.termsUrl,
      deliveryEnabled: v.delivery,
      pickupEnabled: v.pickup,
      pickupLocation: v.location,
      pickupInstructions: v.instructions,
      orderSuccessMessage: v.orderSuccessMessage,
      orderEmailSubject: v.orderEmailSubject,
      orderEmailMessage: v.orderEmailMessage,
      checkoutFields: v.questions.map((q) => ({ id: q.id || undefined, label: q.label.trim(), type: q.type, required: q.required, placeholder: q.placeholder || undefined, options: q.type === "select" ? q.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : undefined, countries: q.limited ? q.countries : [] })),
    });
    if (res.error) return { error: res.error };
    const fields = (res.settings?.checkoutFields as CheckoutField[] | undefined) ?? [];
    return { saved: { ...v, questions: fields.map((f) => draft(f)) } };
  });
  const v = form.values;
  const setQ = (key: string, p: Partial<Q>) => form.patch({ questions: v.questions.map((q) => (q.key === key ? { ...q, ...p } : q)) });
  const move = (i: number, d: number) => {
    const next = [...v.questions];
    const t = i + d;
    if (t < 0 || t >= next.length) return;
    [next[i], next[t]] = [next[t], next[i]];
    form.patch({ questions: next });
  };
  const unused = SUGGESTIONS.filter((s) => !v.questions.some((q) => q.label.trim().toLowerCase() === s.label.toLowerCase()));

  return (
    <div className="plx-hset" data-tour="shop-checkout">
      <Group title="How people get what they buy" help="Choose what customers see at checkout for things you ship.">
        <Switch label="Deliver to people" help="Uses the delivery prices and places you set under Delivery." checked={v.delivery} onChange={(delivery) => form.patch({ delivery })} />
        <Switch label="Let people collect it" help="They pick it up from you. No delivery fee." checked={v.pickup} onChange={(pickup) => form.patch({ pickup })} />
        {v.pickup ? (
          <>
            <Input label="Where people collect" value={v.location} onChange={(e) => form.patch({ location: e.target.value })} placeholder="12 Allen Avenue, Ikeja" />
            <Textarea label="What they should know" optional help="Opening hours, who to ask for, anything useful." value={v.instructions} onChange={(e) => form.patch({ instructions: e.target.value })} />
          </>
        ) : null}
      </Group>

      <Group title="Questions at checkout" help="Name, email, phone and address are always asked. Add anything else you need. Answers show on each order." status={<Badge>{v.questions.length === 0 ? "None yet" : `${v.questions.length} ${v.questions.length === 1 ? "question" : "questions"}`}</Badge>}>
        {v.questions.length === 0 ? <p className="plx-small" style={{ margin: 0 }}>You haven&apos;t added any questions. Checkout only asks for the basics. Tap one below to start.</p> : null}
        {v.questions.map((q, i) => (
          <div key={q.key} className="plx-qcard">
            <div className="plx-qcard__row">
              <Input label="Your question" value={q.label} maxLength={80} onChange={(e) => setQ(q.key, { label: e.target.value })} placeholder="Gift message" />
              <Select label="They answer with" value={q.type} onChange={(e) => setQ(q.key, { type: e.target.value as CheckoutFieldType })} options={(Object.keys(TYPE_LABELS) as CheckoutFieldType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
              <span style={{ display: "flex", gap: 2 }}>
                <Button variant="ghost" iconOnly aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={18} aria-hidden /></Button>
                <Button variant="ghost" iconOnly aria-label="Move down" disabled={i === v.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown size={18} aria-hidden /></Button>
                <Button variant="ghost" iconOnly aria-label={`Remove “${q.label || "this question"}”`} onClick={() => form.patch({ questions: v.questions.filter((x) => x.key !== q.key) })}><Trash2 size={18} aria-hidden /></Button>
              </span>
            </div>
            {q.type === "select" ? <Textarea label="The choices" help="One on each line." value={q.optionsText} onChange={(e) => setQ(q.key, { optionsText: e.target.value })} /> : q.type !== "date" ? <Input label="Hint inside the box" optional value={q.placeholder} maxLength={80} onChange={(e) => setQ(q.key, { placeholder: e.target.value })} /> : null}
            <Switch label="They must answer" checked={q.required} onChange={(required) => setQ(q.key, { required })} />
            <div>
              <Select label="Who is asked" value={q.limited ? "some" : "all"} onChange={(e) => setQ(q.key, { limited: e.target.value === "some" })} options={[{ value: "all", label: "Everyone" }, { value: "some", label: "Only people getting it delivered to certain countries" }]} />
              {q.limited ? (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="plx-hchips">
                    {q.countries.map((c) => (
                      <span key={c} className="plx-week__chip">{checkoutCountryName(c) ?? c}<button type="button" aria-label={`Remove ${checkoutCountryName(c) ?? c}`} onClick={() => setQ(q.key, { countries: q.countries.filter((x) => x !== c) })}><X size={14} aria-hidden /></button></span>
                    ))}
                  </div>
                  <Select label="Add a country" value="" onChange={(e) => e.target.value && setQ(q.key, { countries: [...q.countries, e.target.value] })} placeholder="Choose a country" options={CHECKOUT_COUNTRIES.filter(([c]) => !q.countries.includes(c)).map(([code, name]) => ({ value: code, label: name }))} />
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className="plx-hchips">
          <Button variant="secondary" leftIcon={<Plus size={16} aria-hidden />} disabled={v.questions.length >= MAX_FIELDS} onClick={() => form.patch({ questions: [...v.questions, draft()] })}>Add a question</Button>
          {v.questions.length < MAX_FIELDS ? unused.map((s) => (
            <Button key={s.label} size="sm" variant="ghost" onClick={() => form.patch({ questions: [...v.questions, draft({ label: s.label, type: s.type, placeholder: s.placeholder })] })}>{s.label}</Button>
          )) : null}
        </div>
      </Group>
      <Group title="Terms of sale and refunds" help="Customers see a link to this at checkout and in their order emails, so everyone knows the rules before they buy.">
        <Textarea label="Your terms" optional help={v.terms.trim() ? "Customers read this on a simple page on your site." : "Not set yet. Start from our friendly text and change it to fit your shop."} value={v.terms} rows={10} maxLength={10000} onChange={(e) => form.patch({ terms: e.target.value })} />
        <div className="plx-hchips">
          <Button variant="secondary" size="sm" onClick={() => form.patch({ terms: defaultTerms(initial.shopName ?? "", initial.contactEmail ?? "") })}>{v.terms.trim() ? "Replace with our friendly text" : "Start from our friendly text"}</Button>
          <Link className="plx-btn plx-btn--ghost plx-btn--sm" href={solStudioHref(termsPromptForSol(initial.shopName ?? "my shop"), { siteId: templateId })}><MessageCircle size={16} aria-hidden /> Ask SOL to write it</Link>
        </div>
        <Input label="Or link to your own page" optional help="If you already have terms on another page, paste its address. Customers go there instead." value={v.termsUrl} onChange={(e) => form.patch({ termsUrl: e.target.value })} placeholder="https://yoursite.com/terms" />
      </Group>
      <Group title="After purchase & receipt emails" help="Customize what customers see on the order confirmation page and in their receipt email.">
        <Textarea
          label="Message shown on page after purchase"
          optional
          help="Shown on the confirmation page after an order is placed."
          placeholder="e.g. Your payment has been received successfully."
          value={v.orderSuccessMessage}
          onChange={(e) => form.patch({ orderSuccessMessage: e.target.value })}
        />
        <Input
          label="Email receipt subject"
          optional
          help="Subject line of their order confirmation email (leave empty for default 'Order confirmed')."
          placeholder="e.g. Thank you for your order"
          value={v.orderEmailSubject}
          onChange={(e) => form.patch({ orderEmailSubject: e.target.value })}
        />
        <Textarea
          label="Email receipt message / body"
          optional
          help="Personal thank-you message included in their confirmation email."
          placeholder="e.g. Thank you for shopping with us! We appreciate your business and are preparing your order."
          value={v.orderEmailMessage}
          onChange={(e) => form.patch({ orderEmailMessage: e.target.value })}
        />
      </Group>
      <SaveBar form={form} />
    </div>
  );
}
