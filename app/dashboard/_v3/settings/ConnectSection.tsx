"use client";

import { Check, ChevronDown } from "lucide-react";
import { CONNECT_TOOLS, editorConfig, mcpUrl, type ConnectToolId } from "@/lib/dashboardV3/connectTools";
import { AsideCard, CopyBox, Panel, SettingsPageShell } from "./bits";

const MARK: Record<ConnectToolId, string> = { claude: "C", chatgpt: "G", cursor: "›" };

/** One simple card per tool: copy one link, follow three steps. The technical bits are tucked away. */
export function ConnectSection({ baseUrl, apiKeyHint }: { baseUrl: string; apiKeyHint: string }) {
  const link = mcpUrl(baseUrl);
  return (
    <SettingsPageShell
      title="AI tools"
      purpose="Already use Claude or ChatGPT? Connect them to Plexo and ask for changes in your own words."
      aside={
        <AsideCard title="How it works">
          <ul>
            <li><Check size={16} aria-hidden /> <span>You copy one link and paste it into your AI tool, once.</span></li>
            <li><Check size={16} aria-hidden /> <span>You sign in to Plexo, so the tool can only touch your sites.</span></li>
            <li><Check size={16} aria-hidden /> <span>Then just ask, like &ldquo;make me a pricing page&rdquo;.</span></li>
          </ul>
        </AsideCard>
      }
    >
      <div className="plx-sp__main" data-tour="connect-cards">
        {CONNECT_TOOLS.map((t) => (
          <Panel key={t.id} className="plx-tool">
            <div className="plx-tool__head">
              <span className="plx-tool__mark" aria-hidden>{MARK[t.id]}</span>
              <div>
                <h3>{t.name}</h3>
                <p>{t.tagline}</p>
              </div>
            </div>
            <div>
              <span className="plx-field__label" style={{ display: "block", marginBottom: 8 }}>Your Plexo link</span>
              <CopyBox value={link} label={`Plexo link for ${t.name}`} wrap />
            </div>
            <ol className="plx-steps">
              {t.steps.map((s) => (
                <li key={s}><span style={{ lineHeight: 1.5, paddingTop: 6 }}>{s}</span></li>
              ))}
            </ol>
            <details className="plx-adv">
              <summary>
                {t.advancedTitle} <ChevronDown size={18} aria-hidden />
              </summary>
              {t.id === "cursor" ? (
                <>
                  <p className="plx-small" style={{ margin: "8px 0 0" }}>Rather not sign in? Put this in your editor&apos;s MCP settings, with one of your API keys in place of the example.</p>
                  <pre className="plx-code">{editorConfig(baseUrl, apiKeyHint)}</pre>
                </>
              ) : (
                <>
                  <p className="plx-small" style={{ margin: "8px 0 0" }}>Plexo&apos;s sign-in is handled automatically, so you don&apos;t need to fill in any extra fields. If {t.name} asks for them, leave them empty.</p>
                  <pre className="plx-code plx-code--wrap">{`Name: ${t.connectionName}\nServer URL: ${link}\nSign-in: OAuth (automatic)`}</pre>
                </>
              )}
            </details>
          </Panel>
        ))}
      </div>
    </SettingsPageShell>
  );
}
