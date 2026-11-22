/**
 * Server half of "turn this page into code": renders the page's blocks to the HTML visitors get today, using the real
 * build, and refuses (saving nothing) if the result isn't the same page. See convertToCode.ts for the pure pieces.
 */
import type { EntityItem } from "electrodb";

import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { applyPageChrome, compileTemplateWithSiteLayout, findRootTemplateId, getEnabledSiteLayoutRows, layoutSectionsOf } from "@/lib/siteLayoutCore";
import { bakeBrandLink } from "@/lib/brand/inject";
import { designFormatOf } from "@/lib/v2/design";
import { finishConvertedHtml, samePageWithAdditions } from "./convertToCode";

type TemplateItem = EntityItem<typeof Template>;

export class ConvertError extends Error {}

export type ConvertSource = "working" | "live";

export type RenderedConversion = {
  html: string;
  /** The version the code was made from: the unpublished working copy, or what is live. */
  usedWorkingCopy: boolean;
  hasUnpublishedChanges: boolean;
  isLive: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  hasOwnScript: boolean;
};

const customJsOf = (designJson: unknown): string => {
  const js = (designJson as { body?: { style?: { customJs?: unknown } } } | null)?.body?.style?.customJs;
  return typeof js === "string" ? js : "";
};

async function pageIsLive(page: TemplateItem, rootId: string): Promise<boolean> {
  if (page.isPublished === false) return false;
  const { data: domains } = await PublishedDomain.query.primary({ templateId: rootId }).go({ pages: "all" });
  return domains.length > 0;
}

/**
 * `source`: "working" is the page as the owner last saw it in the editor (their unpublished changes included);
 * "live" is what visitors see now. They are the same when nothing is waiting to be published.
 */
export async function renderBlockPageAsHtml(page: TemplateItem, source: ConvertSource): Promise<RenderedConversion> {
  const hasDraft = page.draftJson != null;
  const useWorking = source === "working" && hasDraft;
  const designJson = useWorking ? page.draftJson : page.designJson;
  const rootId = await findRootTemplateId(page.id, page.parentId ?? null);

  // What visitors get today is the stored build (it already has the header, footer and the page's own switches in it).
  // A working copy that was never published has to be built the same way the Publish button builds it.
  let before: string;
  if (!useWorking && page.compiledHtml) before = page.compiledHtml;
  else {
    try {
      before = await compileTemplateWithSiteLayout(
        { id: page.id, parentId: page.parentId ?? null, kind: page.kind, name: page.name, designFormat: page.designFormat, hideHeader: page.hideHeader, hideFooter: page.hideFooter },
        designJson,
      );
    } catch (err) {
      throw new ConvertError(err instanceof Error && err.message ? err.message : "This page couldn't be built, so it can't be turned into code yet.");
    }
  }
  if (!before.trim()) throw new ConvertError("This page has nothing on it yet, so there is nothing to turn into code. Add something to it first.");

  const classic = designFormatOf(page) !== "v2";
  const finished = finishConvertedHtml(before, { customJs: classic ? customJsOf(designJson) : null, classic });
  let html = finished.html;
  const added = [...finished.added];
  if (!classic) {
    const baked = await bakeBrandLink(html, rootId);
    html = baked.html;
    if (baked.link) added.push(baked.link);
  }
  if (!samePageWithAdditions(before, html, added)) {
    throw new ConvertError("We couldn't be sure this page would look exactly the same as code, so we left it as it is. Nothing was changed.");
  }

  const layout = applyPageChrome(await getEnabledSiteLayoutRows(rootId), page);
  const sections = layoutSectionsOf(layout);
  return {
    html,
    usedWorkingCopy: useWorking,
    hasUnpublishedChanges: hasDraft,
    isLive: await pageIsLive(page, rootId),
    hasHeader: (sections?.headerSections.length ?? 0) > 0,
    hasFooter: (sections?.footerSections.length ?? 0) > 0,
    hasOwnScript: classic && customJsOf(designJson).trim().length > 0,
  };
}
