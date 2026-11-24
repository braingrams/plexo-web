"use client";

import { SITE_ROLES, SITE_ROLE_INFO, type SiteAccess, type SiteRole } from "@/lib/access/siteAccess";
import { Select } from "../ui";

export type PickableSite = { id: string; name: string };

/**
 * Choose which sites someone can open and what they can do on each. One row per site: tick it, then pick a role. A site that isn't
 * ticked is invisible to them. Settings that need extra care (web addresses, code, transfer, delete, money) are never part of any role.
 */
export function SiteAccessPicker({ sites, value, onChange, disabled }: { sites: PickableSite[]; value: SiteAccess; onChange: (next: SiteAccess) => void; disabled?: boolean }) {
  const toggle = (id: string, on: boolean) => {
    const next = { ...value };
    if (on) next[id] = next[id] ?? "editor";
    else delete next[id];
    onChange(next);
  };
  return (
    <div className="plx-siteaccess" data-testid="site-access-picker">
      <div className="plx-siteaccess__list">
        {sites.map((s) => {
          const role = value[s.id] as SiteRole | undefined;
          return (
            <div key={s.id} className="plx-siteaccess__row" data-on={role ? "true" : "false"}>
              <label className="plx-siteaccess__name">
                <input type="checkbox" checked={!!role} disabled={disabled} onChange={(e) => toggle(s.id, e.target.checked)} />
                <span>{s.name}</span>
              </label>
              {role ? (
                <div className="plx-siteaccess__role">
                  <Select label={`Role on ${s.name}`} hideLabel value={role} disabled={disabled} onChange={(e) => onChange({ ...value, [s.id]: e.target.value as SiteRole })} options={SITE_ROLES.map((r) => ({ value: r, label: SITE_ROLE_INFO[r].label }))} />
                  <span className="plx-small">{SITE_ROLE_INFO[role].help}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="plx-small" style={{ margin: 0 }}>They only see the sites you tick. Even an Editor can&apos;t change web addresses, header and footer code, redirects, who gets form messages, money settings, transfer the site or delete it. Only you and managers can.</p>
    </div>
  );
}
