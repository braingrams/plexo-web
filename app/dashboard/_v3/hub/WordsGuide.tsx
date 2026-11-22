"use client";

import "./hub.css";
import Link from "next/link";
import { ArrowRight, Check, Pencil, SkipForward } from "lucide-react";
import { Button, ButtonLink, Card, ProgressBar } from "../ui";
import { doneCopy, editHrefWithBack, stepCopy, WORDS_HOME_HREF, wordsFlowHref, type WordsTopic } from "@/lib/dashboardV3/wordsFlow";
import { useNavAction } from "../shell/useNavAction";

export type GuidePage = { id: string; name: string; isRoot: boolean; sourceType: string; editHref: string };

/**
 * "Change the words", one page at a time. Each page is shown first, the way visitors see it, with a plain note that
 * anything on it can be changed live in the editor. Then Edit, Next or Skip, until a clear "Done, back to home".
 * The step lives in the address, so coming back from the editor lands on the same page.
 */
export function WordsGuide({ siteId, siteName, pages, topic, step }: { siteId: string; siteName: string; pages: GuidePage[]; topic: WordsTopic; step: number }) {
  const nav = useNavAction();
  const total = pages.length;
  const here = `/dashboard/sites/${siteId}/words?for=${topic}&step=${step}`;

  if (total === 0 || step > total) {
    const done = doneCopy(topic, true);
    return (
      <div className="plx-page plx-hub" data-tour="words-done">
        <Card tone="tint" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
          <span className="plx-eyebrow">{siteName}</span>
          <h1 className="plx-h1">{total === 0 ? "There are no pages to look through yet" : done.title}</h1>
          <p className="plx-body" style={{ margin: 0 }}>{total === 0 ? "Add a page first, then come back here." : done.body}</p>
          <ButtonLink href={WORDS_HOME_HREF} size="lg" variant="strong" leftIcon={<Check size={18} aria-hidden />}>Done, back to home</ButtonLink>
        </Card>
      </div>
    );
  }

  const page = pages[step - 1];
  const copy = stepCopy(page, step, total, topic);
  const go = (n: number) => nav.push(wordsFlowHref(siteId, topic, n));
  const src = `/api/v1/templates/${siteId}/draft-preview${page.isRoot ? "" : `?page=${page.id}`}`;

  return (
    <div className="plx-page plx-hub" data-tour="words-guide">
      <div>
        <p className="plx-eyebrow">Page {step} of {total}</p>
        <h1 className="plx-h1">{copy.title}</h1>
        <ProgressBar value={step - 1} max={total} label={`Page ${step} of ${total}`} showLabel={false} />
      </div>
      <p className="plx-body" style={{ margin: 0, maxWidth: "70ch" }}>{copy.lead}</p>
      <div className="plx-words__frame">
        <div className="plx-words__bar" aria-hidden><i /><i /><i /></div>
        {/* key: a fresh frame for each page so the old page never lingers */}
        <iframe key={page.id} className="plx-words__shot" src={src} title={`Preview of the ${copy.title}`} loading="eager" referrerPolicy="no-referrer" />
      </div>
      <div className="plx-hub__actions" style={{ alignItems: "center" }}>
        <ButtonLink href={editHrefWithBack(page.editHref, here)} size="lg" variant="strong" leftIcon={<Pencil size={18} aria-hidden />} data-tour="words-edit">{copy.editLabel}</ButtonLink>
        <Button size="lg" loading={nav.pending} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => go(step + 1)} data-tour="words-next">{copy.nextLabel}</Button>
        <Button size="lg" variant="ghost" disabled={nav.pending} leftIcon={<SkipForward size={18} aria-hidden />} onClick={() => go(step + 1)} data-tour="words-skip">{copy.skipLabel}</Button>
      </div>
      <Link href={WORDS_HOME_HREF} className="plx-hub__back">Stop here and go back to home</Link>
    </div>
  );
}
