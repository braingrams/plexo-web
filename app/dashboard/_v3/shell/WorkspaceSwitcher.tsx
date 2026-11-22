"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useNavAction } from "./useNavAction";
import { Check, ChevronsUpDown, Settings } from "lucide-react";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { FloatingPanel } from "../ui/FloatingPanel";
import { useToast } from "../ui/Toast";

export type Workspace = { id: string; name: string; role: string };

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

/** Switching reuses the same call the old dashboard and /choose-org make, then reloads everything for that workspace. */
function useSwitchWorkspace(currentId: string | null | undefined, onSwitch?: (id: string) => void) {
  const nav = useNavAction();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, done: () => void) => {
    if (id === currentId) return done();
    if (onSwitch) {
      onSwitch(id);
      return done();
    }
    setBusy(id);
    try {
      const { authClient } = await import("@/lib/auth-client");
      const res = (await authClient.organization.setActive({ organizationId: id })) as { error?: { message?: string } };
      if (res?.error) throw new Error(res.error.message);
      // The site they were last on belongs to the other workspace; let the new one choose its own.
      document.cookie = `${CURRENT_SITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      done();
      nav.pushFresh("/dashboard");
    } catch {
      toast.show({ tone: "danger", title: "We couldn't switch workspace", description: "Check your internet connection and try again." });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** The list inside the panel: workspaces (name, role, a tick on the current one) and where to manage them. */
export function WorkspaceList({ workspaces, currentId, onClose, onSwitch }: { workspaces: Workspace[]; currentId?: string | null; onClose: () => void; onSwitch?: (id: string) => void }) {
  const { busy, run } = useSwitchWorkspace(currentId, onSwitch);
  return (
    <>
      <div className="plx-wslist" role="radiogroup" aria-label="Your workspaces">
        {workspaces.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={w.id === currentId} disabled={busy !== null} className="plx-wslist__row" onClick={() => run(w.id, onClose)}>
            <Avatar name={w.name} size={36} square />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span className="plx-wslist__name" title={w.name}>{w.name}</span>
              <span><Badge tone={w.role === "owner" ? "brand" : "neutral"}>{busy === w.id ? "Opening…" : roleLabel(w.role)}</Badge></span>
            </span>
            {w.id === currentId ? <Check size={18} aria-hidden style={{ color: "var(--plx-deep)", flexShrink: 0 }} /> : null}
          </button>
        ))}
      </div>
      <div className="plx-wslist__foot">
        <Link href="/dashboard/settings/team" className="plx-wslist__row" style={{ minHeight: 48 }} onClick={onClose}>
          <Settings size={18} aria-hidden style={{ color: "var(--plx-muted)" }} />
          <span className="plx-wslist__name">Workspace settings</span>
        </Link>
      </div>
    </>
  );
}

/** Which workspace you're in (top of the sidebar), with a panel to switch. Separate from the site switcher on purpose. */
export function WorkspaceSwitcher({ workspaces, currentId, onSwitch }: { workspaces: Workspace[]; currentId?: string | null; onSwitch?: (id: string) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];
  if (!current || workspaces.length < 2) return null;
  return (
    <div className="plx-wsswitch" data-tour="workspace-switcher">
      <button ref={button} type="button" className="plx-wsswitch__btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`Workspace: ${current.name}. Switch workspace`} onClick={() => setOpen((o) => !o)}>
        <Avatar name={current.name} size={32} />
        <span className="plx-wsswitch__text">
          <span className="plx-wsswitch__name" title={current.name}>{current.name}</span>
          <span className="plx-wsswitch__role">{roleLabel(current.role)} · Workspace</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden style={{ color: "var(--plx-muted)", flexShrink: 0 }} />
      </button>
      <FloatingPanel open={open} onClose={() => setOpen(false)} anchorRef={button} width={340} label="Switch workspace">
        <WorkspaceList workspaces={workspaces} currentId={current.id} onClose={() => setOpen(false)} onSwitch={onSwitch} />
      </FloatingPanel>
    </div>
  );
}
