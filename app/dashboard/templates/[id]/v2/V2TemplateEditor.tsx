"use client";

import "@charisol/plexo-sdk/dist/plexo-sdk.css";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CommentTarget, V2EditorRef } from "@charisol/plexo-sdk/v2";
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";

import { EDITOR_THEME } from "@/lib/theme";
import { useEditorColors, useEditorV3, useSitesListHref } from "@/app/dashboard/_components/EditorTheme";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import type { V2Design, V2Meta } from "@/lib/v2/design";
import { askSolStreaming } from "@/lib/ai/clientAssist";
import { PageSettings } from "./PageSettings";
import { BRAND_EMBED_MAX_CHARS, fetchBrand, uploadBrand } from "@/lib/v2/brandClient";
import type { DesignSystemRef } from "@/lib/v2/design";
import { buildV2SavePayload, leaveAfterSaving, newPageBody, pageSourcePages, postV2Draft, productChoices, stockProviders, type TreePage } from "./logic";

// The new visual editor (<V2Editor> from @charisol/plexo-sdk/v2) for a template page. One Template
// row is one page; the site's other pages are other rows, so "switching pages" opens that row
// (after saving this one), exactly like the classic editor's Pages panel does. Saving goes to the
// same autosave route the classic editor uses, and Publish stays the page's own Publish button
// (the parent passes it in as `headerRight`), so there is one way to publish.

type SdkV2 = typeof import("@charisol/plexo-sdk/v2");
const AUTOSAVE_MS = 1500;

export type V2TemplateEditorHandle = {
  /** Saves what's on the canvas now (even if nothing looks changed) and returns what was saved. */
  flush: () => Promise<V2Design>;
  getNodeRect: (nodeId: string) => DOMRect | null;
};

type Props = {
  templateId: string;
  templateName: string;
  rootTemplateId: string;
  initialDesign: V2Design;
  readOnly: boolean;
  /** An email is edited in the editor's email mode: only what email apps can draw, and no web-page details (address, search, scripts). */
  kind: "EMAIL" | "LANDING_PAGE";
  commentMode: boolean;
  onRequestComment: (target: CommentTarget) => void;
  stockKeys: { unsplash?: string; pexels?: string; pixabay?: string };
  /** The page's own Comments / Publish buttons (the parent owns publishing). */
  headerRight: ReactNode;
  /** Show the simple screen (new dashboard, owner chose "beginner"). Pages and emails only. */
  beginner?: boolean;
  /** Puts the page live (saves what is on the canvas first). Rejects when it fails, so the editor's Save menu can say so. */
  onPublish: () => Promise<void>;
  onBack: () => void;
  onSaved: (design: V2Design) => void;
  /** Present while this page can still go back to the classic editor. */
  canGoBack: boolean;
};

