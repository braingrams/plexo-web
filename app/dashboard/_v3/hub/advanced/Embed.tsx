"use client";

import { EditorFrame } from "../../../_components/EditorTheme";
import { EmbeddedScreen } from "../../../_components/PageContainer";
import { LegacyBridge } from "../../LegacyBridge";

/**
 * Shows a screen that was written for the old dashboard inside the Advanced area, in the new colours (light and dark)
 * and without its own page padding or back link. The screen keeps working exactly as it did; it just lives here now.
 */
export function Embed({ children }: { children: React.ReactNode }) {
  return (
    <EditorFrame v3>
      <LegacyBridge>
        <EmbeddedScreen>
          <div className="plx-adv__embed">{children}</div>
        </EmbeddedScreen>
      </LegacyBridge>
    </EditorFrame>
  );
}

/** A fixed-height stage for the app panes, which were built to fill the space they are given. */
export function Stage({ children, tall, scroll = true }: { children: React.ReactNode; tall?: boolean; scroll?: boolean }) {
  return (
    <EditorFrame v3>
      <LegacyBridge>
        <div className={`plx-adv__stage${tall ? " plx-adv__stage--tall" : ""}`}>
          <div className={scroll ? "plx-adv__stage-in plx-adv__stage-in--scroll" : "plx-adv__stage-in"}>{children}</div>
        </div>
      </LegacyBridge>
    </EditorFrame>
  );
}
