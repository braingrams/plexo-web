"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Modal, useToast } from "../ui";
import { deleteSiteCopy } from "@/lib/dashboardV3/deleteSite";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { useNavAction } from "../shell/useNavAction";
import { errMsg, hubApi } from "./hubApi";

export type DeletableSite = { id: string; name: string; status?: string | null; address?: string | null; kind?: string | null };

/**
 * The one "Delete this site" confirmation (My sites cards, the all-sites dashboard, Site settings). Names the site, says plainly what
 * happens, asks for a tick on a live site, and shows the server's own words if it can't be deleted.
 */
export function DeleteSiteDialog({ site, onClose, afterDelete = "/dashboard/sites", demo }: { site: DeletableSite | null; onClose: () => void; afterDelete?: string; demo?: boolean }) {
  const nav = useNavAction();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTicked(false);
    setError(null);
  }, [site?.id]);

  const copy = site ? deleteSiteCopy({ name: site.name, live: site.status === "live", address: site.address, kind: site.kind }) : null;

  async function remove() {
    if (!site) return;
    setBusy(true);
    setError(null);
    try {
      if (!demo) await hubApi(`/api/templates/${site.id}`, { method: "DELETE" }, "We couldn't delete this site. Please try again.");
      // If it was the site they were working on, let the dashboard pick another one.
      if (typeof document !== "undefined" && document.cookie.includes(`${CURRENT_SITE_COOKIE}=${site.id}`)) document.cookie = `${CURRENT_SITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      show({ title: `"${site.name}" was deleted`, tone: "success" });
      onClose();
      nav.pushFresh(afterDelete);
    } catch (e) {
      setError(errMsg(e, "We couldn't delete this site. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!site}
      onClose={() => (busy ? undefined : onClose())}
      title={copy?.title ?? "Delete site"}
      description="Please read this before you go on."
      footer={
        copy ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>{copy.keepLabel}</Button>
            <Button variant="danger" leftIcon={<Trash2 size={16} aria-hidden />} loading={busy || nav.pending} disabled={copy.needsTick && !ticked} onClick={() => void remove()}>{copy.confirmLabel}</Button>
          </>
        ) : null
      }
    >
      {copy ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: "disc", display: "flex", flexDirection: "column", gap: 6 }} className="plx-body">
            {copy.goes.map((g) => <li key={g}>{g}</li>)}
          </ul>
          <p className="plx-small" style={{ margin: 0 }}>{copy.stays.join(" ")}</p>
          {copy.needsTick ? (
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 600 }}>
              <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} style={{ marginTop: 4 }} />
              <span>{copy.tickLabel}</span>
            </label>
          ) : null}
          {error ? <GateOrError error={error}><p className="plx-field__error" role="alert" style={{ margin: 0 }}>{error}</p></GateOrError> : null}
        </div>
      ) : <span />}
    </Modal>
  );
}
