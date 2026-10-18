import Link from "next/link";
import { LandingNav } from "../landing-nav";
import {
  SDK_V2_API, SDK_V2_COMPILE, SDK_V2_EMBED, SDK_V2_INSTALL, SDK_V2_NEXT, SDK_V2_PAGES, SDK_V2_SOL,
} from "./v2-snippets";

function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export const metadata = {
  title: "Plexo SDK — Embed a visual website builder in your product (@charisol/plexo-sdk)",
  description: "Drop a visual page builder into your React app. Non-designers edit section by section, you keep the data. Compile to clean HTML or React, sync brand with Strata, and let AI edit the site. The classic builder keeps working.",
  alternates: { canonical: "/sdk" },
};

const ACCENT = "#38bdf8";
const PANEL = { background: "rgba(13,15,26,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "1.75rem" } as const;
const H2 = { fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800, color: "#ffffff", marginBottom: "0.5rem" } as const;
const LEAD = { fontSize: "0.92rem", color: "rgba(240,242,255,0.62)", marginBottom: "1.15rem", lineHeight: 1.65 } as const;
const PRE = {
  background: "#06070c", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.1rem 1.25rem",
  fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.6, margin: 0,
} as const;
const CODE = { fontFamily: "monospace", color: ACCENT, fontSize: "0.9em" } as const;

const FEATURES = [
  { title: "A visual builder as a React component", body: "Add one component and your users get a full page builder inside your own product. With no setup it opens a blank page and works offline." },
  { title: "Section by section, for non-designers", body: "Pages are built from ready-made sections (hero, pricing, FAQ and more) that people edit by clicking and typing. Designers can still go free-form." },
  { title: "Brand and design system in sync", body: "Colours, fonts and shapes live in one design system, and the Branding panel can keep it in step with Strata." },
  { title: "Clean HTML or React out", body: "Compile any page to a standalone HTML document on your server, or to React code for an app. Neither needs the editor." },
  { title: "AI that edits the site", body: "Describe the site, apply a model's suggested changes safely with applyCommands, and show your users a plain-language summary." },
  { title: "Your server, your data", body: "Forms post to your own address, pages are saved where you choose, and no provider key ever lives in the browser." },
];

const PROPS: Array<[string, string, string]> = [
  ["pages", "PageDefinition[]", "The design to edit. Leave it out to start on a blank page."],
  ["designSystem", "DesignSystem", "The site's colours, fonts and shapes. Leave it out for the built-in one."],
  ["onChange / onDesignSystemChange", "function", "Called (briefly delayed) after every edit with the latest pages or design system."],
  ["onSave / autoSave / autoSaveDuration", "function / boolean / ms", "Adds a Save button and, with autoSave, saves a few seconds after the last edit (3000 ms by default)."],
  ["onPublish", "function", "Adds a Publish button. What publishing means is up to your product."],
  ["formAction", "(formId) => string", "Where each form on the page sends its submissions: your own server."],
  ["pageSource", "PageSource", "Your list of pages, and what to do when someone opens, adds, renames or deletes one."],
  ["features", "object", "Turn panels off: pages, branding, library, codeView, pageSwitcher, viewSwitch, headerSol."],
  ["onAskSol", "(question, context) => Promise<string>", "Turns on the AI assistant. Leave it out and AI stays hidden."],
  ["onUpload / stockImages / media / loadMedia", "functions", "Where images go, stock photo search through your server, and your own image library."],
  ["strata", "StrataAdapter", "Keeps the design system in step with Strata (see the strata entry point)."],
  ["shell, headerLeft, headerRight", "object / node", "Fit the editor into your app: a way back, hide your sidebar for room, and your own buttons in the top bar."],
  ["readOnly, commentMode", "boolean", "Let reviewers look or comment without changing anything."],
];

function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div>
      {label && <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>{label}</div>}
      <pre style={PRE}>{code}</pre>
    </div>
  );
}

function Step({ title, children, code, label }: { title: string; children: React.ReactNode; code: string; label?: string }) {
  return (
    <div style={PANEL}>
      <h3 style={H2}>{title}</h3>
      <p style={LEAD}>{children}</p>
      <Code code={code} label={label} />
    </div>
  );
}

