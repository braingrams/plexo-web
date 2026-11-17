"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { CURRENT_SITE_COOKIE, type SiteSummary } from "@/lib/dashboardV3/sites";
import { switchGroups, type SwitchRow } from "@/lib/dashboardV3/siteSwitch";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import { Avatar } from "../ui/Avatar";
import { FloatingPanel } from "../ui/FloatingPanel";

export type SiteSwitcherProps = {
  sites: SiteSummary[];
  currentSiteId?: string | null;
  /** Called after a pick (default: remember it and refresh, so every page shows that site). */
  onSelect?: (id: string) => void;
  /** Default: the new-site wizard (or /dashboard/new). */
  onCreate?: () => void;
};

/**
 * The current site's name and "Switch site". Opens a panel above the page: search, the five
 * most recent sites, then all of them A to Z. Each row says what it is and tells look-alikes
 * apart. Arrow keys move, Enter picks, Esc closes.
 */
export function SiteSwitcher({ sites, currentSiteId, onSelect, onCreate }: SiteSwitcherProps) {
  const router = useRouter();
  const newSite = useOptionalNewSite();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = sites.find((s) => s.id === currentSiteId) ?? sites[0] ?? null;

  const create = () => {
    setOpen(false);
    if (onCreate) onCreate();
    else if (newSite) newSite.openNewSite();
    else router.push("/dashboard/new");
  };
  const select = (id: string) => {
    setOpen(false);
    button.current?.focus();
    if (id === current?.id) return;
    if (onSelect) return onSelect(id);
    document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
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
    <div className="plx-siteswitch" data-tour="site-switcher">
      <button ref={button} type="button" className="plx-siteswitch__btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`${current.name}. Switch site`}>
        <Avatar name={current.name} size={34} square />
        <span className="plx-siteswitch__text">
          <span className="plx-siteswitch__name" title={current.name}>{current.name}</span>
          <span className="plx-siteswitch__hint">Switch site</span>
        </span>
        <ChevronsUpDown size={18} aria-hidden style={{ color: "var(--plx-muted)", flexShrink: 0 }} />
      </button>
      <FloatingPanel open={open} onClose={() => setOpen(false)} anchorRef={button} width={380} label="Switch site">
        <SitePicker sites={sites} currentId={current.id} onPick={select} onCreate={create} onNavigate={() => setOpen(false)} />
      </FloatingPanel>
    </div>
  );
}

function Row({ row, id, selected, active, onPick, onHover }: { row: SwitchRow; id: string; selected: boolean; active: boolean; onPick: () => void; onHover: () => void }) {
  const { site, detail } = row;
  return (
    <li role="presentation">
      <button type="button" role="option" id={id} aria-selected={selected} data-active={active} tabIndex={-1} className="plx-sitepick__row" title={`${site.name} · ${site.kind} · ${detail}`} onClick={onPick} onMouseMove={onHover}>
        <Avatar name={site.name} size={36} square />
        <span className="plx-sitepick__text">
          <span className="plx-sitepick__name">{site.name}</span>
          <span className="plx-sitepick__meta">
            <span className={`plx-sitepick__dot plx-sitepick__dot--${site.status}`} role="img" aria-label={site.status === "live" ? "Online" : "Not online yet"} />
            {site.kind} · {detail}
          </span>
        </span>
        {selected ? <Check size={18} aria-hidden className="plx-sitepick__check" /> : null}
      </button>
    </li>
  );
}

/** The search box + list. Exported so the phone sheet and the preview can show the same thing. */
export function SitePicker({ sites, currentId, onPick, onCreate, onNavigate }: { sites: SiteSummary[]; currentId: string; onPick: (id: string) => void; onCreate: () => void; onNavigate: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();
  const groups = useMemo(() => switchGroups(sites, query), [sites, query]);
  const flat = groups.flat;
  const idFor = (i: number) => `${uid}-opt-${i}`;

  useEffect(() => {
    input.current?.focus();
    const at = flat.findIndex((r) => r.site.id === currentId);
    setActiveIndex(Math.max(at, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${idFor(activeIndex)}"]`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flat[activeIndex];
      if (row) onPick(row.site.id);
    }
  };

  const renderRows = (rows: SwitchRow[], offset: number) =>
    rows.map((row, i) => (
      <Row key={`${offset}-${row.site.id}`} row={row} id={idFor(offset + i)} selected={row.site.id === currentId} active={offset + i === activeIndex} onPick={() => onPick(row.site.id)} onHover={() => setActiveIndex(offset + i)} />
    ));

  return (
    <div className="plx-sitepick">
      <div className="plx-sitepick__search">
        <Search size={18} aria-hidden />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={`${uid}-list`}
          aria-activedescendant={flat.length ? idFor(activeIndex) : undefined}
          aria-label="Search your sites"
          placeholder="Search your sites"
          value={query}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="plx-sitepick__scroll" ref={list}>
        <ul id={`${uid}-list`} role="listbox" aria-label="Your sites" className="plx-sitepick__list">
          {groups.recent.length ? (
            <>
              <li role="presentation" className="plx-sitepick__label">Recent</li>
              {renderRows(groups.recent, 0)}
            </>
          ) : null}
          {groups.all.length ? (
            <>
              <li role="presentation" className="plx-sitepick__label">{groups.searching ? "Matching sites" : groups.recent.length ? "All sites" : "Your sites"}</li>
              {renderRows(groups.all, groups.recent.length)}
            </>
          ) : (
            <li role="presentation" className="plx-sitepick__empty">No site matches &ldquo;{query.trim()}&rdquo;. Try a different word.</li>
          )}
        </ul>
      </div>
      <div className="plx-sitepick__foot">
        <button type="button" className="plx-btn plx-btn--secondary plx-btn--sm" onClick={onCreate}>
          <span className="plx-btn__label"><Plus size={16} aria-hidden />Create another website</span>
        </button>
        <Link href="/dashboard/sites" className="plx-btn plx-btn--ghost plx-btn--sm" onClick={onNavigate}>See all</Link>
      </div>
    </div>
  );
}
