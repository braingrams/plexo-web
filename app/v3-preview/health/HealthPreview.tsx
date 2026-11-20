"use client";

import { useMemo, useRef } from "react";
import { HealthTab } from "@/app/dashboard/_v3/hub/HealthTab";
import { MockApi, type MockHandler } from "../MockApi";

type Payload = { issues: { id: string; autoFix?: { id: string; on: boolean } }[]; settings: Record<string, unknown> } & Record<string, unknown>;

const PREVIEW_TEXT: Record<string, { notes: string[]; text?: string; aeo?: { from: number; to: number } }> = {
  meta_description: { notes: ["Adds a short summary under your page's name in Google, written from what is on your page.", "Your own pages are not changed. Undo any time."], text: "Mama Tee Bakery in Lagos: fresh bread, cakes and pastries baked every morning. Order online for pickup or delivery.", aeo: { from: 54, to: 65 } },
  prioritize: { notes: ["Your top picture starts loading first, so the main part of your page shows up sooner.", "Your own pages are not changed. Undo any time."] },
};

/** DEV ONLY: the real Site health tab, fed with fixture results (?scenario=slow|fast). */
export function HealthPreview({ payload }: { payload: Payload }) {
  const state = useRef<Payload>(JSON.parse(JSON.stringify(payload)));
  const handler = useMemo<MockHandler>(
    () => ({ method, path, body }) => {
      const cur = state.current;
      if (path === "/health") return cur;
      if (path === "/health/digest") return { emailDigest: body.enabled };
      if (path === "/health/fix") {
        if (body.all === true) {
          if (body.preview === true) return { fixes: cur.issues.filter((i) => i.autoFix && !i.autoFix.on).map((i) => ({ fix: i.autoFix!.id, notes: ["Switched on."] })), aeo: { from: 54, to: 72 } };
          for (const i of cur.issues) if (i.autoFix) i.autoFix.on = body.enabled !== false;
          return { ...cur, summary: body.enabled === false ? undefined : { done: cur.issues.filter((i) => i.autoFix).map((i) => ({ fix: i.autoFix!.id, label: (i as unknown as { title: string }).title, notes: ["Switched on."] })), skipped: [], aeo: { from: 54, to: 72 } } };
        }
        const issue = cur.issues.find((i) => i.autoFix?.id === body.fix);
        if (body.preview === true) return { fix: body.fix, ...(PREVIEW_TEXT[String(body.fix)] ?? PREVIEW_TEXT.prioritize) };
        if (issue?.autoFix) issue.autoFix.on = body.enabled !== false;
        return JSON.parse(JSON.stringify(cur));
      }
      void method;
      return undefined;
    },
    [],
  );
  return (
    <MockApi handler={handler}>
      <HealthTab siteId="preview" live editHref="/v3-preview/health" />
    </MockApi>
  );
}
