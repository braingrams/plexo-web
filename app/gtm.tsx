import { GTM_CONTAINER_ID } from "@/lib/analytics";

// Google Tag Manager. GA4 and every other tag are configured inside the GTM container, not in code.
// Production builds only, so `next dev` traffic isn't counted.
const enabled = Boolean(GTM_CONTAINER_ID) && process.env.NODE_ENV === "production";

/** Render first inside <head>. */
export function GtmHeadScript() {
  if (!enabled) return null;
  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtm.js?id=${GTM_CONTAINER_ID}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());`,
        }}
      />
    </>
  );
}

/** Render immediately after the opening <body> tag. */
export function GtmNoScript() {
  if (!enabled) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  );
}
