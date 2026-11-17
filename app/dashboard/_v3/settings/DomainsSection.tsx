"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, ExternalLink, Globe, Link2, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Input, Modal, SegmentedControl, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import type { AddressRow } from "@/lib/dashboardV3/domainsData";
import { addressCounts, addressStatus, filterAddresses, filtersActive, groupBySite, NO_FILTERS, relinkDomainValue, STATUS_LABEL, switchPlan, type AddressFilters, type AddressStatus } from "@/lib/dashboardV3/domainsView";
import { AsideCard, AsideStats, CopyBox, Notice, SettingsPageShell } from "./bits";

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
  const [dialog, setDialog] = useState<null | "connect" | "find">(null);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AddressFilters>(NO_FILTERS);
  const [grouped, setGrouped] = useState(true);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<AddressRow | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [removing, setRemoving] = useState<AddressRow | null>(null);

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
    setDlgError(null);
    const domain = own.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain.includes(".")) return setDlgError("Please type your full address, like www.mybusiness.com.");
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
      setDialog(null);
      setFilters(NO_FILTERS);
      setClosed(new Set());
      setOpen(id);
      setTimeout(() => document.getElementById(`addr-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      show({ title: "Almost there", description: "Follow the steps below to finish.", tone: "success" });
      if (mock) await loadSteps(row);
      else {
        router.refresh();
        await loadSteps(row).catch(() => undefined);
      }
    } catch (e) {
      setDlgError(errMsg(e));
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
    setBusy(row.id);
    try {
      if (!mock) await hubApi(`/api/v1/domains?id=${row.id}`, { method: "DELETE" }, "We couldn't remove that address.");
      setAddresses((p) => p.filter((x) => x.id !== row.id));
      setRemoving(null);
      show({ title: "Address removed", description: `${row.domain} no longer shows ${row.siteName}.`, tone: "success" });
    } catch (e) {
      setDlgError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  /** Move an address to another of the owner's sites: the same "relink" the address API has always offered, with its plan checks. */
  async function moveSite(row: AddressRow, targetId: string) {
    const target = sites.find((s) => s.id === targetId);
    if (!target) return;
    setDlgError(null);
    setBusy(`move-${row.id}`);
    try {
      if (!mock) await hubApi("/api/v1/domains", { method: "POST", json: { templateId: target.id, type: row.type, domain: relinkDomainValue(row), relink: true } }, "We couldn't switch that address. Please try again.");
      setAddresses((p) => p.map((x) => (x.id === row.id ? { ...x, siteId: target.id, siteName: target.name } : x)));
      setMoving(null);
      show({ title: "Address switched", description: `${row.domain} now shows ${target.name}.`, tone: "success" });
      if (!mock) router.refresh();
    } catch (e) {
      setDlgError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy("search");
    setDlgError(null);
    try {
      const d = mock
        ? { results: [{ domain: `${q.replace(/\..*$/, "")}.com`, available: true, registrationPriceUsdCents: 1299 }, { domain: `${q.replace(/\..*$/, "")}.shop`, available: true, registrationPriceUsdCents: 2400 }, { domain: `${q.replace(/\..*$/, "")}.net`, available: false, registrationPriceUsdCents: null }] }
        : await hubApi<{ results?: Found[] }>(`/api/v1/domains/search?q=${encodeURIComponent(q)}`, undefined, "We couldn't search just now. Please try again.");
      setFound(d.results ?? []);
    } catch (e) {
      setDlgError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => addressCounts(addresses), [addresses]);
  const shown = useMemo(() => filterAddresses(addresses, filters), [addresses, filters]);
  const groups = useMemo(() => groupBySite(shown), [shown]);
  const useGroups = grouped && sites.length > 1 && groups.length > 0;
  const active = filtersActive(filters);
  const patch = (p: Partial<AddressFilters>) => setFilters((f) => ({ ...f, ...p }));
  const target = sites.find((s) => s.id === moveTo);
  const plan = moving ? switchPlan(moving, target, addresses) : null;

  function openMove(row: AddressRow) {
    setDlgError(null);
    setMoving(row);
    setMoveTo(sites.find((s) => s.id !== row.siteId)?.id ?? "");
  }

  function renderRow(row: AddressRow) {
    const st = steps[row.id];
    const status = addressStatus(row);
    return (
      <div key={row.id} id={`addr-${row.id}`}>
        <div className="plx-addrrow">
          <span className="plx-tile"><Globe size={20} aria-hidden /></span>
          <div className="plx-addrrow__main">
            <a href={`https://${row.domain}`} target="_blank" rel="noreferrer">{row.domain} <ExternalLink size={14} aria-hidden /></a>
            <span className="plx-addrrow__sub">
              <Badge tone={status === "online" ? "success" : "warning"} dot={status === "online"}>{row.pausedByPlan ? "Paused by your plan" : STATUS_LABEL[status]}</Badge>
              {row.type === "SUBDOMAIN" ? "Free address from Plexo" : row.bought ? "Bought through Plexo" : "Your own address"}
            </span>
          </div>
          {sites.length > 1 ? (
            <button type="button" className="plx-showsbtn" onClick={() => openMove(row)} aria-label={`${row.domain} shows ${row.siteName}. Change site.`}>
              <span><small>Shows</small><b>{row.siteName}</b></span>
              <ChevronDown size={16} aria-hidden />
            </button>
          ) : (
            <span className="plx-showsbtn plx-showsbtn--static"><span><small>Shows</small><b>{row.siteName}</b></span></span>
          )}
          <div className="plx-addrrow__end">
            {row.type === "CUSTOM" && !row.online ? <Button size="sm" variant="secondary" aria-expanded={open === row.id} onClick={() => toggle(row)}>{open === row.id ? "Hide steps" : "Show steps"}</Button> : null}
            <RowMenu label={`More for ${row.domain}`}>
              {sites.length > 1 ? <button type="button" role="menuitem" className="plx-menu__item" onClick={() => openMove(row)}><ArrowRight size={16} aria-hidden /> Change site</button> : null}
              <button type="button" role="menuitem" className="plx-menu__item plx-menu__bad" onClick={() => { setDlgError(null); setRemoving(row); }}><Trash2 size={16} aria-hidden /> Remove address</button>
            </RowMenu>
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
  }

  const statusChips: { id: AddressStatus; n: number }[] = [
    { id: "online", n: counts.online },
    { id: "setting-up", n: counts["setting-up"] },
    { id: "attention", n: counts.attention },
  ];

  return (
    <SettingsPageShell
      title="Domains"
      purpose="Every web address that points to your sites, in one place."
      aside={
        <>
          <AsideCard title="Your addresses" icon={Globe}>
            <AsideStats items={[
              { label: "In all", value: counts.total },
              { label: "Online", value: counts.online, tone: "ok" },
              { label: "Setting up", value: counts["setting-up"], tone: counts["setting-up"] ? "warn" : undefined },
              { label: "Need attention", value: counts.attention, tone: counts.attention ? "bad" : undefined },
            ]} />
            {counts["setting-up"] ? <p>{counts["setting-up"]} {counts["setting-up"] === 1 ? "address is" : "addresses are"} waiting for you. Open &ldquo;Show steps&rdquo; on it and follow the numbered list. It takes about five minutes, then a short wait.</p> : null}
          </AsideCard>
          <AsideCard title="How addresses work" icon={Link2}>
            <ul>
              <li><Check size={16} aria-hidden /> <span><b>Free address.</b> Every site gets one from Plexo, ready to share.</span></li>
              <li><Check size={16} aria-hidden /> <span><b>Your own address.</b> Like mybusiness.com. Connect one you own, or find a new one.</span></li>
              <li><Check size={16} aria-hidden /> <span><b>Switch sites.</b> Each address shows one site. You can change which one any time.</span></li>
            </ul>
          </AsideCard>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <div className="plx-getaddr" data-tour="domains-connect">
        <button type="button" className="plx-getaddr__card" onClick={() => { setDlgError(null); setDialog("connect"); }}>
          <span className="plx-tile"><Link2 size={22} aria-hidden /></span>
          <span className="plx-getaddr__text"><b>Connect my own address</b><span>Already own one, like mybusiness.com? We&apos;ll show you exactly what to do.</span></span>
          <ArrowRight size={18} aria-hidden />
        </button>
        <button type="button" className="plx-getaddr__card" data-tour="domains-buy" onClick={() => { setDlgError(null); setDialog("find"); }}>
          <span className="plx-tile"><Search size={22} aria-hidden /></span>
          <span className="plx-getaddr__text"><b>Find a new address</b><span>Don&apos;t have one yet? Search for a name and we&apos;ll set it up for you.</span></span>
          <ArrowRight size={18} aria-hidden />
        </button>
      </div>

      <section className="plx-card plx-addrlist" data-tour="domains-list" aria-label="Your addresses">
        <div className="plx-addrlist__head">
          <h3>Your addresses <small>{active ? `${shown.length} of ${addresses.length}` : addresses.length}</small></h3>
          {addresses.length > 6 && sites.length > 1 ? <SegmentedControl label="How to list them" value={grouped ? "site" : "list"} onChange={(v) => setGrouped(v === "site")} options={[{ value: "site", label: "By site" }, { value: "list", label: "One list" }]} /> : null}
        </div>
        {addresses.length > 5 ? (
          <div className="plx-addrtools">
            <Input label="Search your addresses" hideLabel value={filters.q} onChange={(e) => patch({ q: e.target.value })} placeholder="Search by address or site" autoCapitalize="none" type="search" />
            {sites.length > 1 ? <Select label="Site" hideLabel value={filters.siteId} onChange={(e) => patch({ siteId: e.target.value })} options={[{ value: "all", label: "All sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))]} /> : null}
            <Select label="Kind of address" hideLabel value={filters.kind} onChange={(e) => patch({ kind: e.target.value as AddressFilters["kind"] })} options={[{ value: "all", label: "All kinds" }, { value: "own", label: `Your own (${counts.own})` }, { value: "free", label: `Free from Plexo (${counts.free})` }]} />
            <div className="plx-chips" role="group" aria-label="Status">
              {statusChips.map((c) => (
                <button key={c.id} type="button" className="plx-chip" data-status={c.id} aria-pressed={filters.status === c.id} disabled={!c.n && filters.status !== c.id} onClick={() => patch({ status: filters.status === c.id ? "all" : c.id })}>{STATUS_LABEL[c.id]} <small>{c.n}</small></button>
              ))}
            </div>
          </div>
        ) : null}
        {addresses.length === 0 ? (
          <p className="plx-body" style={{ padding: "0 28px 28px" }}>No addresses yet. Use the two buttons above to connect your own or find a new one.</p>
        ) : shown.length === 0 ? (
          <div className="plx-addrempty">
            <p>No addresses match that.</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>Show all addresses</Button>
          </div>
        ) : useGroups ? (
          groups.map((g) => {
            const shut = closed.has(g.siteId);
            return (
              <div key={g.siteId} className="plx-addrgroup">
                <button type="button" className="plx-addrgroup__head" aria-expanded={!shut} onClick={() => setClosed((p) => { const n = new Set(p); if (n.has(g.siteId)) n.delete(g.siteId); else n.add(g.siteId); return n; })}>
                  <ChevronDown size={18} aria-hidden style={{ transform: shut ? "rotate(-90deg)" : undefined }} />
                  <b>{g.siteName}</b>
                  <small>{g.rows.length} {g.rows.length === 1 ? "address" : "addresses"}</small>
                </button>
                {shut ? null : g.rows.map(renderRow)}
              </div>
            );
          })
        ) : (
          shown.map(renderRow)
        )}
      </section>

      <Modal open={dialog === "connect"} onClose={() => setDialog(null)} title="Connect my own address" description="Like mybusiness.com. We'll show you exactly what to do next." width={560}
        footer={sites.length === 0 ? <Button variant="secondary" onClick={() => setDialog(null)}>Close</Button> : (<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy === "connect"} disabled={!own.trim() || !canUseOwn} onClick={connect}>Connect it</Button></>)}>
        {sites.length === 0 ? (
          <p className="plx-body">Make a site first, then connect your address to it.</p>
        ) : (
          <div className="plx-sform plx-sform--wide">
            <Select label="Which site is it for?" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
            <Input label="Your address" value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && own.trim() && canUseOwn && void connect()} placeholder="www.mybusiness.com" autoCapitalize="none" autoCorrect="off" help="Type it the way people would, like www.mybusiness.com." />
            {!canUseOwn ? <Notice tone="warn">Your own address comes with the Starter plan. <a href="/dashboard/settings/plan" style={{ fontWeight: 700 }}>See plans</a></Notice> : null}
            {dlgError ? <Notice tone="bad">{dlgError}</Notice> : null}
          </div>
        )}
      </Modal>

      <Modal open={dialog === "find"} onClose={() => setDialog(null)} title="Find a new address" description="Search for a name and we'll set it up for you." width={600} footer={<Button variant="secondary" onClick={() => setDialog(null)}>Close</Button>}>
        <div className="plx-sform plx-sform--wide">
          <div className="plx-searchrow">
            <Input label="Search for a name" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="amaskitchen" onKeyDown={(e) => e.key === "Enter" && void search()} autoCapitalize="none" />
            <Button variant="secondary" loading={busy === "search"} disabled={!query.trim()} leftIcon={<Search size={16} aria-hidden />} onClick={search}>Search</Button>
          </div>
          {dlgError ? <Notice tone="bad">{dlgError}</Notice> : null}
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
      </Modal>

      <Modal open={!!moving} onClose={() => setMoving(null)} title={moving ? `Change what ${moving.domain} shows` : ""} description="Pick which of your sites visitors should see at this address." width={560}
        footer={<><Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button><Button loading={moving ? busy === `move-${moving.id}` : false} disabled={!plan || !!plan.blocked} onClick={() => moving && void moveSite(moving, moveTo)}>{target ? `Show ${target.name}` : "Show this site"}</Button></>}>
        {moving ? (
          <div className="plx-sform plx-sform--wide">
            <p className="plx-body" style={{ margin: 0 }}>Right now it shows <b>{moving.siteName}</b>.</p>
            <Select label="Show this site instead" value={moveTo} onChange={(e) => { setMoveTo(e.target.value); setDlgError(null); }} options={sites.filter((s) => s.id !== moving.siteId).map((s) => ({ value: s.id, label: s.name }))} />
            {plan?.blocked ? <Notice tone="warn">{plan.blocked}</Notice> : (
              <div className="plx-switchplan" aria-live="polite">
                <b>What will change</b>
                <ul>{plan?.lines.map((l) => <li key={l}><Check size={16} aria-hidden /> <span>{l}</span></li>)}</ul>
              </div>
            )}
            {dlgError ? <Notice tone="bad">{dlgError}</Notice> : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Remove ${removing.domain}?` : ""} width={480}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Keep it</Button><Button variant="danger" loading={removing ? busy === removing.id : false} onClick={() => removing && void remove(removing)}>Remove address</Button></>}>
        {removing ? (
          <div className="plx-sform plx-sform--wide">
            <p className="plx-body" style={{ margin: 0 }}>People who visit {removing.domain} will no longer see {removing.siteName}. The site itself is not deleted{removing.type === "CUSTOM" ? ", and you keep the address you bought" : ""}.</p>
            {dlgError ? <Notice tone="bad">{dlgError}</Notice> : null}
          </div>
        ) : null}
      </Modal>
    </SettingsPageShell>
  );
}

/** A small "…" menu for the less common things on a row. Closes on outside tap or Escape. */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOn(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOn(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [on]);
  return (
    <div className="plx-menu-wrap" ref={box} onClick={() => on && setOn(false)}>
      <Button size="sm" variant="ghost" iconOnly aria-label={label} aria-haspopup="menu" aria-expanded={on} onClick={(e) => { e.stopPropagation(); setOn((v) => !v); }}><MoreHorizontal size={18} aria-hidden /></Button>
      {on ? <div className="plx-menu" role="menu">{children}</div> : null}
    </div>
  );
}
