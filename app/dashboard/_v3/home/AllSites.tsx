"use client";

import { Eye, Pencil, Plus } from "lucide-react";
import type { HomeSiteRow } from "./homeTypes";
import { Card, ButtonLink, StatusPill } from "../ui";
import { siteHref } from "./SideCards";

function statLine(r: HomeSiteRow) {
  return r.stats.stats.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(" · ");
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

const big: React.CSSProperties = { fontSize: 28, fontWeight: 800, lineHeight: 1.15 };

/** Every site together: friendly cards for intermediate, a dense table for pro. */
export function AllSites({ rows, dense, newSiteHref }: { rows: HomeSiteRow[]; dense: boolean; newSiteHref: string }) {
  const visits = rows.reduce((sum, r) => sum + Number(r.stats.stats.find((s) => s.id === "visits")?.value.replace(/\D/g, "") || 0), 0);
  const live = rows.filter((r) => r.site.status === "live").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} data-tour="home-sites">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
        <Card><span className="plx-small" style={{ fontWeight: 600 }}>Websites</span><div style={big}>{rows.length}</div></Card>
        <Card><span className="plx-small" style={{ fontWeight: 600 }}>Online now</span><div style={big}>{live}</div></Card>
        <Card><span className="plx-small" style={{ fontWeight: 600 }}>Visits this week</span><div style={big}>{visits.toLocaleString("en")}</div></Card>
      </div>
      {dense ? (
        <Card padding="none" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 15 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--plx-muted)" }}>
                {["Site", "Type", "Status", "This week", ""].map((h, i) => (
                  <th key={i} scope="col" style={{ padding: "14px 20px", fontWeight: 600, fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.id} style={{ borderTop: "1px solid var(--plx-border)" }}>
                  <td style={{ padding: "12px 20px", fontWeight: 700 }}>
                    {r.site.name}
                    <div className="plx-small" style={{ fontWeight: 400 }}>{r.site.address ?? (r.site.movedFrom ? `Moved from ${hostOf(r.site.movedFrom)}` : "No web address yet")}</div>
                  </td>
                  <td style={{ padding: "12px 20px" }}>{r.site.kind}</td>
                  <td style={{ padding: "12px 20px" }}><StatusPill status={r.site.status} /></td>
                  <td style={{ padding: "12px 20px", color: "var(--plx-muted)" }}>{statLine(r)}</td>
                  <td style={{ padding: "8px 20px", textAlign: "right" }}>
                    <ButtonLink href={`/dashboard/sites/${r.site.id}`} variant="secondary" size="sm" leftIcon={<Pencil size={14} aria-hidden />}>Edit</ButtonLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
          {rows.map((r) => {
            const href = siteHref(r.site);
            return (
              <Card key={r.site.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="plx-h3" style={{ overflowWrap: "anywhere" }}>{r.site.name}</div>
                    <div className="plx-small" style={{ overflowWrap: "anywhere" }}>{r.site.kind} · {r.site.address ?? (r.site.movedFrom ? `Moved from ${hostOf(r.site.movedFrom)}` : "No web address yet")}</div>
                  </div>
                  <StatusPill status={r.site.status} label={r.site.status === "live" ? "Online" : "Not online yet"} />
                </div>
                <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                  {r.stats.stats.map((s) => (
                    <div key={s.id}>
                      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{s.value}</div>
                      <div className="plx-small">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <ButtonLink href={`/dashboard/sites/${r.site.id}`} variant="strong" size="sm" leftIcon={<Pencil size={14} aria-hidden />}>Edit site</ButtonLink>
                  {href ? <ButtonLink href={href} target="_blank" rel="noopener noreferrer" variant="secondary" size="sm" leftIcon={<Eye size={14} aria-hidden />}>Preview</ButtonLink> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div>
        <ButtonLink href={newSiteHref} variant="secondary" leftIcon={<Plus size={18} aria-hidden />}>
          Create another website
        </ButtonLink>
      </div>
    </div>
  );
}
