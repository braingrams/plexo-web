// Copy-paste code for the Plexo SDK 2 (V2) docs. One source for /sdk, /developers and the dashboard,
// so every page shows the same, tested code. Each snippet type-checks against @charisol/plexo-sdk 2.0.x.

export const SDK_V2_INSTALL = `npm install @charisol/plexo-sdk react react-dom`;

/** Drop the editor into a page. Works with no other setup: blank page, offline, images embedded. */
export const SDK_V2_EMBED = `'use client';

import { useRef } from 'react';
import { V2Editor, type V2EditorRef, type PageDefinition } from '@charisol/plexo-sdk/v2';
import '@charisol/plexo-sdk/dist/plexo-sdk.css';

export function SiteEditor({ pages }: { pages?: PageDefinition[] }) {
  const editor = useRef<V2EditorRef>(null);

  return (
    <div style={{ height: '100vh' }}>
      <V2Editor
        ref={editor}
        pages={pages}                       // omit to start on a blank page
        autoSave
        onSave={async (all) => {
          await fetch('/api/site', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pages: all,
              designSystem: editor.current?.getDesignSystem(),
            }),
          });
        }}
        formAction={(formId) => \`/api/forms/\${formId}\`}   // forms post to your server
        features={{ codeView: false, viewSwitch: false }}  // keep the screen minimal
      />
    </div>
  );
}`;

/** The shortest useful embed, for hero panels and cards. */
export const SDK_V2_SHORT = `import { V2Editor } from "@charisol/plexo-sdk/v2";
import "@charisol/plexo-sdk/dist/plexo-sdk.css";

export default function SiteEditor() {
  return (
    <div style={{ height: "100vh" }}>
      <V2Editor
        onSave={async (pages) => {
          await saveToMyDatabase(pages);
        }}
        formAction={(formId) => \`/api/forms/\${formId}\`}
      />
    </div>
  );
}`;

/** Next.js: the editor uses browser APIs, so load it on the client only. */
export const SDK_V2_NEXT = `// app/editor/page.tsx
'use client';

import dynamic from 'next/dynamic';

const SiteEditor = dynamic(
  () => import('@/components/site-editor').then((m) => m.SiteEditor),
  { ssr: false, loading: () => <p>Loading the editor…</p> },
);

export default function EditorPage() {
  return <SiteEditor />;
}`;

/** Your own page list: you decide where pages live and what they are called. */
export const SDK_V2_PAGES = `import { V2Editor } from '@charisol/plexo-sdk/v2';

<V2Editor
  pages={current ? [current] : undefined}
  pageSource={{
    pages: mySite.pages.map((p) => ({ id: p.id, name: p.title, route: p.path })),
    currentId: current?.id,
    onSelect: (id) => router.push(\`/editor/\${id}\`),
    onCreate: ({ name, templateId }) => createPage(name, templateId),
    onRename: (id, name) => renamePage(id, name),
    onDelete: (id) => deletePage(id),
  }}
/>`;

/** Turn saved pages into clean, safe HTML on your server. No React needed. */
export const SDK_V2_COMPILE = `import {
  compilePageToHtml,
  parsePages,
  sanitizeV2Html,
  type DesignSystem,
} from '@charisol/plexo-sdk/v2/compile';

export function renderPage(saved: unknown, designSystem?: DesignSystem) {
  const parsed = parsePages(saved);               // checks untrusted design data first
  if (!parsed.ok) throw new Error(parsed.error);  // the message is plain English

  const { html, css, script, document, warnings } = compilePageToHtml(
    parsed.pages[0],
    { title: 'My page', designSystem, formAction: (id) => \`/api/forms/\${id}\` },
  );

  // 'document' is a complete page; 'html' + 'css' + 'script' are its parts.
  return { page: sanitizeV2Html(document), warnings };
}`;

/** The same compile as a hosted call, for backends that cannot import the SDK. */
export const SDK_V2_API = `const res = await fetch('https://plexo.charisol.io/api/v1/compile-v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.PLEXO_API_KEY!,
  },
  body: JSON.stringify({
    pages,                         // or: page (a single page)
    designSystem,                  // optional: from editor.getDesignSystem()
    options: { title: 'My page', formActionUrl: 'https://example.com/forms/{formId}' },
  }),
});

const { html, css, script, document, warnings } = await res.json();`;

/** Let an AI assistant edit the site with plain-language requests. */
export const SDK_V2_SOL = `import {
  SOL_SYSTEM_PROMPT,
  applyCommands,
  catalogSchema,
  describeDesign,
  parseSolReply,
  type DesignSystem,
  type PageDefinition,
} from '@charisol/plexo-sdk/v2';

declare function askMyModel(system: string, user: string): Promise<string>;

export async function askSol(
  request: string,
  pages: PageDefinition[],
  designSystem: DesignSystem,
) {
  // Tell the model what the site looks like and what it is allowed to change.
  const context = JSON.stringify({
    catalog: catalogSchema(),
    design: describeDesign(pages, designSystem),
  });
  const reply = await askMyModel(SOL_SYSTEM_PROMPT, \`\${context}\\n\\n\${request}\`);

  const { text, commands } = parseSolReply(reply);
  if (!commands) return { text, pages, designSystem };

  // Every command is checked on its own; bad ones are reported, good ones apply.
  const applied = applyCommands(pages, designSystem, commands);
  return { text, pages: applied.pages, designSystem: applied.designSystem, results: applied.results };
}`;

export const SDK_V2_ALL: Record<string, string> = {
  short: SDK_V2_SHORT,
  embed: SDK_V2_EMBED,
  next: SDK_V2_NEXT,
  pages: SDK_V2_PAGES,
  compile: SDK_V2_COMPILE,
  api: SDK_V2_API,
  sol: SDK_V2_SOL,
};
