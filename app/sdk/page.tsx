import Link from "next/link";
import { LandingNav } from "../landing-nav";

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
  title: "Plexo React SDK — Developer Documentation (@charisol/plexo-sdk)",
  description: "Embed the visual drag-and-drop landing page and email template builder in React. Server-proxied AI generation, theme customization, and clean HTML compilation.",
};

export default function PublicSdkPage() {
  return (
    <>
      <LandingNav />

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "calc(68px + 4rem) 1.5rem 6rem" }}>
        
        {/* Header Eyebrow & Title */}
        <section style={{ textAlign: "center", marginBottom: "4rem", position: "relative" }}>
          <div aria-hidden style={{
            position: "absolute", top: "-40%", left: "50%", transform: "translateX(-50%)",
            width: 600, height: 300, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)",
            filter: "blur(60px)", pointerEvents: "none", zIndex: -1,
          }} />

          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.35rem 0.9rem", borderRadius: 999,
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)",
            color: "#38bdf8", fontSize: "0.8rem", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: "1.25rem",
          }}>
            <IconTerminal /> Developer SDK Documentation
          </div>

          <h1 style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "clamp(2.4rem, 5vw, 4rem)", fontWeight: 800,
            lineHeight: 1.08, letterSpacing: "-0.03em", color: "#ffffff",
            maxWidth: 860, margin: "0 auto 1.5rem",
          }}>
            Embed the Visual Builder into Any React SaaS
          </h1>

          <p style={{
            fontSize: "1.1rem", color: "rgba(240,242,255,0.65)",
            maxWidth: 680, margin: "0 auto", lineHeight: 1.7,
          }}>
            The{" "}
            <code style={{ fontFamily: "monospace", color: "#38bdf8", fontSize: "0.95rem", background: "rgba(56,189,248,0.1)", padding: "0.15rem 0.4rem", borderRadius: 6 }}>
              @charisol/plexo-sdk
            </code>
            {" "}npm package renders a pure client-side visual drag-and-drop workspace with AI generation, stock image search, and clean responsive HTML compilation.
          </p>
        </section>

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
            1. Installation & Peer Dependencies
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
              2. Render Component (&lt;PlexoBuilder /&gt;)
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
              3. Next.js App Router Integration (SSR Disabled)
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
            4. Component Props Reference
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
