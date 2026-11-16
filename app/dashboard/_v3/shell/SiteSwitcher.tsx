"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { CURRENT_SITE_COOKIE, type SiteSummary } from "@/lib/dashboardV3/sites";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import { Avatar } from "../ui/Avatar";
import { StatusPill } from "../ui/Badge";
import { MenuPanel, useMenu } from "./Menu";

export type SiteSwitcherProps = {
  sites: SiteSummary[];
  currentSiteId?: string | null;
  /** Called after a pick (default: remember it and refresh, so every page shows that site). */
  onSelect?: (id: string) => void;
  /** Default: the new-site wizard (or /dashboard/new). */
  onCreate?: () => void;
};

/**
 * Beginners work on one site at a time: its name, "Switch site" and "Create another website".
 * The choice is remembered in a cookie, so Home and the site pages all follow it.
 */
export function SiteSwitcher({ sites, currentSiteId, onSelect, onCreate }: SiteSwitcherProps) {
  const router = useRouter();
  const newSite = useOptionalNewSite();
  const menu = useMenu();
  const current = sites.find((s) => s.id === currentSiteId) ?? sites[0] ?? null;

  const select = (id: string) => {
    menu.close();
    if (onSelect) return onSelect(id);
    document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
  };
  const create = () => {
    menu.close(false);
    if (onCreate) onCreate();
    else if (newSite) newSite.openNewSite();
    else router.push("/dashboard/new");
  };

  if (!current) {
    return (
      <div className="plx-siteswitch" data-tour="site-switcher">
        <button type="button" className="plx-siteswitch__btn" onClick={create}>
          <span className="plx-avatar plx-avatar--square" style={{ width: 34, height: 34 }} aria-hidden>
            <Plus size={18} />
          </span>
          <span className="plx-siteswitch__text">
            <span className="plx-siteswitch__name">Make your first site</span>
            <span className="plx-siteswitch__hint">Takes about a minute</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div {...menu.wrapProps} className="plx-menu-wrap plx-siteswitch" data-tour="site-switcher">
      <button type="button" className="plx-siteswitch__btn" {...menu.buttonProps} aria-label={`${current.name}. Switch site`}>
        <Avatar name={current.name} size={34} square />
        <span className="plx-siteswitch__text">
          <span className="plx-siteswitch__name">{current.name}</span>
          <span className="plx-siteswitch__hint">Switch site</span>
        </span>
        <ChevronsUpDown size={18} aria-hidden style={{ color: "var(--plx-muted)", flexShrink: 0 }} />
      </button>
      {menu.open ? (
        <MenuPanel align="left" {...menu.menuProps} aria-label="Your sites">
          <span className="plx-menu__label">Your sites</span>
          {sites.map((s) => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={s.id === current.id} className="plx-menu__item" onClick={() => select(s.id)}>
              <span className="plx-siteswitch__row">
                <Avatar name={s.name} size={28} square />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                  <span className="plx-small">{s.kind}</span>
                </span>
                {s.id === current.id ? <Check size={18} aria-hidden style={{ marginLeft: "auto", color: "var(--plx-deep)" }} /> : <StatusPill status={s.status} />}
              </span>
            </button>
          ))}
          <div className="plx-menu__sep" />
          <button type="button" role="menuitem" className="plx-menu__item" onClick={create}>
            <Plus size={18} aria-hidden />
            Create another website
          </button>
          <Link role="menuitem" className="plx-menu__item" href="/dashboard/sites" onClick={() => menu.close(false)}>
            <ChevronsUpDown size={18} aria-hidden />
            See all my sites
          </Link>
        </MenuPanel>
      ) : null}
    </div>
  );
}
