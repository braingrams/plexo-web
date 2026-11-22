import { NextRequest } from "next/server";
import { DEFAULT_CONSENT, normalizeConsentInput } from "@/lib/consent/model";
import { analyticsSnippet } from "@/lib/consent/snippet";

/**
 * DEV ONLY: a sample published page with the real cookie notice, as a visitor in Europe sees it. It is plain HTML on purpose:
 * the notice is a script Plexo adds to published pages (lib/consent/snippet.ts), so this is the real thing, not a drawing.
 * Options: ?position=bar|card &accent=%230f766e &message=...
 */
export function GET(request: NextRequest): Response {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const q = request.nextUrl.searchParams;
  const parsed = normalizeConsentInput({ position: q.get("position") ?? undefined, accentColor: q.get("accent") ?? undefined, ...(q.get("message") ? { message: q.get("message") } : {}) }, DEFAULT_CONSENT);
  const settings = parsed.ok ? parsed.settings : DEFAULT_CONSENT;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mama Tee Bakery</title>
<style>body{margin:0;font:17px/1.6 Georgia,serif;color:#2b1d14;background:#fff8f0}header{display:flex;justify-content:space-between;align-items:center;padding:20px 6vw;border-bottom:1px solid #ead9c6}header b{font-size:22px}nav a{margin-left:22px;color:#7a4a28;text-decoration:none;font:600 15px system-ui}.hero{padding:72px 6vw;display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}.hero h1{font-size:52px;line-height:1.1;margin:0 0 16px}.hero p{font-size:19px;max-width:520px}.btn{display:inline-block;margin-top:12px;padding:14px 26px;background:#c2410c;color:#fff;border-radius:12px;font:700 16px system-ui;text-decoration:none}.pic{aspect-ratio:4/3;border-radius:24px;background:linear-gradient(135deg,#f5c78e,#e08a4a 55%,#b45a25);box-shadow:0 20px 50px rgba(120,60,20,.25)}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:0 6vw 120px}.row div{padding:22px;border-radius:16px;background:#fff;border:1px solid #ead9c6}@media(max-width:700px){.hero{grid-template-columns:1fr;padding:40px 6vw}.hero h1{font-size:36px}.row{grid-template-columns:1fr}}</style>
${analyticsSnippet({ measurementId: "G-PREVIEW0000", required: true, settings })}</head>
<body><header><b>Mama Tee Bakery</b><nav><a href="#">Shop</a><a href="#">About</a><a href="#">Contact</a></nav></header>
<section class="hero"><div><h1>Fresh bread, baked every morning.</h1><p>Order online for pickup or delivery anywhere in Lagos. Cakes, pastries and the loaf your family will ask for again.</p><a class="btn" href="#">See what's baking</a></div><div class="pic" role="img" aria-label="A basket of fresh bread"></div></section>
<section class="row"><div><b>Pickup</b><br>Ready in an hour</div><div><b>Delivery</b><br>Across Lagos</div><div><b>Custom cakes</b><br>Order 2 days ahead</div></section></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
