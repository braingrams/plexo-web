"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function safeHref(href: string | undefined): string | null {
  const h = href?.trim();
  if (!h) return null;
  if (h.startsWith("/") || h.startsWith("#") || h.startsWith("./") || h.startsWith("../")) return h;
  try {
    return SAFE_PROTOCOLS.has(new URL(h).protocol.toLowerCase()) ? h : null;
  } catch {
    return null;
  }
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(cls)?.[1];
  return (
    <div className="sol3-code">
      <div className="sol3-code__bar">
        <span>{lang && lang !== "text" ? lang : "Code"}</span>
        <button
          type="button"
          className="plx-btn plx-btn--ghost plx-btn--sm"
          style={{ textTransform: "none", letterSpacing: 0 }}
          onClick={() => {
            navigator.clipboard?.writeText(textOf(children).replace(/\n$/, "")).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {});
          }}
        >
          <span className="plx-btn__label">
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** SOL's reply as clean, readable text: spaced paragraphs, tidy lists, tables and code that follow the theme. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="sol3-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children, ...props }) => {
            const ok = safeHref(href);
            return ok ? (
              <a href={ok} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="sol3-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
