"use client";

import { useMemo, useRef } from "react";
import { VisitsTab } from "@/app/dashboard/_v3/hub/VisitsTab";
import type { HubVisits } from "@/lib/dashboardV3/hubData";
import { DEFAULT_CONSENT, type ConsentSettings } from "@/lib/consent/model";
import { MockApi, type MockHandler } from "../MockApi";

/** DEV ONLY: the real Visits tab (?state=on|off), with Plexo-managed visitor numbers and the cookie notice settings. */
export function VisitsPreview({ visits, report, insights, state }: { visits: HubVisits; report: unknown; insights: unknown; state: "on" | "off" }) {
  const connected = useRef(state === "on");
  const consent = useRef<ConsentSettings>({ ...DEFAULT_CONSENT, accentColor: "#0f766e" });
  const handler = useMemo<MockHandler>(
    () => ({ method, path, body }) => {
      if (path === "/google-analytics") {
        if (method === "POST") {
          if (body.action === "use_plexo") connected.current = true;
          if (body.action === "disconnect") connected.current = false;
          return { ok: true };
        }
        return connected.current ? { state: "ready", mode: "managed", mock: false, options: { managed: true, own: true }, report, insights } : { state: "not_connected", options: { managed: true, own: true } };
      }
      if (path === "/cookie-notice") {
        if (method === "PUT") consent.current = { ...consent.current, ...(body as Partial<ConsentSettings>) };
        return { settings: consent.current };
      }
      return undefined;
    },
    [report, insights],
  );
  return (
    <MockApi handler={handler}>
      <VisitsTab visits={visits} siteId="preview" live />
    </MockApi>
  );
}
