"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Notice, SegmentedControl, Select, Textarea } from "../../ui";
import {
  BUSINESS_KINDS,
  buildArticleSchema,
  buildBusinessSchema,
  buildFaqSchema,
  checkSchemaJson,
  emptyBusiness,
  type ArticleFields,
  type BusinessFields,
  type FaqRow,
  type SchemaKind,
} from "@/lib/seo/pageSeo";

/** What the editor remembers so the form comes back the way the owner left it. */
export type SchemaSource = { kind: SchemaKind; business: BusinessFields; faq: FaqRow[]; article: ArticleFields; custom: string };
export type SchemaValue = { source: string; json: string };

const EMPTY_ARTICLE: ArticleFields = { headline: "", author: "", datePublished: "", image: "", description: "" };

export function readSchemaSource(source: string, json: string, defaults: Partial<BusinessFields>): SchemaSource {
  const base: SchemaSource = { kind: json ? "custom" : "none", business: emptyBusiness(defaults), faq: [{ question: "", answer: "" }], article: { ...EMPTY_ARTICLE }, custom: json };
  try {
    const s = JSON.parse(source) as Partial<SchemaSource>;
    if (s && typeof s === "object") {
      return {
        kind: (["none", "business", "faq", "article", "custom"] as const).includes(s.kind as SchemaKind) ? (s.kind as SchemaKind) : base.kind,
        business: { ...base.business, ...(s.business ?? {}) },
        faq: Array.isArray(s.faq) && s.faq.length ? s.faq : base.faq,
        article: { ...base.article, ...(s.article ?? {}) },
        custom: typeof s.custom === "string" ? s.custom : base.custom,
      };
    }
  } catch {
    /* an older record with no form: show its JSON as "your own" */
  }
  return base;
}

/** The JSON a form produces (empty when nothing useful is filled in). */
export function schemaJsonFor(s: SchemaSource): string {
  if (s.kind === "none") return "";
  if (s.kind === "custom") return s.custom.trim();
  if (s.kind === "business") return s.business.name.trim() ? JSON.stringify(buildBusinessSchema(s.business)) : "";
  if (s.kind === "faq") {
    const o = buildFaqSchema(s.faq);
    return (o.mainEntity as unknown[]).length ? JSON.stringify(o) : "";
  }
  return s.article.headline.trim() ? JSON.stringify(buildArticleSchema(s.article)) : "";
}

export const schemaValueFor = (s: SchemaSource): SchemaValue => ({ source: s.kind === "none" ? "" : JSON.stringify(s), json: schemaJsonFor(s) });

const KINDS = [
  { value: "none", label: "None" },
  { value: "business", label: "My business" },
  { value: "faq", label: "Questions" },
  { value: "article", label: "Article" },
  { value: "custom", label: "My own" },
] as const;

const INTRO: Record<SchemaKind, string> = {
  none: "Nothing extra. Plexo still adds the basic details about your website to every page.",
  business: "Helps Google show your name, address, phone number and opening hours next to your search result.",
  faq: "Lets Google show your questions and answers right under your page in search.",
  article: "Helps Google understand a news story or blog-style page, and show who wrote it and when.",
  custom: "For people who already have structured data (JSON-LD). Paste it here and we will check it.",
};

