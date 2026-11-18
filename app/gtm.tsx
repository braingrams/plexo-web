import { headers } from "next/headers";
import { GTM_CONTAINER_ID } from "@/lib/analytics";
import { TENANT_HEADER } from "@/lib/tenantHeader";

// Google Tag Manager. GA4 and every other tag are configured inside the GTM container, not in code.
// Production builds only, so `next dev` traffic isn't counted.
const enabled = Boolean(GTM_CONTAINER_ID) && process.env.NODE_ENV === "production";

/** True for a customer's published site (rewritten to /pub by the middleware). Plexo's tags stay off those pages. */
async function isCustomerSite(): Promise<boolean> {
  return (await headers()).get(TENANT_HEADER) === "1";
}

/** Render first inside <head>. */
export async function GtmHeadScript() {
  if (!enabled || (await isCustomerSite())) return null;
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
export async function GtmNoScript() {
  if (!enabled || (await isCustomerSite())) return null;
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

/** Microsoft Clarity, for the app. Off customer sites, like GTM. */
export async function ClarityScript() {
  if (await isCustomerSite()) return null;
  return (
    <script
      type="text/javascript"
      dangerouslySetInnerHTML={{
        __html: `(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "zawu6g4f6x");`,
      }}
    />
  );
}
