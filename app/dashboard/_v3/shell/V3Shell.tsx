"use client";

import { trackEvent } from "@/lib/analytics";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  CircleHelp,
  CirclePlay,
  CodeXml,
  Compass,
  Ellipsis,
  Globe,
  GraduationCap,
  Heart,
  House,
  LayoutGrid,
  LayoutList,
  LifeBuoy,
  LogOut,
  Mail,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  MessageCircle,
  ShoppingBag,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { activeNavId, type Experience, type NavIcon, type V3NavItem } from "@/lib/dashboardV3/nav";
import { EDITOR_SIDEBAR_KEY, PAGES_SIDEBAR_KEY, foldedFromStorage, parseSidebarChoice, shellFrameFor, sidebarModeForPath, sidebarViewFor, type SidebarView } from "@/lib/dashboardV3/sidebarMode";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { TourContext, TourState, TourStep } from "@/lib/dashboardV3/tour";
import type { OrgBranding } from "../../dashboard-shell";
import { switchLabel, useVersionSwitch } from "../../_versions/VersionUi";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { SolSidebarProvider } from "../../sol/_components/SolSidebarContext";
import { SolStudioProvider } from "../sol/studio/SolStudioProvider";
import { SolChatsColumn } from "../sol/SolChatsColumn";
import { PlexoLogo } from "../brand/PlexoLogo";
import { ThemeSwitch } from "../theme/ThemeContext";
import { NotificationBell } from "../notifications/NotificationBell";
import { TourProvider, persistTourState, useTour } from "../tour/TourProvider";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { Modal } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";
import { MenuPanel, useMenu } from "./Menu";
import { NavProgress } from "./NavProgress";
import { useNavAction } from "./useNavAction";
import { startNavProgress } from "./NavProgress";
import { LinkPending } from "../ui/LinkPending";
import { SiteSwitcher } from "./SiteSwitcher";
import { FloatingPanel } from "../ui/FloatingPanel";
import { WorkspaceList, WorkspaceSwitcher, type Workspace } from "./WorkspaceSwitcher";

const SIDEBAR_KEY = "plx:solSidebar";

const ICONS: Record<NavIcon, React.ComponentType<{ size?: number; "aria-hidden"?: boolean; strokeWidth?: number }>> = {
  home: House,
  sites: LayoutGrid,
  orders: ShoppingBag,
  products: Package,
  learners: GraduationCap,
  sol: SolGlyph,
  emails: Mail,
  domains: Globe,
  developers: CodeXml,
  settings: Settings,
};

export type V3ShellProps = {
  user: { name: string; email: string; image?: string | null };
  experience: Experience;
  nav: V3NavItem[];
  sites: SiteSummary[];
  currentSiteId?: string | null;
  /** Every workspace this person belongs to, and the one they're in. Hidden when there's only one. */
  workspaces?: Workspace[];
  currentWorkspaceId?: string | null;
  /** Dev preview: called instead of switching for real. */
  onWorkspaceSwitch?: (id: string) => void;
  orgBranding?: OrgBranding;
  tourState: TourState;
  /** Tour steps (default: lib/dashboardV3/tourSteps.ts). The dev preview passes its own. */
  tourSteps?: TourStep[];
  /** Save theme/tour/experience changes to the account (off in the dev preview). */
  persist?: boolean;
  /** Called instead of saving + refreshing when the view changes (the dev preview). */
  onExperienceChange?: (e: Experience) => void;
  /** Called instead of the default (cookie + refresh) when a beginner switches site. */
  onSiteSelect?: (id: string) => void;
  /** Pages where first-timers are asked "Want a quick tour?" (default: Home). */
  tourOfferOn?: string[];
  /** Show an already-active tour straight away instead of offering to resume (the dev preview). */
  tourAutoDrive?: boolean;
  children: React.ReactNode;
};

/**
 * The v3 dashboard frame: sidebar on desktop, a top bar with Ask SOL / appearance / help /
 * account, and a bottom tab bar on phones. Beginners get the one-site switcher; the menu is
 * whatever lib/dashboardV3/nav.ts decided for this person.
 */