export function SeoSchemaEditor({ value, onChange, problem }: { value: SchemaSource; onChange: (v: SchemaSource) => void; problem?: string | null }) {
  const json = schemaJsonFor(value);
  const check = useMemo(() => checkSchemaJson(json), [json]);
  const set = (patch: Partial<SchemaSource>) => onChange({ ...value, ...patch });
  const biz = value.business;
  const setBiz = (patch: Partial<BusinessFields>) => set({ business: { ...biz, ...patch } });

  return (
    <div className="plx-adv__stack" data-testid="schema-editor">
      <SegmentedControl label="What kind of page is this?" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={value.kind} onChange={(kind) => set({ kind })} />
      <p className="plx-small" style={{ margin: 0 }}>{INTRO[value.kind]}</p>

      {value.kind === "business" ? (
        <div className="plx-adv__grid2">
          <Input label="Business name" value={biz.name} maxLength={120} onChange={(e) => setBiz({ name: e.target.value })} />
          <Select label="Type of business" value={biz.kind} options={BUSINESS_KINDS} onChange={(e) => setBiz({ kind: e.target.value })} />
          <Input label="Phone" value={biz.phone} maxLength={40} inputMode="tel" onChange={(e) => setBiz({ phone: e.target.value })} />
          <Input label="Email" value={biz.email} maxLength={120} inputMode="email" onChange={(e) => setBiz({ email: e.target.value })} />
          <Input label="Street" value={biz.street} maxLength={160} onChange={(e) => setBiz({ street: e.target.value })} />
          <Input label="Town or city" value={biz.city} maxLength={80} onChange={(e) => setBiz({ city: e.target.value })} />
          <Input label="State or region" value={biz.region} maxLength={80} onChange={(e) => setBiz({ region: e.target.value })} />
          <Input label="Postcode" value={biz.postalCode} maxLength={20} onChange={(e) => setBiz({ postalCode: e.target.value })} />
          <Input label="Country" value={biz.country} maxLength={80} onChange={(e) => setBiz({ country: e.target.value })} />
          <Input label="Website address" optional help="Start with https://" value={biz.url} maxLength={500} onChange={(e) => setBiz({ url: e.target.value })} />
          <Textarea fieldClassName="plx-adv__span2" label="Opening hours" optional help="One line per group, like Mo-Fr 09:00-18:00" rows={3} value={biz.hours} onChange={(e) => setBiz({ hours: e.target.value })} />
        </div>
      ) : null}

      {value.kind === "faq" ? (
        <div className="plx-adv__stack">
          {value.faq.map((row, i) => (
            <div key={i} className="plx-adv__faqrow">
              <Input label={`Question ${i + 1}`} value={row.question} maxLength={300} onChange={(e) => set({ faq: value.faq.map((r, j) => (j === i ? { ...r, question: e.target.value } : r)) })} />
              <Textarea label="Answer" rows={2} value={row.answer} maxLength={2000} onChange={(e) => set({ faq: value.faq.map((r, j) => (j === i ? { ...r, answer: e.target.value } : r)) })} />
              {value.faq.length > 1 ? <Button variant="secondary" type="button" leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => set({ faq: value.faq.filter((_, j) => j !== i) })}>Remove this question</Button> : null}
            </div>
          ))}
          {value.faq.length < 30 ? <div><Button variant="secondary" type="button" leftIcon={<Plus size={16} aria-hidden />} onClick={() => set({ faq: [...value.faq, { question: "", answer: "" }] })}>Add a question</Button></div> : null}
        </div>
      ) : null}

      {value.kind === "article" ? (
        <div className="plx-adv__grid2">
          <Input fieldClassName="plx-adv__span2" label="Headline" help="Up to 110 characters" value={value.article.headline} maxLength={110} onChange={(e) => set({ article: { ...value.article, headline: e.target.value } })} />
          <Input label="Written by" value={value.article.author} maxLength={120} onChange={(e) => set({ article: { ...value.article, author: e.target.value } })} />
          <Input label="Date published" help="Like 2026-11-23" value={value.article.datePublished} maxLength={40} onChange={(e) => set({ article: { ...value.article, datePublished: e.target.value } })} />
          <Textarea fieldClassName="plx-adv__span2" label="Short summary" optional rows={2} value={value.article.description} maxLength={300} onChange={(e) => set({ article: { ...value.article, description: e.target.value } })} />
        </div>
      ) : null}

      {value.kind === "custom" ? (
        <Textarea label="Your structured data (JSON-LD)" help="Paste the JSON, or the whole script tag. We check it before it goes on your page." rows={10} className="plx-adv__mono" spellCheck={false} value={value.custom} onChange={(e) => set({ custom: e.target.value })} />
      ) : null}

      {problem ? <Notice kind="error" title="This can't be saved yet">{problem}</Notice> : null}
      {value.kind !== "none" && json ? (
        check.ok ? (
          <Notice kind="success" title="Looks good">
            {check.types.length ? `Google will read this as: ${check.types.join(", ")}.` : "Google can read this."}
            {check.tips.length ? <ul className="plx-adv__tips">{check.tips.map((t) => <li key={t}>{t}</li>)}</ul> : null}
          </Notice>
        ) : (
          <Notice kind="warning" title="Fix this first">
            <ul className="plx-adv__tips">{check.problems.map((t) => <li key={t}>{t}</li>)}</ul>
          </Notice>
        )
      ) : null}
      {value.kind !== "none" && value.kind !== "custom" && json && check.ok ? (
        <details className="plx-adv__details">
          <summary>See exactly what Google will read</summary>
          <pre className="plx-adv__code">{JSON.stringify(JSON.parse(json), null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
