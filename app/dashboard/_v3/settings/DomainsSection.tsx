"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Globe, Search } from "lucide-react";
import { Badge, Button, ButtonLink, Input, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import type { AddressRow } from "@/lib/dashboardV3/domainsData";
import { AsideCard, CopyBox, Notice, Panel, SettingsPageShell } from "./bits";

type Steps = { validationName?: string | null; validationValue?: string | null; routing?: string | null; live: boolean };
type Found = { domain: string; available: boolean; registrationPriceUsdCents: number | null; reason?: string };

const usd = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2).replace(/\.00$/, "")} a year`);

/** All web addresses across the user's sites, connecting their own, and finding a new one. */
export function DomainsSection({ addresses: a0, sites, canUseOwn, mock = false }: { addresses: AddressRow[]; sites: { id: string; name: string }[]; canUseOwn: boolean; mock?: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const [addresses, setAddresses] = useState(a0);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [own, setOwn] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, Steps>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSteps(row: AddressRow) {
    if (mock) {
      setSteps((p) => ({ ...p, [row.id]: { validationName: "_a1b2c3.mybusiness.com", validationValue: "_x9y8z7.acm-validations.aws", routing: "sites.plexopages.com", live: false } }));
      return;
    }
    const d = await hubApi<{ domains: { id: string; certificateStatus?: string | null; certificateValidationName?: string | null; certificateValidationValue?: string | null }[]; routingEndpoint?: string }>(`/api/v1/domains?templateId=${row.siteId}`, { cache: "no-store" });
    const m = d.domains.find((x) => x.id === row.id);
    setSteps((p) => ({ ...p, [row.id]: { validationName: m?.certificateValidationName, validationValue: m?.certificateValidationValue, routing: d.routingEndpoint, live: m?.certificateStatus === "ATTACHED" } }));
  }

  async function toggle(row: AddressRow) {
    if (open === row.id) return setOpen(null);
    setOpen(row.id);
    try {
      await loadSteps(row);
    } catch (e) {
      setError(errMsg(e, "We couldn't load the steps."));
    }
  }

  async function connect() {
    setError(null);
    const domain = own.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain.includes(".")) return setError("Please type your full address, like www.mybusiness.com.");
    setBusy("connect");
    try {
      let id = `new-${Date.now()}`;
      if (!mock) {
        const d = await hubApi<{ domain?: { id: string }; id?: string }>("/api/v1/domains", { method: "POST", json: { templateId: siteId, type: "CUSTOM", domain } }, "We couldn't connect that address. Please try again.");
        id = d.domain?.id ?? d.id ?? id;
      }
      const row: AddressRow = { id, domain, type: "CUSTOM", siteId, siteName: sites.find((s) => s.id === siteId)?.name ?? "Your site", online: false, pausedByPlan: false, bought: false };
      setAddresses((p) => [row, ...p]);
      setOwn("");
      setOpen(id);
      show({ title: "Almost there", description: "Follow the steps below to finish.", tone: "success" });
      if (mock) await loadSteps(row);
      else {
        router.refresh();
        await loadSteps(row).catch(() => undefined);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(row: AddressRow) {
    setBusy(row.id);
    try {
      const r = mock ? { valid: false } : await hubApi<{ valid: boolean }>(`/api/v1/domains/verify?domain=${encodeURIComponent(row.domain)}`);
      show({ title: r.valid ? "Connected" : "Not ready yet", description: r.valid ? undefined : "It can take a few hours after you change the settings. Check again later.", tone: r.valid ? "success" : "info" });
      if (r.valid) {
        setAddresses((p) => p.map((x) => (x.id === row.id ? { ...x, online: true } : x)));
        setOpen(null);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: AddressRow) {
    if (!window.confirm(`Take ${row.domain} off ${row.siteName}? People who visit it will no longer see the site.`)) return;
    setBusy(row.id);
    try {
      if (!mock) await hubApi(`/api/v1/domains?id=${row.id}`, { method: "DELETE" }, "We couldn't remove that address.");
      setAddresses((p) => p.filter((x) => x.id !== row.id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy("search");
    setError(null);
    try {
      const d = mock
        ? { results: [{ domain: `${q.replace(/\..*$/, "")}.com`, available: true, registrationPriceUsdCents: 1299 }, { domain: `${q.replace(/\..*$/, "")}.shop`, available: true, registrationPriceUsdCents: 2400 }, { domain: `${q.replace(/\..*$/, "")}.net`, available: false, registrationPriceUsdCents: null }] }
        : await hubApi<{ results?: Found[] }>(`/api/v1/domains/search?q=${encodeURIComponent(q)}`, undefined, "We couldn't search just now. Please try again.");
      setFound(d.results ?? []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const waiting = addresses.filter((a) => a.type === "CUSTOM" && !a.online).length;
  return (
    <SettingsPageShell
      title="Domains"
      purpose="Every web address that points to your sites, in one place."
      aside={
        <>
          <AsideCard title="How addresses work">
            <ul>
              <li><Check size={16} aria-hidden /> <span><b>Free address.</b> Every site gets one from Plexo, ready to share.</span></li>
              <li><Check size={16} aria-hidden /> <span><b>Your own address.</b> Like mybusiness.com. Connect one you own, or find a new one.</span></li>
              <li><Check size={16} aria-hidden /> <span><b>Nothing breaks.</b> Your free address keeps working while you set up your own.</span></li>
            </ul>
          </AsideCard>
          {waiting ? (
            <AsideCard title="Waiting for you">
              <p>{waiting} {waiting === 1 ? "address is" : "addresses are"} not connected yet. Open &ldquo;Show steps&rdquo; on the address and follow the numbered list. It takes about five minutes, then a short wait.</p>
            </AsideCard>
          ) : null}
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Panel title="Your addresses" description={addresses.length ? `${addresses.length} across your sites.` : undefined} flush data-tour="domains-list">
        {addresses.length === 0 ? (
          <p className="plx-body" style={{ padding: "0 28px 28px" }}>No addresses yet. Pick a free one in your site&apos;s &ldquo;Web address&rdquo; tab, or connect your own below.</p>
        ) : (
          addresses.map((row) => {
            const st = steps[row.id];
            return (
              <div key={row.id}>
                <div className="plx-addrrow">
                  <span className="plx-tile"><Globe size={20} aria-hidden /></span>
                  <div className="plx-addrrow__main">
                    <a href={`https://${row.domain}`} target="_blank" rel="noreferrer">{row.domain} <ExternalLink size={14} aria-hidden /></a>
                    <span>{row.siteName}{row.type === "SUBDOMAIN" ? " · free address from Plexo" : row.bought ? " · bought through Plexo" : " · your own address"}</span>
                  </div>
                  {row.pausedByPlan ? <Badge tone="warning">Paused by your plan</Badge> : row.online ? <Badge tone="success" dot>Online</Badge> : <Badge tone="warning">Waiting for you</Badge>}
                  <div className="plx-addrrow__end">
                    {row.type === "CUSTOM" && !row.online ? <Button size="sm" variant="secondary" aria-expanded={open === row.id} onClick={() => toggle(row)}>{open === row.id ? "Hide steps" : "Show steps"}</Button> : null}
                    <Button size="sm" variant="ghost" loading={busy === row.id} onClick={() => remove(row)}>Remove</Button>
                  </div>
                </div>
                {open === row.id && row.type === "CUSTOM" ? (
                  <div className="plx-addrsteps">
                    <ol className="plx-steps">
                      <li><div><b>Open the website where you bought {row.domain}.</b><p className="plx-small" style={{ margin: "4px 0 0" }}>That&apos;s a company like GoDaddy, Namecheap or Google Domains. Sign in and find the settings for your address.</p></div></li>
                      {st?.validationName && st.validationValue ? (
                        <li><div><b>Add this first entry.</b> It proves the address is yours.
                          <div className="plx-dnsrow" style={{ marginTop: 8 }}><span className="plx-small">Type: CNAME · Name:</span><CopyBox label="Name" value={st.validationName} /><span className="plx-small">Points to:</span><CopyBox label="Points to" value={st.validationValue} /></div></div></li>
                      ) : null}
                      {st?.routing ? (
                        <li><div><b>Add this second entry.</b> It sends visitors to your site.
                          <div className="plx-dnsrow" style={{ marginTop: 8 }}><span className="plx-small">Type: CNAME · Name: {row.domain.split(".").length > 2 ? row.domain.split(".")[0] : "www"} · Points to:</span><CopyBox label="Sends visitors to" value={st.routing} /></div></div></li>
                      ) : null}
                      <li><div><b>Wait a little, then check.</b><p className="plx-small" style={{ margin: "4px 0 10px" }}>It can take a few minutes to a few hours. Your free address keeps working meanwhile.</p>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <Button size="sm" loading={busy === row.id} onClick={() => check(row)}>Check now</Button>
                          <ButtonLink size="sm" variant="secondary" href={`/dashboard/sol?new=1&draft=${encodeURIComponent(`Help me connect my own domain ${row.domain} to my site "${row.siteName}". I'm not technical, please go step by step.`)}`}>We&apos;ll help you do it</ButtonLink>
                        </div></div></li>
                    </ol>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </Panel>

      <div className="plx-sp__split">
        <Panel title="Use an address you already own" description="Like mybusiness.com. We'll show you exactly what to do." data-tour="domains-connect">
          {sites.length === 0 ? (
            <p className="plx-body">Make a site first, then connect your address to it.</p>
          ) : (
            <div className="plx-sform plx-sform--wide">
              <Select label="Which site is it for?" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              <Input label="Your address" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="www.mybusiness.com" autoCapitalize="none" autoCorrect="off" help="Type it the way people would, like www.mybusiness.com." />
              {!canUseOwn ? <Notice tone="warn">Your own address comes with the Starter plan. <a href="/dashboard/settings/plan" style={{ fontWeight: 700 }}>See plans</a></Notice> : null}
              <div><Button loading={busy === "connect"} disabled={!own.trim() || !canUseOwn} onClick={connect}>Connect it</Button></div>
            </div>
          )}
        </Panel>

        <Panel title="Find a new address" description="Don't have one yet? Search for a name and we'll set it up for you." data-tour="domains-buy">
          <div className="plx-sform plx-sform--wide">
            <div className="plx-searchrow">
              <Input label="Search for a name" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="amaskitchen" onKeyDown={(e) => e.key === "Enter" && void search()} autoCapitalize="none" />
              <Button variant="secondary" loading={busy === "search"} disabled={!query.trim()} leftIcon={<Search size={16} aria-hidden />} onClick={search}>Search</Button>
            </div>
            {found ? (
              found.length === 0 ? <p className="plx-small" style={{ margin: 0 }}>We couldn&apos;t find anything for that. Try another name.</p> : (
                <div>
                  {found.map((f) => (
                    <div key={f.domain} className="plx-findrow">
                      <div>
                        <b>{f.domain}</b>
                        <span className="plx-small">{f.available ? (usd(f.registrationPriceUsdCents) ?? "Available") : "Already taken"}</span>
                      </div>
                      {f.available ? <ButtonLink size="sm" href={`/dashboard/domains?classic=1&q=${encodeURIComponent(f.domain)}`}>Get it</ButtonLink> : <Badge tone="neutral">Taken</Badge>}
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>
        </Panel>
      </div>
    </SettingsPageShell>
  );
}