export function V3Shell(props: V3ShellProps) {
  const tourSite = props.sites.find((x) => x.id === props.currentSiteId) ?? props.sites[0] ?? null;
  const tourContext: TourContext = useMemo(() => ({ siteId: tourSite?.id ?? null, siteKind: tourSite?.kind ?? null, experience: props.experience }), [tourSite?.id, tourSite?.kind, props.experience]);
  return (
    <TourProvider
      initialState={props.tourState}
      onPersist={props.persist === false ? undefined : persistTourState}
      steps={props.tourSteps}
      context={tourContext}
      offerOn={props.tourOfferOn}
      initialDriving={props.tourAutoDrive}
    >
      <SolSidebarProvider>
        <SolStudioProvider>
          <ShellFrame {...props} />
        </SolStudioProvider>
      </SolSidebarProvider>
    </TourProvider>
  );
}

function ShellFrame({ user, experience, nav, sites, currentSiteId, workspaces = [], currentWorkspaceId, onWorkspaceSwitch, orgBranding, persist = true, onExperienceChange, onSiteSelect, children }: V3ShellProps) {
  const pathname = usePathname() ?? "/dashboard";
  const active = activeNavId(nav, pathname);
  const beginner = experience === "beginner";
  const [moreOpen, setMoreOpen] = useState(false);
  const tour = useTour();

  // The sidebar can fold to icons. It remembers the choice, and on a full-width editor it starts folded to leave room.
  const frame = shellFrameFor(pathname);
  const editorRoute = /^\/dashboard\/emails\/[^/]+$/.test(pathname) || frame === "editor";
  const foldKey = frame === "editor" ? EDITOR_SIDEBAR_KEY : PAGES_SIDEBAR_KEY;
  const [folded, setFolded] = useState<boolean | null>(frame === "editor" ? true : null);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(foldKey);
    } catch {
      /* private mode: just the default */
    }
    setFolded(foldedFromStorage(frame, stored));
  }, [foldKey, frame]);
  const toggleFold = () => {
    const next = !collapsed;
    setFolded(next);
    try {
      localStorage.setItem(foldKey, next ? "1" : "0");
    } catch {
      /* fine */
    }
  };

  // Inside SOL the left column is the conversations, with a Chats | Menu switch. The choice is
  // remembered while in SOL; arriving at SOL from elsewhere starts on Chats, and leaving restores the menu.
  const mode = sidebarModeForPath(pathname);
  // Inside SOL the left column is the conversations, so it never folds there.
  const collapsed = mode === "sol" ? false : (folded ?? editorRoute);
  const [choice, setChoice] = useState<SidebarView | null>(null);
  useEffect(() => {
    if (mode !== "sol") {
      setChoice(null);
      return;
    }
    try {
      setChoice(parseSidebarChoice(sessionStorage.getItem(SIDEBAR_KEY)));
    } catch {
      // private mode: starts on Chats
    }
  }, [mode]);
  const view = sidebarViewFor(mode, choice);
  const pickView = (next: SidebarView) => {
    setChoice(next);
    try {
      sessionStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      // fine
    }
  };

  if (frame === "none") return <div className="plx-shell" data-chrome="none"><NavProgress />{children}</div>;

  const brand = <Brand orgBranding={orgBranding} />;
  const switcher = beginner ? <SiteSwitcher sites={sites} currentSiteId={currentSiteId} onSelect={onSiteSelect} /> : null;

  // Phones: four main places + "More" when there are extras, otherwise up to five.
  const primary = nav.filter((n) => n.primary);
  const overflow = nav.filter((n) => !n.primary);
  const tabs = overflow.length ? primary.filter((n) => n.id !== "settings").slice(0, 4) : primary.slice(0, 5);
  const moreItems = nav.filter((n) => !tabs.includes(n));

  return (
    <div className="plx-shell" data-collapsed={collapsed ? "" : undefined} data-frame={frame === "editor" ? "editor" : undefined}>
      <NavProgress />
      <aside className="plx-sidebar" aria-label={view === "chats" ? "Your conversations" : "Main"} data-mode={mode} data-view={view}>
        <div className="plx-sidebar__top">
          <Link href="/dashboard" className="plx-sidebar__brand" aria-label={`${orgBranding?.name ?? "Plexo"} home`}>
            {collapsed ? (orgBranding?.logoUrl ? <OrgLogo branding={orgBranding} small /> : <PlexoLogo markOnly height={28} />) : brand}
          </Link>
          {mode === "sol" ? null : (
            <button type="button" className="plx-sidebar__fold" onClick={toggleFold} aria-label={collapsed ? "Expand the menu" : "Collapse the menu"} aria-pressed={collapsed} title={collapsed ? "Expand the menu" : "Collapse the menu"}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
          </button>
          )}
        </div>
        {mode === "sol" ? (
          <SegmentedControl<SidebarView>
            label="Show"
            className="plx-sbswitch"
            value={view}
            onChange={pickView}
            options={[
              { value: "chats", label: "Chats", icon: <SolGlyph size={17} /> },
              { value: "menu", label: "Menu", icon: <LayoutList size={17} aria-hidden /> },
            ]}
          />
        ) : null}
        {view === "chats" ? (
          <SolChatsColumn />
        ) : (
          <>
            {collapsed ? null : <WorkspaceSwitcher workspaces={workspaces} currentId={currentWorkspaceId} onSwitch={onWorkspaceSwitch} />}
            {collapsed ? null : switcher}
            <nav className="plx-nav" aria-label="Main menu" data-tour="main-nav">
              {nav.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <Link key={item.id} href={item.href} className="plx-nav__link" aria-current={active === item.id ? "page" : undefined} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}>
                    <Icon size={20} aria-hidden />
                    <span className="plx-nav__label">{item.label}</span>
                    <LinkPending />
                  </Link>
                );
              })}
            </nav>
            {collapsed ? (
              <div className="plx-sidebar__foot-collapsed">
                <Link
                  href="/dashboard/testimonial/submit"
                  className="plx-iconbtn"
                  title="Loving Plexo? Share a review"
                  aria-label="Loving Plexo? Share a review"
                >
                  <Heart size={20} aria-hidden />
                </Link>
              </div>
            ) : (
              <div className="plx-sidebar__foot">
                <TestimonialCard />
              </div>
            )}
          </>
        )}
      </aside>

      <div className="plx-main-col">
        {frame === "editor" ? null : <header className="plx-topbar">
          <div className="plx-mobilebar">
            <Link href="/dashboard" className="plx-topbar__logo-sm" aria-label="Home">
              {orgBranding?.logoUrl ? <OrgLogo branding={orgBranding} small /> : <PlexoLogo markOnly height={28} />}
            </Link>
            {switcher}
          </div>
          <AskSolBox />
          <div className="plx-topbar__right">
            <Link href="/dashboard/sol?new=1" className="plx-iconbtn plx-mobile-only" aria-label="Ask SOL" data-tour="ask-sol">
              <SolGlyph size={20} />
            </Link>
            <div className="plx-topbar__theme" data-tour="theme-switch">
              <ThemeSwitch compact />
            </div>
            <NotificationBell />
            <HelpMenu />
            <AccountMenu user={user} experience={experience} persist={persist} onExperienceChange={onExperienceChange} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} onWorkspaceSwitch={onWorkspaceSwitch} />
          </div>
        </header>}
        <main id="main" className={pathname.startsWith("/dashboard/sol") || pathname.startsWith("/v3-preview/sol") ? "plx-content plx-content--bleed" : editorRoute ? "plx-content plx-content--editor" : "plx-content"}>
          {children}
        </main>
      </div>

      <nav className="plx-tabbar" aria-label="Main menu" data-tour="main-nav">
        {tabs.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <Link key={item.id} href={item.href} className="plx-tabbar__item" aria-current={active === item.id ? "page" : undefined}>
              <span className="plx-tabbar__pip">
                <Icon size={21} aria-hidden />
              </span>
              {item.label}
              <LinkPending />
            </Link>
          );
        })}
        {moreItems.length ? (
          <button type="button" className="plx-tabbar__item" aria-current={moreItems.some((m) => m.id === active) ? "page" : undefined} onClick={() => setMoreOpen(true)}>
            <span className="plx-tabbar__pip">
              <Ellipsis size={21} aria-hidden />
            </span>
            More
          </button>
        ) : null}
      </nav>
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {moreItems.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link key={item.id} href={item.href} className="plx-nav__link" aria-current={active === item.id ? "page" : undefined} onClick={() => setMoreOpen(false)}>
                <Icon size={20} aria-hidden />
                {item.label}
              </Link>
            );
          })}
          <div className="plx-menu__sep" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 12px" }}>
            <span style={{ fontWeight: 700 }}>Appearance</span>
            <ThemeSwitch compact />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OrgLogo({ branding, small }: { branding: OrgBranding; small?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={branding.logoUrl} alt={branding.name} style={{ maxHeight: small ? 28 : 30, width: "auto", display: "block" }} />;
}

/** Plexo's logo, or a white-label organisation's own logo/name (their display preference). */
function Brand({ orgBranding }: { orgBranding?: OrgBranding }) {
  if (!orgBranding) return <PlexoLogo height={28} />;
  const showLogo = orgBranding.displayMode !== "NAME_ONLY" && !!orgBranding.logoUrl;
  const showName = orgBranding.displayMode !== "LOGO_ONLY" || !orgBranding.logoUrl;
  return (
    <>
      {showLogo ? <OrgLogo branding={orgBranding} /> : null}
      {showName ? <span>{orgBranding.name}</span> : null}
    </>
  );
}

function TestimonialCard() {
  return (
    <div className="plx-sidebar__shout">
      <div className="plx-sidebar__shout-head">
        <span className="plx-sidebar__shout-icon">
          <Heart size={12} aria-hidden style={{ fill: "currentColor" }} />
        </span>
        <strong className="plx-sidebar__shout-title">Loving Plexo?</strong>
      </div>
      <p className="plx-sidebar__shout-desc">
        Drop a quick review &amp; get your site featured on our showcase.
      </p>
      <Link href="/dashboard/testimonial/submit" className="plx-btn plx-btn--secondary plx-btn--sm plx-sidebar__shout-btn">
        <span className="plx-btn__label">
          Share your review
          <ArrowUpRight size={13} aria-hidden style={{ opacity: 0.75 }} />
        </span>
      </Link>
    </div>
  );
}

function HelpCard() {
  const tour = useTour();
  return (
    <div className="plx-sidebar__help">
      <strong>Stuck? We&apos;ll help.</strong>
      <p>Every step has a short video. Or ask SOL in your own words.</p>
      <button type="button" className="plx-btn plx-btn--secondary plx-btn--sm" onClick={tour.openOffer}>
        <span className="plx-btn__label">
          <Compass size={16} aria-hidden />
          Take the tour
        </span>
      </button>
    </div>
  );
}

function AskSolBox() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="plx-topsearch plx-topbar__search"
      data-tour="ask-sol"
      onSubmit={(e) => {
        e.preventDefault();
        const text = value.trim();
        router.push(text ? `/dashboard/sol?new=1&draft=${encodeURIComponent(text)}` : "/dashboard/sol?new=1");
      }}
      onClick={() => input.current?.focus()}
    >
      <Search size={18} aria-hidden />
      <label htmlFor="plx-ask" className="plx-sr-only">
        Ask SOL or search
      </label>
      <input id="plx-ask" ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ask SOL or search…" autoComplete="off" />
      <kbd aria-hidden>⌘K</kbd>
    </form>
  );
}

