"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// Ships with rehype-highlight as a transitive dependency — no new package.json entry
// needed. rehype-highlight only attaches hljs/language-* classes to code blocks; an
// actual color theme has to be imported separately, same as any other highlight.js setup.
import "highlight.js/styles/github-dark.css";

/** Renders one assistant message's markdown text. Wrapped in .sol-markdown (see
 * app/globals.css) — the one sanctioned real stylesheet block in this feature, since
 * markdown output produces unpredictable nested tags inline styles can't reasonably cover. */
export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="sol-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Every link SOL produces — a published site's domain, a doc reference, anything
          // else — opens in a new tab rather than navigating the dashboard itself away.
          // `noopener noreferrer` is required alongside `target="_blank"` here since the
          // href is model-generated content, not something this codebase controls.
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
