import { injectGoogleAnalyticsTag } from "@/lib/pub/htmlInject";
import { consentRequiredFor, visitorCountry } from "@/lib/consent/regions";
import { tagForSite } from "./connection";

/**
 * The last step of serving a page: add Google's tag (and the cookie notice for visitors who need it) when the owner has
 * analytics on. Runs after the owner's own header/footer code is in the page so the same tag is never added twice.
 * Never throws: a failure here must not take a page down.
 */
export async function applyAnalyticsTag(html: string, templateId: string, headers: Pick<Headers, "get">): Promise<string> {
  try {
    const tag = await tagForSite(templateId);
    if (!tag) return html;
    return injectGoogleAnalyticsTag(html, tag.measurementId, { required: consentRequiredFor(visitorCountry(headers)), settings: tag.consent });
  } catch {
    return html;
  }
}