function HelpMenu() {
  const menu = useMenu();
  const tour = useTour();
  return (
    <div {...menu.wrapProps} data-tour="help-menu">
      <button type="button" className="plx-iconbtn" aria-label="Help" {...menu.buttonProps}>
        <CircleHelp size={21} aria-hidden />
      </button>
      {menu.open ? (
        <MenuPanel {...menu.menuProps} aria-label="Help">
          <button
            type="button"
            role="menuitem"
            className="plx-menu__item"
            onClick={() => {
              menu.close(false);
              tour.openOffer();
            }}
          >
            <Compass size={18} aria-hidden />
            Tour: replay any part
          </button>
          <Link role="menuitem" className="plx-menu__item" href="/learn" onClick={() => menu.close(false)}>
            <CirclePlay size={18} aria-hidden />
            Watch how-to videos
          </Link>
          <Link role="menuitem" className="plx-menu__item" href="/dashboard/sol?new=1&draft=I%20need%20help%20with%20" onClick={() => menu.close(false)}>
            <SolGlyph size={18} />
            Ask SOL for help
          </Link>
          <a role="menuitem" className="plx-menu__item" href="mailto:support@plexopages.com">
            <LifeBuoy size={18} aria-hidden />
            Email our team
          </a>
          <a role="menuitem" className="plx-menu__item" href="http://wa.me/2349014415631" target="_blank" rel="noopener noreferrer" onClick={() => menu.close(false)}>
            <MessageCircle size={18} aria-hidden />
            Chat on WhatsApp
          </a>
          <div className="plx-menu__sep" />
          <Link role="menuitem" className="plx-menu__item" href="/dashboard/testimonial/submit" onClick={() => menu.close(false)}>
            <Heart size={18} aria-hidden />
            Drop a testimonial
          </Link>
        </MenuPanel>
      ) : null}
    </div>
  );
}

