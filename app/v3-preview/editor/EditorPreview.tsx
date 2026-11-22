"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { RawFileEditor } from "@/app/dashboard/templates/[id]/raw-file-editor";
import { ConvertToCodeDialog } from "@/app/dashboard/templates/[id]/ConvertToCode";
import { EditorFrame } from "@/app/dashboard/_components/EditorTheme";
import { installMock } from "../_mock/api";

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:#1d2a22;background:#fbf7ef}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 48px}header b{font-size:20px;color:#1f6f4a}nav a{margin-left:24px;color:#1d2a22;text-decoration:none;font-size:15px}
.hero{padding:72px 48px;text-align:center;background:#e8f1e4}.hero h1{font-size:44px;margin:0 0 12px;font-family:Georgia,serif}.hero p{font-size:18px;margin:0 0 24px;color:#445}
.btn{display:inline-block;background:#1f6f4a;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:48px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.08)}.card h3{margin:0 0 8px}`;
const BODY = `<header>
    <b>Ama's Kitchen</b>
    <nav><a href="/about">About</a><a href="/classes">Classes</a><a href="/contact">Contact</a></nav>
  </header>
  <section class="hero">
    <h1>Spices that taste like home</h1>
    <p>Hand-blended in Accra, shipped across Ghana and Nigeria.</p>
    <a class="btn" href="/shop">Shop the spice mixes</a>
  </section>
  <section class="cards">
    <div class="card"><h3>Jollof spice mix</h3><p>Our house blend, ready for the pot.</p></div>
    <div class="card"><h3>Cooking classes</h3><p>Two hours, hands on, lunch included.</p></div>
    <div class="card"><h3>Recipe ebook</h3><p>Forty family recipes in one download.</p></div>
  </section>`;
const SCRIPT = `\n  <script>document.querySelector('.cards').innerHTML += '<div class="card"><h3>Loaded by script</h3></div>';</script>`;

function html(script: boolean) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Ama's Kitchen</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  ${BODY}${script ? SCRIPT : ""}\n</body>\n</html>`;
}

function setup(script: boolean) {
  const page = html(script);
  const node = (id: number, tag: string, label: string, section: string, text: string, href?: string) => ({ id, tag, label, section, text, ...(href !== undefined ? { href } : {}) });
  installMock([
    { test: /\/api\/v1\/templates\/[^/]+\/files(\?|$)/, method: "GET", res: () => ({ files: [{ path: "index.html", size: page.length, editable: true, content: page }, { path: "style.css", size: CSS.length, editable: true, content: CSS, url: `data:text/css;base64,${btoa(CSS)}` }, { path: "logo.png", size: 4000, editable: false }] }) },
    { test: /\/api\/v1\/templates\/[^/]+\/text-content/, method: "GET", res: () => ({
        previewHtml: page.replace('<link rel="stylesheet" href="style.css">', `<style>${CSS}</style>`),
        imageNodes: [], colorNodes: [],
        nodes: [
          node(1, "b", "Text", "Header", "Ama's Kitchen"),
          node(2, "a", "Menu item", "Navigation", "About", "/about"),
          node(3, "a", "Menu item", "Navigation", "Classes", "/classes"),
          node(4, "a", "Menu item", "Navigation", "Contact", "/contact"),
          node(5, "h1", "Heading", "Hero", "Spices that taste like home"),
          node(6, "p", "Text", "Hero", "Hand-blended in Accra, shipped across Ghana and Nigeria."),
          node(7, "a", "Button", "Hero", "Shop the spice mixes", "/shop"),
          node(8, "h3", "Heading", "Section 2", "Jollof spice mix"),
          node(9, "p", "Text", "Section 2", "Our house blend, ready for the pot."),
          node(10, "h3", "Heading", "Section 2", "Cooking classes"),
        ],
      }) },
    { test: /\/api\/v1\/sites\/[^/]+\/brand/, res: () => ({ linked: false }) },
    { test: /convert-to-code$/, method: "POST", res: () => ({
        html: `<!DOCTYPE html><html><head><style>${CSS}</style></head><body>${BODY}</body></html>`,
        hasUnpublishedChanges: true, isLive: true,
        notes: { copied: ["Your words, pictures, colours and fonts.", "Your site's header and footer, as they are today.", "Forms, shop, blog and other ready-made parts keep working."], heads: ["You will see your page's pieces as code. Nothing you can see changes."] },
      }) },
  ]);
}

export function EditorPreview() {
  const q = useSearchParams();
  const view = q.get("view") ?? "code";
  useState(() => setup(q.get("script") === "1"));
  return (
    <EditorFrame v3>
      {view === "convert" ? (
        <ConvertToCodeDialog templateId="p1" templateName="Ama's Kitchen" target="code" saveFirst={async () => undefined} onClose={() => undefined} />
      ) : (
        <RawFileEditor templateId="p1" siteId="p1" templateName="Ama's Kitchen" templateKind="LANDING_PAGE" subscriptionPlan="PRO" useAi aiProvider="auto" aiTier="AUTO" initialMode={view === "design" ? "design" : view === "text" ? "text" : "code"} />
      )}
    </EditorFrame>
  );
}
