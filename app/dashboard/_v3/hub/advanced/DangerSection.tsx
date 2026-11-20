"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "../../ui";
import { errMsg, hubApi } from "../hubApi";

/** Delete the site for good. */
export function DangerSection({ siteId, siteName, app }: { siteId: string; siteName: string; app?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!window.confirm(`Delete "${siteName}" for good? Its pages, and anything on it, will be gone. This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await hubApi(app ? `/api/v1/apps/${siteId}` : `/api/templates/${siteId}`, { method: "DELETE" }, "We couldn't delete this site. Please try again.");
      router.push("/dashboard/sites");
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  return (
    <Card padding="none" className="plx-hs__danger">
      <div className="plx-hs__row">
        <div className="plx-hs__lab">
          <b>Delete this site</b>
          <span>{app ? "Takes the app offline and removes its data, files and sign-ups. You can't get it back." : "Removes the site and all its pages. You can't get it back."}</span>
          {error ? <GateOrError error={error}><span className="plx-field__error" role="alert">{error}</span></GateOrError> : null}
        </div>
        <div className="plx-hs__ctl plx-hs__ctl--end"><Button variant="danger" loading={busy} onClick={remove}>Delete site</Button></div>
      </div>
    </Card>
  );
}
