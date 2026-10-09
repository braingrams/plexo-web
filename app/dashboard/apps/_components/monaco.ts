"use client";

import { loader } from "@monaco-editor/react";

// Monaco is self-hosted from /monaco/vs (scripts/copy-monaco.mjs) — never fetched from a CDN.
// Call once before rendering any <Editor>/<DiffEditor>.
let configured = false;
export function ensureMonaco(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;
  loader.config({ paths: { vs: "/monaco/vs" } });
}

/** Monaco language id for a project file path. */
export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      json: "json",
      css: "css",
      scss: "scss",
      html: "html",
      md: "markdown",
      mdx: "markdown",
      sql: "sql",
      yml: "yaml",
      yaml: "yaml",
      svg: "xml",
      xml: "xml",
    } as Record<string, string>
  )[ext] ?? "plaintext";
}

export const EDITOR_THEME = "vs-dark";
