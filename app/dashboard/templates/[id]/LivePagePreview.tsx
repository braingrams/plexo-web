"use client";

import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@/app/api/v1/templates/[id]/files/route";
import { buildPreviewHtml } from "./preview-utils";
import { injectBaseHref } from "@/lib/wpMigration/injectBaseHref";

/**
 * The page as visitors will see it, built from what is in the editor right now (unsaved changes included) and
 * refreshed shortly after you stop typing. Used beside the Code view and as the Design view.
 */
export function LivePagePreview({ files, edits, rootPath, baseHref, phone }: { files: FileEntry[]; edits: Record<string, string>; rootPath: string; baseHref?: string | null; phone?: boolean }) {
  const [doc, setDoc] = useState("");
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const { html, cleanup: next } = buildPreviewHtml(files, edits, rootPath);
      cleanup.current?.();
      cleanup.current = next;
      setDoc(injectBaseHref(html, baseHref ?? null));
    }, 350);
    return () => clearTimeout(t);
  }, [files, edits, rootPath, baseHref]);

  useEffect(() => () => cleanup.current?.(), []);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", justifyContent: "center", background: phone ? "var(--ed-w-040)" : "transparent" }}>
      <iframe
        title="Live preview of your page"
        srcDoc={doc}
        // Scripts run, but without access to this dashboard (no same-origin): the page is the owner's own, unsanitised code.
        sandbox="allow-scripts"
        style={{ width: phone ? 390 : "100%", maxWidth: "100%", height: "100%", border: "none", background: "#fff", boxShadow: phone ? "0 0 0 1px var(--ed-w-100)" : "none" }}
      />
    </div>
  );
}