function AccountMenu({ user, experience, persist, onExperienceChange, workspaces = [], currentWorkspaceId, onWorkspaceSwitch }: { user: V3ShellProps["user"]; experience: Experience; persist: boolean; onExperienceChange?: (e: Experience) => void; workspaces?: Workspace[]; currentWorkspaceId?: string | null; onWorkspaceSwitch?: (id: string) => void }) {
  const menu = useMenu();
  const [wsOpen, setWsOpen] = useState(false);
  const accountBtn = useRef<HTMLElement | null>(null);
  const currentWs = workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0];
  const nav = useNavAction();
  const toast = useToast();
  const target: Experience = experience === "pro" ? "beginner" : "pro";
  const versions = useVersionSwitch();

  const switchView = async () => {
    menu.close(false);
    if (onExperienceChange) return onExperienceChange(target);
    if (!persist) return;
    toast.show({ title: target === "pro" ? "Switching to the pro view…" : "Switching to the guided view…", tone: "info" });
    await nav.refreshAfter(async () => {
      const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experience: target }) }).catch(() => null);
      if (!res?.ok) {
        toast.show({ title: "We couldn't switch just now", description: "Check your internet connection and try again.", tone: "danger" });
        return false;
      }
    });
  };
  const signOut = async () => {
    menu.close(false);
    toast.show({ title: "Signing you out…", tone: "info" });
    startNavProgress();
    try {
      const { authClient } = await import("@/lib/auth-client");
      await authClient.signOut();
      trackEvent({ event: "user_logout", user_id: null, plan_name: null, plan_status: null });
    } catch (e) {
      console.error("Sign out error:", e);
    }
    nav.push("/auth/login");
  };

  return (
    <div {...menu.wrapProps} ref={(el) => { menu.wrapProps.ref.current = el; accountBtn.current = el; }}>
      <button type="button" className="plx-account-btn" aria-label={`Account: ${user.name}`} {...menu.buttonProps}>
        <Avatar name={user.name || user.email} src={user.image} size={38} />
      </button>
      {menu.open ? (
        <MenuPanel {...menu.menuProps} aria-label="Account">
          <div className="plx-menu__head">
            <Avatar name={user.name || user.email} src={user.image} size={40} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</span>
              <span className="plx-small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user.email}
              </span>
            </div>
          </div>
          {workspaces.length > 1 && currentWs ? (
            <button type="button" role="menuitem" className="plx-menu__item plx-mobile-flex" onClick={() => { menu.close(false); setWsOpen(true); }}>
              <ArrowLeftRight size={18} aria-hidden />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span>Switch workspace</span>
                <span className="plx-small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentWs.name}</span>
              </span>
            </button>
          ) : null}
          <div className="plx-menu__sep" />
          <button type="button" role="menuitem" className="plx-menu__item" onClick={switchView}>
            <SlidersHorizontal size={18} aria-hidden />
            {target === "pro" ? "Switch to pro view" : "Switch to guided view"}
          </button>
          <Link role="menuitem" className="plx-menu__item" href="/dashboard/settings" onClick={() => menu.close(false)}>
            <UserRound size={18} aria-hidden />
            Settings
          </Link>
          {versions.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className="plx-menu__item"
              onClick={() => {
                menu.close(false);
                versions.request(t.id);
              }}
            >
              <ArrowLeftRight size={18} aria-hidden />
              {switchLabel(t)}
            </button>
          ))}
          <div className="plx-menu__sep" />
          <a role="menuitem" className="plx-menu__item" href="https://plexopages.com" target="_blank" rel="noopener" onClick={() => menu.close(false)}>
            <Globe size={18} aria-hidden />
            Plexo website
          </a>
          <button type="button" role="menuitem" className="plx-menu__item" onClick={signOut}>
            <LogOut size={18} aria-hidden />
            Sign out
          </button>
        </MenuPanel>
      ) : null}
      <FloatingPanel open={wsOpen} onClose={() => setWsOpen(false)} anchorRef={accountBtn} width={340} label="Switch workspace">
        <WorkspaceList workspaces={workspaces} currentId={currentWs?.id} onClose={() => setWsOpen(false)} onSwitch={onWorkspaceSwitch} />
      </FloatingPanel>
    </div>
  );
}