export default function PublicSdkPage() {
  return (
    <>
      <LandingNav />

      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "calc(68px + 4rem) 1.5rem 6rem" }}>

        {/* Hero */}
        <section style={{ marginBottom: "3.5rem", position: "relative", maxWidth: 940 }}>
          <div aria-hidden style={{
            position: "absolute", top: "-40%", left: "20%", width: 600, height: 300, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)",
            filter: "blur(60px)", pointerEvents: "none", zIndex: -1,
          }} />
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.9rem", borderRadius: 999,
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)", color: ACCENT,
            fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1.25rem",
          }}>
            <IconTerminal /> Plexo SDK 2
          </div>
          <h1 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(2.4rem, 5vw, 4rem)", fontWeight: 800,
            lineHeight: 1.08, letterSpacing: "-0.03em", color: "#ffffff", margin: "0 0 1.25rem",
          }}>
            Give your users a website builder, inside your product
          </h1>
          <p style={{ fontSize: "1.1rem", color: "rgba(240,242,255,0.65)", lineHeight: 1.7, margin: "0 0 1.5rem" }}>
            <code style={{ ...CODE, background: "rgba(56,189,248,0.1)", padding: "0.15rem 0.4rem", borderRadius: 6 }}>@charisol/plexo-sdk</code>
            {" "}is a visual page builder you add as a React component. People who aren&apos;t designers build and edit pages section by section, and you
            keep the pages in your own database and turn them into clean HTML or React whenever you need.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/auth/register" className="btn-brand" style={{ padding: "0.8rem 1.8rem", fontWeight: 800 }}>Get your Plexo API key</Link>
            <a href="#classic" className="btn-ghost" style={{ padding: "0.8rem 1.6rem" }}>Using the classic builder?</a>
          </div>
        </section>

        {/* What you get */}
        <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: "3rem" }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ ...PANEL, padding: "1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: ACCENT, marginBottom: "0.5rem" }}>
                <IconCheck />
                <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.02rem", fontWeight: 800, color: "#fff", margin: 0 }}>{f.title}</h3>
              </div>
              <p style={{ fontSize: "0.88rem", color: "rgba(240,242,255,0.6)", lineHeight: 1.6, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </section>

        {/* Quickstart */}
        <section style={{ display: "grid", gap: "1.5rem", marginBottom: "3rem" }}>
          <div style={PANEL}>
            <h2 style={{ ...H2, display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ color: ACCENT }}><IconTerminal /></span> 1. Install
            </h2>
            <Code code={SDK_V2_INSTALL} />
          </div>

          <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))" }}>
            <Step title="2. Add the editor" code={SDK_V2_EMBED} label="components/site-editor.tsx">
              Everything is optional. With no props at all you get a complete builder on a blank page. Pass <code style={CODE}>pages</code> to open an
              existing design, <code style={CODE}>onSave</code> to store it, <code style={CODE}>formAction</code> to send form messages to your server, and{" "}
              <code style={CODE}>features</code> to hide panels your product doesn&apos;t need.
            </Step>
            <Step title="3. Next.js: load it in the browser" code={SDK_V2_NEXT} label="app/editor/page.tsx">
              The editor uses the browser, so load it with <code style={CODE}>next/dynamic</code> and <code style={CODE}>ssr: false</code>.
              Import the stylesheet once, as in step 2. Its styles are scoped to the editor, so nothing leaks into your app.
            </Step>
            <Step title="4. Use your own pages" code={SDK_V2_PAGES} label="pageSource">
              You decide how pages are stored and where they live. Hand the editor your list with <code style={CODE}>pageSource</code> and it shows a page
              switcher, then asks you to open, create, rename or delete. Leave it out and the editor keeps a simple list itself.
            </Step>
            <Step title="5. Turn pages into HTML on your server" code={SDK_V2_COMPILE} label="lib/render-page.ts">
              <code style={CODE}>@charisol/plexo-sdk/v2/compile</code> has no React or editor in it, so it runs anywhere on your backend. Compile to React
              code instead with <code style={CODE}>compilePageToReact</code>. Always check saved designs with <code style={CODE}>parsePages</code>, and run the
              HTML through <code style={CODE}>sanitizeV2Html</code> before you serve it.
            </Step>
            <Step title="Or compile with a hosted call" code={SDK_V2_API} label="POST /api/v1/compile-v2">
              Can&apos;t import the SDK on your backend? Send the pages with your API key and get the same result back. Up to 50 pages and 2 MB per request.
              The response is <code style={CODE}>{"{ html, css, script, document, warnings }"}</code> (for several pages, those are the first page&apos;s,
              plus a <code style={CODE}>pages</code> list with one entry per page).
            </Step>
            <Step title="Let AI edit the site" code={SDK_V2_SOL} label="lib/ask-sol.ts">
              <code style={CODE}>describeDesign</code> gives a model a compact picture of the site, and <code style={CODE}>applyCommands</code> applies what it
              suggests safely: each change is checked on its own and problems come back in plain words. To show the AI assistant inside the editor, pass{" "}
              <code style={CODE}>onAskSol</code>. Your provider key stays on your server.
            </Step>
          </div>
        </section>

        {/* Brand */}
        <section style={{ ...PANEL, marginBottom: "3rem" }}>
          <h2 style={H2}>Brand and design system, in sync with Strata</h2>
          <p style={{ ...LEAD, marginBottom: 0 }}>
            Every page draws its colours, fonts and shapes from one design system, so changing the brand once updates the whole site. Read it with{" "}
            <code style={CODE}>editor.getDesignSystem()</code> and pass it back as <code style={CODE}>designSystem</code> next time. To connect it to
            Strata, give the editor a <code style={CODE}>strata</code> adapter (helpers are in <code style={CODE}>@charisol/plexo-sdk/v2/strata</code>) and the
            Branding panel lets people sign in, pick a project, and pull or send changes.
          </p>
        </section>

        {/* Props */}
        <section style={{ ...PANEL, marginBottom: "3rem" }}>
          <h2 style={{ ...H2, marginBottom: "1.25rem" }}>Editor props</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)", color: "#a78bfa" }}>
                  <th style={{ padding: "0.75rem" }}>Prop</th>
                  <th style={{ padding: "0.75rem" }}>Type</th>
                  <th style={{ padding: "0.75rem" }}>What it does</th>
                </tr>
              </thead>
              <tbody style={{ color: "rgba(240,242,255,0.75)" }}>
                {PROPS.map(([name, type, what]) => (
                  <tr key={name} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.75rem", fontFamily: "monospace", color: ACCENT }}>{name}</td>
                    <td style={{ padding: "0.75rem", fontFamily: "monospace", fontSize: "0.8rem" }}>{type}</td>
                    <td style={{ padding: "0.75rem" }}>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Classic */}
        <section id="classic" style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "3rem", marginBottom: "2rem" }}>
          <div style={{ display: "inline-flex", padding: "0.3rem 0.8rem", borderRadius: 999, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1rem" }}>
            Classic (V1) builder
          </div>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "#fff", margin: "0 0 0.75rem" }}>
            Already using <code style={{ fontFamily: "monospace", color: "#a78bfa" }}>&lt;PlexoBuilder /&gt;</code>? Nothing changes for you.
          </h2>
          <p style={{ ...LEAD, maxWidth: 820, marginBottom: "2rem" }}>
            The classic builder (the main export of the same package) for emails and landing pages keeps working exactly as before, with the same API key,
            the same <code style={CODE}>/api/v1/compile</code> endpoint and the same props. The documentation for it is below, unchanged. New projects should start with
            SDK 2 above.
          </p>

          <div style={{ display: "grid", gap: "2rem", marginBottom: "3rem" }}>
        {/* 1. Installation */}
        <section style={{
          background: "rgba(13,15,26,0.7)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18, padding: "1.75rem", marginBottom: "2.5rem",
          boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
        }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800,
            color: "#ffffff", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.6rem",
          }}>
            <span style={{ color: "#38bdf8" }}><IconTerminal /></span>
            Install
          </h2>
          <pre style={{
            background: "#06070c", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: "1rem 1.25rem", fontFamily: "monospace", fontSize: "0.9rem",
            color: "#38bdf8", overflowX: "auto", margin: 0,
          }}>
            npm install @charisol/plexo-sdk react react-dom
          </pre>
        </section>

        {/* 2. Plain React & Next.js Quickstart */}
        <section style={{ display: "grid", gap: "2rem", gridTemplateColumns: "1fr", marginBottom: "3rem" }}>
          
          {/* React Embed */}
          <div style={{
            background: "rgba(13,15,26,0.7)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18, padding: "2rem",
          }}>
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800,
              color: "#ffffff", marginBottom: "0.5rem",
            }}>
              Render the component (&lt;PlexoBuilder /&gt;)
            </h2>
            <p style={{ fontSize: "0.9rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Pass your Plexo API key to load account settings and AI credit permissions automatically.
            </p>
            <pre style={{
              background: "#06070c", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: "1.25rem", fontFamily: "monospace", fontSize: "0.82rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.6, margin: 0,
            }}>
{`import React, { useRef } from 'react';
import { PlexoBuilder, type PlexoBuilderRef } from '@charisol/plexo-sdk';
import '@charisol/plexo-sdk/dist/plexo-sdk.css';

export function TemplateEditor() {
  const builderRef = useRef<PlexoBuilderRef>(null);

  const handleSave = async () => {
    if (builderRef.current) {
      // Export raw JSON and compiled HTML for email or landing_page
      const { json, html } = await builderRef.current.exportDesign('landing_page');
      
      await fetch('/api/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json, html }),
      });
    }
  };

  return (
    <div style={{ height: '100vh' }}>
      <PlexoBuilder
        ref={builderRef}
        apiKey="pk_live_your_api_key"
        mode="landing_page"
        useAi={true}
        aiTier="AUTO"
        themeBgColor="#8b5cf6"
      />
    </div>
  );
}`}
            </pre>
          </div>

          {/* Next.js App Router Setup */}
          <div style={{
            background: "rgba(13,15,26,0.7)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18, padding: "2rem",
          }}>
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800,
              color: "#ffffff", marginBottom: "0.5rem",
            }}>
              Next.js App Router (SSR disabled)
            </h2>
            <p style={{ fontSize: "0.9rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Because the visual builder uses drag-and-drop and browser APIs, wrap the import with <code style={{ fontFamily: "monospace", color: "#38bdf8" }}>next/dynamic</code> and set <code style={{ fontFamily: "monospace", color: "#38bdf8" }}>ssr: false</code>.
            </p>
            <pre style={{
              background: "#06070c", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: "1.25rem", fontFamily: "monospace", fontSize: "0.82rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.6, margin: 0,
            }}>
{`// components/template-editor.tsx
'use client';

import dynamic from 'next/dynamic';
import type { PlexoBuilderRef } from '@charisol/plexo-sdk';
import '@charisol/plexo-sdk/dist/plexo-sdk.css';

const PlexoBuilder = dynamic(
  () => import('@charisol/plexo-sdk').then((m) => ({ default: m.PlexoBuilder })),
  { ssr: false, loading: () => <p>Loading Plexo Visual Editor…</p> }
);

export function TemplateEditorWrapper() {
  return <PlexoBuilder apiKey="pk_live_your_key" mode="email" useAi={true} />;
}`}
            </pre>
          </div>
        </section>

        {/* 3. Props Reference Table */}
        <section style={{
          background: "rgba(13,15,26,0.7)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18, padding: "2rem", marginBottom: "3rem",
        }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800,
            color: "#ffffff", marginBottom: "1.25rem",
          }}>
            Component props
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)", color: "#a78bfa" }}>
                  <th style={{ padding: "0.75rem" }}>Prop</th>
                  <th style={{ padding: "0.75rem" }}>Type</th>
                  <th style={{ padding: "0.75rem" }}>Default</th>
                  <th style={{ padding: "0.75rem" }}>Description</th>
                </tr>
              </thead>
              <tbody style={{ color: "rgba(240,242,255,0.75)" }}>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>mode</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>'email' | 'landing_page'</td>
                  <td style={{ padding: "0.75rem" }}>Required</td>
                  <td style={{ padding: "0.75rem" }}>Output mode for element rules & compiler HTML</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>apiKey</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>string</td>
                  <td style={{ padding: "0.75rem" }}>Required</td>
                  <td style={{ padding: "0.75rem" }}>Your Plexo API Key for server-side AI authentication</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>useAi</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>boolean</td>
                  <td style={{ padding: "0.75rem" }}>false</td>
                  <td style={{ padding: "0.75rem" }}>Enables layout prompt bar & element-level AI prompt popup</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>aiTier</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>'AUTO' | 'BASIC' | 'MEDIUM' | 'HIGH'</td>
                  <td style={{ padding: "0.75rem" }}>'AUTO'</td>
                  <td style={{ padding: "0.75rem" }}>Model complexity request tier; AUTO classifies per prompt</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>themeBgColor</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>string</td>
                  <td style={{ padding: "0.75rem" }}>'#8b5cf6'</td>
                  <td style={{ padding: "0.75rem" }}>Primary brand accent color for active elements & selection bounds</td>
                </tr>
                <tr>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace", color: "#38bdf8" }}>unsplashKey</td>
                  <td style={{ padding: "0.75rem", fontFamily: "monospace" }}>string</td>
                  <td style={{ padding: "0.75rem" }}>—</td>
                  <td style={{ padding: "0.75rem" }}>Optional Unsplash key for stock image search modal</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

          </div>
        </section>

        {/* Call to Action */}
        <section style={{ textAlign: "center", paddingTop: "2rem" }}>
          <Link href="/auth/register" className="btn-brand" style={{ padding: "0.9rem 2.25rem", fontSize: "1rem", fontWeight: 800 }}>
            Get Your Plexo API Key
          </Link>
        </section>

      </main>
    </>
  );
}