export const V2TemplateEditor = forwardRef<V2TemplateEditorHandle, Props>(function V2TemplateEditor(props, ref) {
  const { templateId, initialDesign, readOnly } = props;
  const router = useRouter();
  const v3 = useEditorV3();
  const sitesHref = useSitesListHref();
  const colors = useEditorColors();
  // New dashboard: Plexo's own brand tokens (lime, warm neutrals), light or dark. Old dashboard: the purple it always had.
  // Until the tokens are read the editor uses its own default look, which is already the lime one.
  const editorTheme = v3 ? (colors ? { accent: colors.accent, background: colors.background, text: colors.text } : undefined) : EDITOR_THEME;
  const [sdk, setSdk] = useState<SdkV2 | null>(null);
  const [sdkError, setSdkError] = useState(false);
  const [tree, setTree] = useState<TreePage[] | null>(null);
  const [rootId, setRootId] = useState(props.rootTemplateId);
  const [name, setName] = useState(props.templateName);
  const [meta, setMeta] = useState<V2Meta>(initialDesign.meta ?? {});
  const [customJs, setCustomJs] = useState(initialDesign.customJs ?? "");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [strataOn, setStrataOn] = useState(false);

  const editorRef = useRef<V2EditorRef>(null);
  const editVersion = useRef(0);
  const systemDirty = useRef(false);
  // A big brand lives in storage: the editor loads it itself (it can be larger than the page's own response may be) and, when it
  // changes, uploads it straight back, then saves the page with only a small reference.
  const brandRef = useRef<DesignSystemRef | undefined>(initialDesign.designSystemRef);
  const systemEdits = useRef(0);
  const [brand, setBrand] = useState<{ state: "ready" | "loading" | "error"; ds?: DesignSystem; message?: string }>(() =>
    initialDesign.designSystem || !initialDesign.designSystemRef ? { state: "ready", ds: initialDesign.designSystem } : { state: "loading" },
  );
  const [brandTry, setBrandTry] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // Read at save time, so a save never sends the script or details from an older render.
  const extras = useRef({ meta, customJs });
  extras.current = { meta, customJs };
  // The site (not this one page) is what's linked to Strata: the switch keeps every page of the site on brand.
  const strata = useMemo(() => createStrataAdapter(rootId ? { siteId: rootId } : {}), [rootId]);
  // "Which product to sell" lists this site's products (the Sell a product section and the product block).
  const products = useMemo(
    () => ({
      list: () => productChoices(rootId),
      onCreate: () => window.open(`/dashboard/commerce/${rootId}/products`, "_blank", "noopener"),
      createLabel: "Create a product",
    }),
    [rootId],
  );

  useEffect(() => {
    let cancelled = false;
    import("@charisol/plexo-sdk/v2")
      .then((mod) => !cancelled && setSdk(mod))
      .catch(() => !cancelled && setSdkError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void strata.available().then((on) => !cancelled && setStrataOn(on));
    return () => {
      cancelled = true;
    };
  }, [strata]);

  useEffect(() => {
    if (brand.state !== "loading") return;
    const url = initialDesign.designSystemUrl;
    if (!url) {
      setBrand({ state: "error", message: "This site's colours and fonts couldn't be loaded. Reload the page to try again." });
      return;
    }
    let cancelled = false;
    fetchBrand(url).then(
      (ds) => !cancelled && setBrand({ state: "ready", ds }),
      (err) => !cancelled && setBrand({ state: "error", message: err instanceof Error ? err.message : "Couldn't load this site's colours and fonts." }),
    );
    return () => {
      cancelled = true;
    };
  }, [brand.state, brandTry, initialDesign.designSystemUrl]);

  const loadTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/templates/${templateId}/pages`);
      if (!res.ok) throw new Error("pages");
      const data = (await res.json()) as { rootId: string; pages: TreePage[] };
      setTree(data.pages);
      setRootId(data.rootId);
    } catch {
      setTree((t) => t ?? []);
    }
  }, [templateId]);
  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const markDirty = useCallback(() => {
    editVersion.current += 1;
    setDirty(true);
    setSaveState("idle");
  }, []);

  /** One save at a time, in order: a later save never overtakes an earlier one. */
  const saveNow = useCallback((): Promise<V2Design> => {
    const run = async (): Promise<V2Design> => {
      const editor = editorRef.current;
      if (!editor) throw new Error("The editor isn't ready yet.");
      const version = editVersion.current;
      setSaveState("saving");
      const editsAtStart = systemEdits.current;
      const brandNow = editor.getDesignSystem();
      try {
        // A big brand that changed goes straight to storage first; the page then carries only its reference.
        if (systemDirty.current && JSON.stringify(brandNow).length > BRAND_EMBED_MAX_CHARS) brandRef.current = await uploadBrand(brandNow);
        else if (systemDirty.current) brandRef.current = undefined;
        const design = buildV2SavePayload({
          page: editor.getPages()[0],
          designSystem: brandNow,
          includeDesignSystem: systemDirty.current || !!initialDesign.designSystem,
          designSystemRef: brandRef.current,
          customJs: extras.current.customJs,
          meta: extras.current.meta,
        });
        await postV2Draft(templateId, design);
        if (brandRef.current && systemEdits.current === editsAtStart) systemDirty.current = false; // stored: later saves just repeat the reference
        setNotice(null);
        props.onSaved(design);
        if (editVersion.current === version) {
          setDirty(false);
          setSaveState("saved");
        } else {
          setSaveState("idle");
        }
        return design;
      } catch (err) {
        setSaveState("error");
        setNotice(err instanceof Error ? err.message : "Couldn't save this page.");
        throw err;
      }
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => undefined);
    return next;
    // props.onSaved is stable enough (a state setter wrapper); saving reads everything else from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, initialDesign.designSystem]);

  useImperativeHandle(ref, () => ({ flush: saveNow, getNodeRect: (id) => editorRef.current?.getNodeRect(id) ?? null }), [saveNow]);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const timer = setTimeout(() => void saveNow().catch(() => undefined), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, readOnly, saveNow]);

  // Closing the tab with a change still waiting: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const openPage = useCallback(
    async (id: string) => {
      if (id === templateId) return;
      const left = await leaveAfterSaving({ dirty: dirtyRef.current, save: async () => void (await saveNow()), leave: () => router.push(`/dashboard/templates/${id}`) });
      if (!left) setNotice("This page couldn't be saved, so it stayed open. Fix the problem above, then try again.");
    },
    [templateId, router, saveNow],
  );

  const createPage = useCallback(
    async ({ name: pageName, templateId: pageTemplate }: { name: string; templateId: string }) => {
      try {
        const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPageBody({ name: pageName, rootId, templateId: pageTemplate })) });
        const data = (await res.json().catch(() => ({}))) as { error?: string; template?: { id: string } };
        if (!res.ok || !data.template) throw new Error(data.error ?? "Couldn't add the page.");
        await openPage(data.template.id);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't add the page.");
      }
    },
    [rootId, openPage],
  );

  const renamePage = useCallback(
    async (id: string, next: { name?: string; slug?: string }): Promise<string | null> => {
      const res = await fetch(`/api/templates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return data.error ?? "Couldn't save that change.";
      if (id === templateId && next.name) setName(next.name);
      await loadTree();
      return null;
    },
    [templateId, loadTree],
  );

  const deletePage = useCallback(
    async (id: string) => {
      const page = tree?.find((p) => p.id === id);
      if (!page) return;
      const isHome = !page.parentId;
      const sure = window.confirm(
        isHome
          ? `Delete the whole site "${page.name}" and all of its pages? This can't be undone.`
          : `Delete the page "${page.name}"? This can't be undone.`,
      );
      if (!sure) return;
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setNotice(data.error ?? "Couldn't delete the page.");
      if (id !== templateId) return void (await loadTree());
      dirtyRef.current = false;
      router.refresh();
      router.push(isHome ? sitesHref : `/dashboard/templates/${page.parentId}`);
    },
    [tree, templateId, router, loadTree, sitesHref],
  );

  const goBackToClassic = useCallback(async (): Promise<string | null> => {
    const res = await fetch(`/api/templates/${templateId}/revert-to-classic`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return data.error ?? "Couldn't go back to the classic editor.";
    dirtyRef.current = false;
    // The page is served fresh as a classic page now.
    window.location.assign(`/dashboard/templates/${templateId}`);
    return null;
  }, [templateId]);

  const uploadImage = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(data?.error ?? "Upload failed");
    return data.url as string;
  }, []);

  // The owner's own font files: stored beside their images; the editor only needs the address back.
  const uploadFont = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/media/font", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(data?.error ?? "Font upload failed");
    return data.url as string;
  }, []);

  const loadMedia = useCallback(async () => {
    const res = await fetch("/api/v1/media");
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? (data as { id: string; name: string; url: string }[]) : [];
  }, []);

  const providers = stockProviders(props.stockKeys);
  const searchStock = useCallback(
    async (query: string, provider: string) => {
      const headers: Record<string, string> = {};
      if (props.stockKeys.unsplash) headers["x-unsplash-key"] = props.stockKeys.unsplash;
      if (props.stockKeys.pexels) headers["x-pexels-key"] = props.stockKeys.pexels;
      if (props.stockKeys.pixabay) headers["x-pixabay-key"] = props.stockKeys.pixabay;
      const res = await fetch(`/api/v1/media/stock?query=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}`, { headers });
      // A failed search says so (the picker shows a plain "couldn't load photos" message) instead of passing for "no results".
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Photo search failed");
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data.map((r) => ({ id: r.id, src: r.src, alt: r.alt, credit: r.credit, provider: r.provider })) : [];
    },
    [props.stockKeys],
  );

  if (sdkError) return <Centered>The page editor couldn&rsquo;t load. Check your connection and reload the page.</Centered>;
  if (brand.state === "error") {
    return (
      <Centered>
        <span style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          <span>{brand.message}</span>
          <button type="button" onClick={() => { setBrand({ state: "loading" }); setBrandTry((n) => n + 1); }} style={{ padding: "0.5rem 1rem", borderRadius: 10, border: "1px solid var(--ed-w-180)", background: "transparent", color: "inherit", cursor: "pointer" }}>Try again</button>
        </span>
      </Centered>
    );
  }
  if (!sdk || !tree || brand.state === "loading") return <Centered>{brand.state === "loading" ? "Loading your site's colours and fonts…" : "Opening your page…"}</Centered>;

  const V2Editor = sdk.V2Editor;
  const current = tree.find((p) => p.id === templateId);
  const slug = current ? current.slug : null;
  const listed = pageSourcePages(tree);
  const stateForEditor = saveState === "idle" ? (dirty ? "dirty" : "idle") : saveState;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {notice && (
        <div role="alert" style={{ padding: "0.5rem 1rem", background: "color-mix(in srgb, var(--ed-danger) 12%, transparent)", borderBottom: "1px solid color-mix(in srgb, var(--ed-danger) 30%, transparent)", color: "var(--ed-danger)", fontSize: "0.8rem", display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
            Dismiss
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <V2Editor
            ref={editorRef}
            pages={initialDesign.pages}
            designSystem={brand.ds}
            apiKey="workspace-internal"
            templateId={rootId}
            readOnly={readOnly}
            commentMode={props.commentMode}
            onRequestComment={props.onRequestComment}
            onChange={() => markDirty()}
            onDesignSystemChange={() => {
              systemDirty.current = true;
              systemEdits.current += 1;
              markDirty();
            }}
            onUpload={uploadImage}
            onUploadFont={uploadFont}
            loadMedia={loadMedia}
            stockImages={providers.length ? { providers, search: searchStock } : undefined}
            products={props.kind === "EMAIL" ? undefined : products}
            // Plexo's own colours, so the editor looks like the rest of the app (new dashboard: live brand tokens; old: lib/theme.ts).
            theme={editorTheme}
            strata={strataOn ? strata : undefined}
            onSave={readOnly ? undefined : () => saveNow().then(() => undefined)}
            onPublish={readOnly ? undefined : props.onPublish}
            saveState={stateForEditor}
            pageSource={{
              pages: listed,
              currentId: templateId,
              onSelect: (id) => openPage(id),
              onCreate: readOnly ? undefined : createPage,
              onRename: readOnly ? undefined : async (id, next) => {
                const problem = await renamePage(id, { name: next });
                if (problem) setNotice(problem);
              },
              onDelete: readOnly ? undefined : (id) => deletePage(id),
            }}
            mode={props.kind === "EMAIL" ? "email" : undefined}
            shell={{ onExit: props.onBack, exitLabel: props.kind === "EMAIL" ? "Back to emails" : "Back to site" }}
            // The page picker (left) and the Design | Code switch (middle) are part of editing a site's pages; an email is one page of
            // table markup, so it has neither.
            features={{ pageSwitcher: props.kind !== "EMAIL", viewSwitch: props.kind !== "EMAIL", codeView: props.kind !== "EMAIL", headerSol: false }}
            // SOL lives in the left rail (and on the element toolbar), so the top bar doesn't repeat it (headerSol: false).
            // SOL in the editor answers right here: the reply streams into the panel and each change it writes is made on the
            // page as it arrives (one Undo takes the whole answer back). Emails are edited by hand, so no SOL there.
            solAutoApply
            onAskSol={
              props.kind === "EMAIL"
                ? undefined
                : (question, context, io) =>
                    askSolStreaming(
                      { question, context: { nodeId: context.nodeId, nodeType: context.nodeType, nodeName: context.nodeName, pageId: context.pageId, design: context.design, catalog: context.catalog }, history: context.history },
                      io.onText,
                      io.signal,
                    )
            }
            pageSettings={
              <PageSettings
                name={name}
                slug={slug}
                email={props.kind === "EMAIL"}
                meta={meta}
                customJs={customJs}
                readOnly={readOnly}
                onRename={(next) => renamePage(templateId, next)}
                onMeta={(m) => {
                  setMeta(m);
                  markDirty();
                }}
                onCustomJs={(code) => {
                  setCustomJs(code);
                  markDirty();
                }}
                onDelete={() => void deletePage(templateId)}
                onGoBack={props.canGoBack ? goBackToClassic : undefined}
              />
            }
            headerRight={props.headerRight}
            // The simple screen keeps saving by itself and has one "Make it live" button; the buttons passed in headerRight match the editor's own.
            experience={props.beginner ? "beginner" : undefined}
            projectName={name}
            headerSlotStyle={props.beginner ? "editor" : undefined}
          />
        </div>
      </div>
    </div>
  );
});

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", color: "var(--ed-t-600)", fontSize: "0.85rem" }}>{children}</div>;
}
