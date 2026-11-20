"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SectionsClient } from "@/app/dashboard/templates/[id]/sections/SectionsClient";
import { SectionTypeEditor } from "@/app/dashboard/templates/[id]/sections/[typeId]/SectionTypeEditor";
import { EntriesClient } from "@/app/dashboard/templates/[id]/sections/entries/EntriesClient";
import { EditorFrame } from "@/app/dashboard/_components/EditorTheme";
import { LayoutModeProvider } from "@/app/dashboard/layout-mode-context";
import { LegacyBridge } from "@/app/dashboard/_v3/LegacyBridge";
import { installMock } from "../_mock/api";

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const ENTRIES = [
  { typeId: "t1", typeName: "Testimonials", pageId: "p1", sectionId: "s1", pageTitle: "Home", pagePath: "/", keyText: "What our students say", rows: 3, draft: false, editedAt: ago(5) },
  { typeId: "t1", typeName: "Testimonials", pageId: "p2", sectionId: "s2", pageTitle: "Cooking classes", pagePath: "/classes", keyText: "Loved by home cooks", rows: 2, draft: true, editedAt: ago(30) },
  { typeId: "t2", typeName: "Team members", pageId: "p3", sectionId: "s3", pageTitle: "About us", pagePath: "/about", keyText: "Meet the kitchen", rows: 4, draft: false, editedAt: ago(100) },
  { typeId: "t3", typeName: "Opening hours", pageId: "p4", sectionId: "s4", pageTitle: "Contact", pagePath: "/contact", keyText: "Come and visit", rows: null, draft: false, editedAt: ago(400) },
];
const TYPES = [
  { id: "t1", name: "Testimonials", repeats: "testimonial", count: 2 },
  { id: "t2", name: "Team members", repeats: "team member", count: 1 },
  { id: "t3", name: "Opening hours", repeats: null, count: 1 },
];
const FIELDS = [
  { key: "heading", label: "Heading", type: "text", placeholder: "What our students say" },
  { key: "intro", label: "Short introduction", type: "richtext", hint: "Bold, links and lists all work here." },
  { key: "items", label: "Testimonials", type: "list", itemName: "testimonial", item: [
    { key: "quote", label: "What they said", type: "longtext" },
    { key: "name", label: "Name", type: "text" },
    { key: "photo", label: "Photo", type: "image" },
  ] },
];
const CONTENT = {
  heading: "What our students say",
  intro: "<p>Over <b>400 home cooks</b> have joined a class since 2022.</p><ul><li>Hands on</li><li>Lunch included</li></ul>",
  items: [
    { quote: "I finally understand how to build flavour. My jollof has never been better.", name: "Kemi Adeyemi", photo: "" },
    { quote: "Ama is patient, funny and brilliant. Worth every minute.", name: "Tunde Bakare", photo: "" },
    { quote: "The best Saturday morning I have had in years.", name: "Ngozi Eze", photo: "" },
  ],
};

function setup(empty: boolean) {
  installMock([
    { test: /section-entries\/[^/]+\/[^/?]+$/, method: "GET", res: () => ({ entry: { pageId: "p1", pageTitle: "Home", sectionId: "s1", typeId: "t1", typeName: "Testimonials", fields: FIELDS, content: CONTENT, draft: false } }) },
    { test: /section-entries(\?|$)/, method: "GET", res: ({ url }) => {
        const t = url.searchParams.get("typeId"), q = (url.searchParams.get("q") ?? "").toLowerCase();
        const list = empty ? [] : ENTRIES.filter((e) => (!t || e.typeId === t) && (!q || (e.keyText + e.pageTitle).toLowerCase().includes(q)));
        return { types: empty ? [] : TYPES, entries: list, total: list.length };
      } },
    { test: /section-types\/draft$/, method: "POST", res: () => ({ draft: { fields: [{ key: "heading", label: "Heading", type: "text" }, { key: "items", label: "Team members", type: "list", itemName: "team member", item: [{ key: "name", label: "Name", type: "text" }, { key: "role", label: "Role", type: "text" }, { key: "photo", label: "Photo", type: "image" }] }], html: '<section style="padding:24px"><h2 style="margin:0 0 16px;color:{{tone.heading}}">{{heading}}</h2>{{#items}}<div style="padding:12px 0;border-top:1px solid {{tone.line}}"><b style="color:{{tone.heading}}">{{name}}</b><p style="margin:4px 0 0;color:{{tone.body}}">{{role}}</p></div>{{/items}}</section>', defaults: { heading: "Meet the team", items: [{ name: "Ama Owusu", role: "Head cook" }, { name: "Kofi Mensah", role: "Baker" }] } } }) },
  ]);
}

export function SectionsPreview() {
  const q = useSearchParams();
  const view = q.get("view") ?? "list";
  useState(() => setup(view === "entries-empty"));
  return (
    <EditorFrame v3>
      <LayoutModeProvider initialMode="CLASSIC"><LegacyBridge>
        {view === "make" ? (
          <SectionTypeEditor templateId="p1" templateName="Ama's Kitchen" existing={null} />
        ) : view.startsWith("entries") ? (
          <EntriesClient templateId="p1" templateName="Ama's Kitchen" initialType="" />
        ) : (
          <SectionsClient
            templateId="p1"
            templateName="Ama's Kitchen"
            initial={view === "empty" ? [] : [
              { id: "t1", name: "Testimonials", description: "Quotes from students, with a photo and a name.", starter: "testimonials", fieldCount: 3, repeats: "testimonial" },
              { id: "t2", name: "Team members", description: "Who is behind the kitchen.", fieldCount: 3, repeats: "team member" },
              { id: "t3", name: "Opening hours", description: "When and where to find us.", fieldCount: 5 },
            ]}
          />
        )}
      </LegacyBridge></LayoutModeProvider>
    </EditorFrame>
  );
}
