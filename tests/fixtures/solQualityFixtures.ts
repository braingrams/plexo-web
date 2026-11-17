// Compiled-page fixtures for the quality gate tests: the kit's own untouched starter page (bland) and a hand-built page in the
// same compiled shape (classes, CSS variables, one h1, real copy, wired form) that a finished SOL build should look like.
import { buildSitePage, compilePageToHtml, designSystemFromBrief } from "@charisol/plexo-sdk/v2/compile";

/** The page kit's starter page with nothing filled in: what SOL produced on a bare prompt. */
export function blandDocument(): string {
  const brief = { name: "Crumb & Co", about: "Small-batch bakery in Accra", industry: "bakery", tone: "warm", colors: ["#C2410C"] };
  const { designSystem } = designSystemFromBrief(brief as never);
  const built = buildSitePage({ pageType: "landing" }, { brief, designSystem, chrome: true } as never);
  return compilePageToHtml(built.page, { designSystem, title: "Crumb", runtime: "none" }).document;
}

const css = `:where(:root){--color-text-primary:#2B1A10;--color-text-secondary:#5A4636;--color-bg-surface:#FFF8F1;--color-brand:#C2410C;--color-on-brand:#FFFFFF;--font-body:'Inter',sans-serif;--font-head:'Fraunces',serif}
.plx-page{font-family:var(--font-body);color:var(--color-text-primary);background:var(--color-bg-surface)}
.plx-btn{display:inline-block;text-align:center;padding:14px 24px;font-size:16px;border-radius:10px}
.s{padding-top:80px;padding-bottom:80px}
.hdr{background:var(--color-bg-surface);padding:16px 24px}
.hero{background:#FFEEDB}
.cta-primary{background:var(--color-brand);color:var(--color-on-brand)}
.cta-quiet{background:#FFFFFF;color:#2B1A10}
.soft{background:#FFFFFF}
.dark{background:#3B2314;color:#FFF8F1}
.muted{color:var(--color-text-secondary)}
h1,h2,h3{font-family:var(--font-head)}
.h1{font-size:48px;font-weight:700}
.h2{font-size:32px;font-weight:700}
.muted-dark{color:#F1DFCF}
.ft{background:#2B1A10;color:#FFF8F1;padding:40px 24px}
.ft a{color:#FFF8F1}`;

/** A finished page: specific copy, one h1, proof, offer, FAQ, wired form, final call to action, honest links. */
export function pristineDocument(overrides: { title?: string; description?: string; hero?: string } = {}): string {
  const title = overrides.title ?? "Sourdough and celebration cakes in Accra | Crumb &amp; Co";
  const description = overrides.description ?? "Small-batch sourdough, custom celebration cakes and weekend pastry boxes, baked in Accra and delivered to your door. Order for this weekend.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&amp;family=Inter:wght@400;600&amp;display=swap">
<style>${css}</style>
<meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="https://cdn.example/crumb-og.jpg"></head>
<body style="margin:0"><div class="plx-page">
<section id="header-menu" class="hdr"><a href="/" class="muted">Crumb &amp; Co</a><a class="plx-btn cta-primary" href="#order">Order a cake</a></section>
<section id="hero" class="s hero"><p class="muted">Small-batch bakery, Accra</p><h1 class="h1">${overrides.hero ?? "Fresh from our oven to your Saturday"}</h1><p>Sourdough loaves, custom celebration cakes and weekend pastry boxes, delivered across Accra before 10am.</p><a class="plx-btn cta-primary" href="#order">Order a cake for this weekend</a><a class="plx-btn cta-quiet" href="#menu">See what's baking</a><img src="https://cdn.example/crumb-hero.jpg" alt="A tray of warm sourdough loaves on a wooden counter"></section>
<section id="proof" class="s soft"><h2 class="h2">Loved by 400 families in Accra</h2><p>Rated 4.9 from 212 reviews. Every cake is baked the morning it is delivered.</p></section>
<section id="how" class="s"><h2 class="h2">Order in three easy steps</h2><div><h3>Pick your bake</h3><p>Choose a loaf, a cake or a pastry box from the menu below.</p></div><div><h3>Tell us the day</h3><p>Order two days ahead for cakes, by 6pm the evening before for loaves.</p></div><div><h3>We deliver it fresh</h3><p>Our rider brings it to your door between 8 and 10am.</p></div></section>
<section id="menu" class="s soft"><h2 class="h2">What we bake</h2><div><h3>Sourdough loaf, GHS 45</h3><p>Slow-fermented for 24 hours, with a crisp crust and a soft, tangy crumb.</p></div><div><h3>Celebration cake, from GHS 320</h3><p>Made to your flavour, size and message, with a free tasting slice.</p></div><div><h3>Weekend pastry box, GHS 120</h3><p>Six pastries to share: croissants, cinnamon rolls and a seasonal tart.</p></div></section>
<section id="reviews" class="s"><h2 class="h2">What our customers say</h2><p>"The birthday cake was the star of the party, and every guest asked where it came from." Efua Mensah, Osu</p></section>
<section id="faq" class="s soft"><h2 class="h2">Questions, answered</h2><div><h3>How early should I order a cake?</h3><p>Two days ahead is perfect. Need it sooner? Message us and we will try.</p></div><div><h3>Which areas do you deliver to?</h3><p>All of Accra, from Osu to East Legon. Delivery is free over GHS 150.</p></div></section>
<section id="order" class="s dark"><h2 class="h2">Order your cake for this weekend</h2><p class="muted-dark">Tell us the day and the flavour. We reply within the hour.</p><form action="/api/public/forms/site1/submit?form=Order" method="post"><label>Your name<input name="name"></label><label>Phone<input name="phone"></label><button type="submit" class="plx-btn cta-primary">Send my order</button></form><a class="plx-btn cta-quiet" href="mailto:hello@crumbandco.com">Email us instead</a></section>
<section id="footer" class="ft"><p>Crumb &amp; Co, 14 Oxford Street, Osu, Accra</p><a href="tel:+233241234567">+233 24 123 4567</a><a href="mailto:hello@crumbandco.com">hello@crumbandco.com</a><a href="https://instagram.com/crumbandco">Instagram</a></section>
</div></body></html>`;
}
