"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Input, useToast } from "../ui";
import { slugify } from "@/lib/dashboardV3/hubTabs";
import { solStudioHref } from "@/lib/dashboardV3/solStudioLink";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Domain = { id: string; domain: string; type: "SUBDOMAIN" | "CUSTOM"; active?: boolean; certificateStatus?: string | null; certificateValidationName?: string | null; certificateValidationValue?: string | null; dnsVerified?: boolean };
type Loaded = { domains: Domain[]; baseDomain: string; routingEndpoint?: string; limit: number; count: number };

function CopyBox({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="plx-copybox">
      <code aria-label={label}>{value}</code>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function AddressTab({ siteId, siteName, experience }: { siteId: string; siteName: string; experience: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(slugify(siteName).slice(0, 30));
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const beginner = experience === "beginner";

  const load = useCallback(async () => {
    try {
      setData(await hubApi<Loaded>(`/api/v1/domains?templateId=${siteId}`, { cache: "no-store" }));
    } catch (e) {
      setError(errMsg(e, "We couldn't load your web addresses."));
    }
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);

  const free = data?.domains.find((d) => d.type === "SUBDOMAIN");
  const customs = data?.domains.filter((d) => d.type === "CUSTOM") ?? [];

  async function add(type: "SUBDOMAIN" | "CUSTOM", domain: string) {
    setBusy(type);
    setError(null);
    try {
      await hubApi("/api/v1/domains", { method: "POST", json: { templateId: siteId, type, domain } }, "We couldn't set that address up. Please try again.");
      show({ title: type === "SUBDOMAIN" ? "Your site is online" : "Almost there", description: type === "SUBDOMAIN" ? `${domain}.${data?.baseDomain}` : "Follow the steps below to finish.", tone: "success" });
      if (type === "CUSTOM") setOwn("");
      await load();
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: Domain) {
    if (!window.confirm(`Take ${d.domain} off this site? People who visit it will no longer see your site.`)) return;
    setBusy(d.id);
    try {
      await hubApi(`/api/v1/domains?id=${d.id}`, { method: "DELETE" });
      await load();
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(d: Domain) {
    setBusy(d.id);
    try {
      const r = await hubApi<{ valid: boolean }>(`/api/v1/domains/verify?domain=${encodeURIComponent(d.domain)}`);
      show({ title: r.valid ? "Connected" : "Not ready yet", description: r.valid ? undefined : "It can take a few hours after you change the settings. Check again later.", tone: r.valid ? "success" : "info" });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const helpHref = solStudioHref(`Help me connect my own domain${customs[0] ? ` ${customs[0].domain}` : ""} to my site "${siteName}". I'm not technical, please go step by step.`, { siteId });

  return (
    <>
      <TabBar title="Your web address" sub="This is what people type to find your site." />
      {error ? <GateOrError error={error}><div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div></GateOrError> : null}

      <Card data-tour="hub-address">
        <CardHeader title="Free address from Plexo" description={free ? "People can visit your site here right now." : "Pick a short name for your site. It's free and works straight away."} />
        {free ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <a href={`https://${free.domain}`} target="_blank" rel="noreferrer" className="plx-h3" style={{ display: "inline-flex", gap: 8, alignItems: "center", overflowWrap: "anywhere" }}>
              <Globe size={18} aria-hidden /> {free.domain} <ExternalLink size={14} aria-hidden />
            </a>
            <Badge tone="success" dot>Online</Badge>
            <Button variant="ghost" size="sm" loading={busy === free.id} onClick={() => remove(free)}>Change</Button>
          </div>
        ) : data ? (
          <div className="plx-form" style={{ maxWidth: 560 }}>
            <div>
              <label className="plx-field__label" htmlFor="sub">Choose your address</label>
              <div className="plx-addr" style={{ marginTop: 8 }}>
                <input id="sub" className="plx-input" value={name} onChange={(e) => setName(slugify(e.target.value))} placeholder="amas-kitchen" autoComplete="off" />
                <span className="plx-addr__suffix">.{data.baseDomain}</span>
              </div>
              <p className="plx-field__help" style={{ marginTop: 8 }}>Letters, numbers and dashes. You can change it later.</p>
            </div>
            <div>
              <Button loading={busy === "SUBDOMAIN"} disabled={!name} onClick={() => add("SUBDOMAIN", name)}>Put my site online</Button>
            </div>
          </div>
        ) : (
          <p className="plx-body">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title={beginner ? "Use your own address" : "Connect your own domain"} description={beginner ? "Already own an address like mybusiness.com? Connect it here. We'll walk you through it." : "Point a domain you own at this site. We'll show the records to add."} />
        {customs.map((d) => {
          const live = d.active !== false && (d.certificateStatus === "ATTACHED" || d.dnsVerified);
          return (
            <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 20, marginBottom: 20, borderBottom: "1px solid var(--plx-border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <b className="plx-h3" style={{ overflowWrap: "anywhere" }}>{d.domain}</b>
                {live ? <Badge tone="success" dot>Connected</Badge> : <Badge tone="warning">Waiting for you</Badge>}
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="secondary" loading={busy === d.id} onClick={() => check(d)}>Check again</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(d)}>Remove</Button>
              </div>
              {!live ? (
                <ol className="plx-steps">
                  <li>
                    <div>
                      <b>Open the website where you bought {d.domain}.</b>
                      <p className="plx-small" style={{ margin: "4px 0 0" }}>That&apos;s a company like GoDaddy, Namecheap or Google Domains. Sign in and find {beginner ? "the settings for your address" : "DNS settings"}.</p>
                    </div>
                  </li>
                  {d.certificateValidationName && d.certificateValidationValue ? (
                    <li>
                      <div>
                        <b>Add this first entry.</b> It proves the address is yours.
                        <p className="plx-small" style={{ margin: "6px 0 0" }}>Type: CNAME · Name:</p>
                        <CopyBox label="Name" value={d.certificateValidationName} />
                        <p className="plx-small" style={{ margin: "10px 0 0" }}>Points to:</p>
                        <CopyBox label="Points to" value={d.certificateValidationValue} />
                      </div>
                    </li>
                  ) : null}
                  {data?.routingEndpoint ? (
                    <li>
                      <div>
                        <b>Add this second entry.</b> It sends visitors to your site.
                        <p className="plx-small" style={{ margin: "6px 0 0" }}>Type: CNAME · Name: {d.domain.split(".").length > 2 ? d.domain.split(".")[0] : "www"} · Points to:</p>
                        <CopyBox label="Sends visitors to" value={data.routingEndpoint} />
                      </div>
                    </li>
                  ) : null}
                  <li>
                    <div>
                      <b>Wait a little, then tap &ldquo;Check again&rdquo;.</b>
                      <p className="plx-small" style={{ margin: "4px 0 0" }}>It can take from a few minutes to a few hours. Your free address keeps working meanwhile.</p>
                    </div>
                  </li>
                </ol>
              ) : null}
            </div>
          );
        })}
        <div className="plx-form" style={{ maxWidth: 560 }}>
          <Input label="Your address" value={own} onChange={(e) => setOwn(e.target.value.trim().toLowerCase())} placeholder="www.mybusiness.com" help={data && data.limit >= 0 && data.count >= data.limit ? "Your plan's own-address limit is used up. Upgrade to add another." : undefined} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Button loading={busy === "CUSTOM"} disabled={!own} onClick={() => add("CUSTOM", own)}>Connect it</Button>
            <ButtonLink href={helpHref} variant="secondary">We&apos;ll help you do it</ButtonLink>
          </div>
          <p className="plx-small">
            Don&apos;t own one yet? <ButtonLink href="/dashboard/settings/domains" variant="link" size="sm">Find and buy an address</ButtonLink>
          </p>
        </div>
      </Card>
    </>
  );
}
