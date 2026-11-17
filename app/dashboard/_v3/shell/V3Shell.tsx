"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CircleHelp,
  CirclePlay,
  CodeXml,
  Compass,
  Ellipsis,
  Globe,
  GraduationCap,
  House,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Mail,
  MessageCircle,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { activeNavId, type Experience, type NavIcon, type V3NavItem } from "@/lib/dashboardV3/nav";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { TourContext, TourState, TourStep } from "@/lib/dashboardV3/tour";
import type { OrgBranding } from "../../dashboard-shell";
import { switchLabel, useVersionSwitch } from "../../_versions/VersionUi";
import { PlexoLogo } from "../brand/PlexoLogo";
import { ThemeSwitch } from "../theme/ThemeContext";
import { TourProvider, persistTourState, useTour } from "../tour/TourProvider";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { MenuPanel, useMenu } from "./Menu";
import { SiteSwitcher } from "./SiteSwitcher";
import { FloatingPanel } from "../ui/FloatingPanel";
import { WorkspaceList, WorkspaceSwitcher, type Workspace } from "./WorkspaceSwitcher";

const ICONS: Record<NavIcon, React.ComponentType<{ size?: number; "aria-hidden"?: boolean; strokeWidth?: number }>> = {
  home: House,
  sites: LayoutGrid,
  orders: ShoppingBag,
  learners: GraduationCap,
  sol: MessageCircle,
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

/** Full-screen surfaces (the page editor, an app's editor) bring their own chrome. SOL does not: it lives inside the shell like any other place. */
function isChromeless(pathname: string): boolean {
  const editor = pathname.match(/^\/dashboard\/templates\/([^/]+)$/);
  if (editor && editor[1] !== "upload") return true;
  return /^\/dashboard\/apps\/[^/]+$/.test(pathname);
}

/**
 * The v3 dashboard frame: sidebar on desktop, a top bar with Ask SOL / appearance / help /
 * account, and a bottom tab bar on phones. Beginners get the one-site switcher; the menu is
 * whatever lib/dashboardV3/nav.ts decided for this person.
 */
export function V3Shell(props: V3ShellProps) {
  const tourContext: TourContext = { siteId: props.currentSiteId ?? props.sites[0]?.id ?? null, experience: props.experience };
  return (
    <TourProvider
      initialState={props.tourState}
      onPersist={props.persist === false ? undefined : persistTourState}
      steps={props.tourSteps}
      context={tourContext}
      offerOn={props.tourOfferOn}
      initialDriving={props.tourAutoDrive}
    >
      <ShellFrame {...props} />
    </TourProvider>
  );
}

function ShellFrame({ user, experience, nav, sites, currentSiteId, workspaces = [], currentWorkspaceId, onWorkspaceSwitch, orgBranding, persist = true, onExperienceChange, onSiteSelect, children }: V3ShellProps) {
  const pathname = usePathname() ?? "/dashboard";
  const active = activeNavId(nav, pathname);
  const beginner = experience === "beginner";
  const [moreOpen, setMoreOpen] = useState(false);

  if (isChromeless(pathname)) return <div className="plx-shell" data-chrome="none">{children}</div>;

  const brand = <Brand orgBranding={orgBranding} />;
  const switcher = beginner ? <SiteSwitcher sites={sites} currentSiteId={currentSiteId} onSelect={onSiteSelect} /> : null;

  // Phones: four main places + "More" when there are extras, otherwise up to five.
  const primary = nav.filter((n) => n.primary);
  const overflow = nav.filter((n) => !n.primary);
  const tabs = overflow.length ? primary.filter((n) => n.id !== "settings").slice(0, 4) : primary.slice(0, 5);
  const moreItems = nav.filter((n) => !tabs.includes(n));

  return (
    <div className="plx-shell">
      <aside className="plx-sidebar" aria-label="Main">
        <Link href="/dashboard" className="plx-sidebar__brand" aria-label={`${orgBranding?.name ?? "Plexo"} home`}>
          {brand}
        </Link>
        <WorkspaceSwitcher workspaces={workspaces} currentId={currentWorkspaceId} onSwitch={onWorkspaceSwitch} />
        {switcher}
        <nav className="plx-nav" aria-label="Main menu" data-tour="main-nav">
          {nav.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link key={item.id} href={item.href} className="plx-nav__link" aria-current={active === item.id ? "page" : undefined}>
                <Icon size={20} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <HelpCard />
      </aside>

      <div className="plx-main-col">
        <header className="plx-topbar">
          <div className="plx-mobilebar">
            <Link href="/dashboard" className="plx-topbar__logo-sm" aria-label="Home">
              {orgBranding?.logoUrl ? <OrgLogo branding={orgBranding} small /> : <PlexoLogo markOnly height={28} />}
            </Link>
            {switcher}
          </div>
          <AskSolBox />
          <div className="plx-topbar__right">
            <Link href="/dashboard/sol?new=1" className="plx-iconbtn plx-mobile-only" aria-label="Ask SOL" data-tour="ask-sol">
              <MessageCircle size={20} aria-hidden />
            </Link>
            <div className="plx-topbar__theme" data-tour="theme-switch">
              <ThemeSwitch compact />
            </div>
            <HelpMenu />
            <AccountMenu user={user} experience={experience} persist={persist} onExperienceChange={onExperienceChange} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} onWorkspaceSwitch={onWorkspaceSwitch} />
          </div>
        </header>
        <main id="main" className={pathname.startsWith("/dashboard/sol") || pathname.startsWith("/v3-preview/sol") ? "plx-content plx-content--bleed" : "plx-content"}>
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
            Take the tour again
          </button>
          <Link role="menuitem" className="plx-menu__item" href="/learn" onClick={() => menu.close(false)}>
            <CirclePlay size={18} aria-hidden />
            Watch how-to videos
          </Link>
          <Link role="menuitem" className="plx-menu__item" href="/dashboard/sol?new=1&draft=I%20need%20help%20with%20" onClick={() => menu.close(false)}>
            <MessageCircle size={18} aria-hidden />
            Ask SOL for help
          </Link>
          <a role="menuitem" className="plx-menu__item" href="mailto:support@plexopages.com">
            <LifeBuoy size={18} aria-hidden />
            Email our team
          </a>
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
  const router = useRouter();
  const target: Experience = experience === "pro" ? "beginner" : "pro";
  const versions = useVersionSwitch();

  const switchView = async () => {
    menu.close(false);
    if (onExperienceChange) return onExperienceChange(target);
    if (!persist) return;
    await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experience: target }) }).catch(() => {});
    router.refresh();
  };
  const signOut = async () => {
    menu.close(false);
    try {
      const { authClient } = await import("@/lib/auth-client");
      await authClient.signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    }
    router.push("/auth/login");
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
