import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { designFormatOf } from "@/lib/v2/design";
import { compileGenerated } from "@/lib/v2/siteFormat";
import { isHomePageOnlyPlan } from "@/lib/subscription";
import { handleCommerceTool } from "@/lib/mcp/commerceTools";
import { PageToolError, currentDesign, editableUrlFor, loadOwnedRow, publishPage, saveEdit } from "@/lib/mcp/v2Pages";
import { markerRow } from "./storefrontLayout";
import { hasProductMarker, insertBeforeFooter, productJsx, productMarker, productSection, type ProductSnippetOptions } from "./embedSnippets";
import { buyHref, classicPaymentLinks, findPaymentLinksInHtml, paymentLinkNodes, pickLinksToConvert, rewriteClassicPaymentLinks, rewritePaymentLinksInHtml, sectionLinkPatch } from "./paymentLinks";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/**
 * "Sell this product": makes a page sell one product, end to end, so every purchase lands in
 * Commerce as an order. One call does whatever is still missing:
 *
 *  - no product yet → creates it from a name and price (a course, ebook or download);
 *  - Commerce off, or no way to take payment → turns it on with Plexo's own Paystack, which
 *    needs no keys (an owner who already set up their own keeps them);
 *  - the page already has a hosted pay link (Flutterwave, Paystack, Selar, a Stripe payment
 *    link…) → points that link at the on-page checkout instead of adding a second way to buy;
 *  - otherwise → adds a buy card.
 *
 * It works on whatever the page is made of: a visual page, a classic page, a hand-written HTML
 * page — and for a React app (whose pages are code) it returns what to place and what to change.
 */
export type SellProductResult = {
  ok: true;
  /** What the page is made of: "visual", "classic", "html" (a hand-written page) or "app" (a React app). */
  kind: "visual" | "classic" | "html" | "app";
  productId: string;
  productName: string;
  /** The product was created by this call. */
  createdProduct: boolean;
  pageId: string;
  pageName: string;
  /** Nothing needed changing — the page already sold this product. */
  alreadyThere: boolean;
  /** How many of the page's old payment links now open the checkout. */
  convertedLinks: number;
  /** A buy card was added (not needed when the page's own buttons were converted). */
  addedCard: boolean;
  /** The change is live (visual pages wait in a working copy until published). */
  live: boolean;
  publishedUrl: string | null;
  editableUrl: string;
  /** The link that opens this product's checkout from any button: `<a href="…">`. */
  buyLink: string;
  /** The markup of the buy card — for an app, what to place. */
  snippet: string;
  /** Payment links found but left alone because the page has several different ones. */
  unclearLinks: string[];
  /** Plain-English heads-ups for the owner (never blocking). */
  warnings: string[];
  /** One sentence for the owner (or the AI relaying it): what happened and what to do next. */
  message: string;
};

export type SellProductArgs = {
  siteId: string;
  /** An existing product. Leave out to create one from name + price. */
  productId?: string;
  /** Create the product: its name… */
  name?: string;
  /** …price in whole currency units (5000 = ₦5,000)… */
  price?: number;
  /** …or in the smallest unit. */
  priceMinor?: number;
  description?: string;
  imageUrl?: string;
  /** Where buyers get a digital product after paying: a link (the course, a folder)… */
  deliveryUrl?: string;
  /** …or instructions to send them… */
  deliveryInstructions?: string;
  /** …or a file already uploaded to Plexo. */
  fileUrl?: string;
  /** The page to put it on. Default: the site's home page. */
  pageId?: string;
  /** Visual pages: also publish. Default true when that can't push out unrelated unfinished edits. */
  publish?: boolean;
  /** Visual pages: the heading above the buy card. Default: the product's name. */
  heading?: string;
  /** Visual pages: a line of text under the heading. Default: none. */
  text?: string;
  /** Text on the button. Default "Buy now". */
  buttonLabel?: string;
  /** Point the page's existing payment links at this product. Default true. */
  convertLinks?: boolean;
  /** When the page has several different payment links: part of the URL of the one that is this product's. */
  paymentLink?: string;
  /** Add a buy card too. Default: only when there was no payment link to convert. */
  addCard?: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function sellProductOnPage(resolved: ResolvedUser, args: SellProductArgs): Promise<SellProductResult> {
  const siteId = str(args.siteId);
  if (!siteId) throw new PageToolError("Which site? Pass siteId — the id of the site's home page (list_landing_pages shows it).");

  const { data: site } = await Template.get({ id: siteId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new PageToolError(`I can't find a site with id "${siteId}" in this account. siteId is the home page's id — list_landing_pages shows it.`);
  }
  const row = args.pageId && str(args.pageId) !== siteId ? await loadOwnedRow(resolved, args.pageId) : await loadOwnedRow(resolved, siteId);
  const rootId = row.parentId ? await rootOf(row) : row.id;
  if (rootId !== siteId) throw new PageToolError(`That page belongs to a different site than the product does — a product can only be sold on its own site's pages.`);

  const warnings: string[] = [];
  const { product, created } = await resolveProduct(resolved, siteId, args, warnings);
  warnings.push(...(await prepareCommerce(resolved, siteId, row, product)));

  const opts: ProductSnippetOptions = { buttonLabel: str(args.buttonLabel) || undefined };
  const base: Base = {
    ok: true,
    productId: product.id,
    productName: product.name as string,
    createdProduct: created,
    pageId: row.id,
    pageName: row.name as string,
    editableUrl: editableUrlFor(row.id),
    buyLink: buyHref(product.id),
    warnings,
  };
  const ctx: Ctx = { resolved, row, siteId, product, args, opts, wantsLinks: args.convertLinks !== false, base };

  if (row.sourceType === "REACT_PROJECT") return sellInApp(ctx);
  if (row.sourceType === "RAW_UPLOAD") return sellOnHtmlPage(ctx);
  if (designFormatOf(row) === "v2") return sellOnVisualPage(ctx);
  return sellOnClassicPage(ctx);
}

type Base = Pick<SellProductResult, "ok" | "productId" | "productName" | "createdProduct" | "pageId" | "pageName" | "editableUrl" | "buyLink" | "warnings">;
type Ctx = { resolved: ResolvedUser; row: Row; siteId: string; product: Row; args: SellProductArgs; opts: ProductSnippetOptions; wantsLinks: boolean; base: Base };

/** The product to sell: the one named, or a new one made from name + price. */
async function resolveProduct(resolved: ResolvedUser, siteId: string, args: SellProductArgs, warnings: string[]): Promise<{ product: Row; created: boolean }> {
  const productId = str(args.productId);
  if (productId) {
    const { data: product } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
    if (!product || product.active === false) throw new PageToolError(`I can't find that product on this site. list_commerce_products shows the products you can sell here.`);
    if (product.kind === "SERVICE") throw new PageToolError(`"${product.name}" is a service, which people book at a time that suits them rather than buy. Add a booking block to the page for it instead.`);
    return { product, created: false };
  }

  const name = str(args.name);
  const priceMinor = args.priceMinor ?? (typeof args.price === "number" ? Math.round(args.price * 100) : NaN);
  if (!name || !Number.isInteger(priceMinor) || priceMinor <= 0) {
    throw new PageToolError('Which product? Pass productId (list_commerce_products), or — to create it now — its name and price (for example name: "AI Video Course", price: 5000).');
  }

  const delivery = str(args.fileUrl)
    ? { digitalDeliveryMethod: "FILE_DOWNLOAD", digitalFileUrl: str(args.fileUrl) }
    : str(args.deliveryUrl)
      ? { digitalDeliveryMethod: "EXTERNAL_LINK", digitalExternalUrl: str(args.deliveryUrl) }
      : {
          digitalDeliveryMethod: "ACCESS_LIST",
          digitalAccessInstructions: str(args.deliveryInstructions) || "Thank you for your purchase! The seller will send you your access details by email shortly.",
        };
  if (!str(args.fileUrl) && !str(args.deliveryUrl) && !str(args.deliveryInstructions)) {
    warnings.push(`Buyers are told you'll email their access yourself. To deliver "${name}" automatically after payment, add its link or file to the product (Commerce → Products).`);
  }
  const made = await handleCommerceTool(
    "create_commerce_product",
    { templateId: siteId, name, kind: "DIGITAL", priceMinor, description: str(args.description) || undefined, imageUrl: str(args.imageUrl) || undefined, ...delivery },
    resolved,
  );
  return { product: made.product, created: true };
}

/**
 * Makes sure a sale can actually happen: Commerce on, and a way to be paid. A site that has
 * never set up payments gets Plexo's own Paystack (no keys, proceeds go to the Commerce
 * wallet); one that already has its own keys is left exactly as it is.
 */
async function prepareCommerce(resolved: ResolvedUser, siteId: string, row: Row, product: Row): Promise<string[]> {
  const warnings: string[] = [];
  const { data: settings } = await CommerceSettings.get({ templateId: siteId }).go();
  const provider = settings?.paymentProvider ?? "BYO_PAYSTACK";
  const hasOwnKeys =
    provider === "BYO_PAYSTACK"
      ? Boolean(settings?.paystackLiveSecretKeyEncrypted || settings?.paystackTestSecretKeyEncrypted)
      : provider === "BYO_STRIPE"
        ? Boolean(settings?.stripeLiveSecretKeyEncrypted || settings?.stripeTestSecretKeyEncrypted)
        : true; // a platform provider needs no keys of the owner's
  const needsPayments = !hasOwnKeys && !settings?.bankTransferEnabled;

  if (!settings?.enabled || needsPayments) {
    await handleCommerceTool("update_commerce_settings", { templateId: siteId, enabled: true, ...(needsPayments ? { paymentProvider: "PLATFORM_PAYSTACK" } : {}) }, resolved);
    warnings.push(
      needsPayments
        ? "I switched on Commerce and set payments up with Plexo's Paystack, so you didn't need any keys — what buyers pay goes to your Commerce wallet, which you can withdraw. You can use your own Paystack or Stripe account instead in Commerce → Settings."
        : "I switched Commerce on for this site.",
    );
  }

  const homeOnly = isHomePageOnlyPlan(resolved.subscriptionPlan);
  if (homeOnly && row.parentId) warnings.push("Your plan publishes the home page only, so visitors won't be able to open this page. Put the product on your home page, or upgrade to publish more pages.");
  if (homeOnly && (product.kind === "PHYSICAL" || (Array.isArray(product.variants) && product.variants.length > 0))) {
    warnings.push("A physical product needs delivery details, which need a checkout page — and your plan publishes only the home page, so buyers couldn't finish. Digital products (a course, a download) work fully on your plan.");
  }
  return warnings;
}

/** What to say about the old payment links, shared by every kind of page. */
function linkNotes(converted: number, unclear: string[], warnings: string[]): void {
  if (converted > 0) warnings.push("Buyers now pay through Commerce (Paystack or Stripe) instead of the old payment link, and every purchase shows up in your Orders. Payments made through the old link before now stay with that provider.");
  if (unclear.length > 0) warnings.push(`This page has ${unclear.length} different payment links (${unclear.slice(0, 3).join(", ")}${unclear.length > 3 ? ", …" : ""}), so I left them alone. Tell me which one is for this product and I'll switch it.`);
}

/** "Created "X" and switched the payment buttons on "Home" to the new checkout" — what this call did, in a sentence. */
function summary(ctx: Ctx, r: { converted: number; addedCard: boolean }): string {
  const name = `"${ctx.product.name}"`;
  const where = `"${ctx.row.name}"`;
  const steps: string[] = [];
  if (ctx.base.createdProduct) steps.push(`created ${name}`);
  if (r.converted > 0) steps.push(`switched ${r.converted === 1 ? "the payment button" : `the ${r.converted} payment buttons`} on ${where} to the new checkout`);
  if (r.addedCard) steps.push(`added a buy card for ${name} to ${where}`);
  if (!steps.length) return `${name} is already set up on ${where}`;
  const text = steps.join(", ").replace(/, ([^,]*)$/, " and $1");
  return text[0].toUpperCase() + text.slice(1);
}

// ------------------------------------------------------------------ the four kinds of page

async function sellInApp(ctx: Ctx): Promise<SellProductResult> {
  const snippet = productJsx(ctx.product.id, ctx.opts);
  return {
    ...ctx.base,
    kind: "app",
    alreadyThere: false,
    convertedLinks: 0,
    addedCard: false,
    live: false,
    publishedUrl: await liveUrl(ctx.siteId),
    snippet,
    unclearLinks: [],
    message:
      `${ctx.base.createdProduct ? `Created "${ctx.product.name}". ` : ""}An app's pages are code, so place this where the product should be sold: ${snippet}  ` +
      `If the app already has a "Buy" button that goes to a payment link, change that link to href="${ctx.base.buyLink}" instead (or add data-plexo-buy="${ctx.product.id}" to any button) — it opens a checkout on the same page and records the order. Then publish the app.`,
  };
}

async function sellOnHtmlPage(ctx: Ctx): Promise<SellProductResult> {
  const { row, product, opts } = ctx;
  let html: string = row.compiledHtml ?? "";
  const pick = pickLinksToConvert(ctx.wantsLinks ? findPaymentLinksInHtml(html) : [], ctx.args.paymentLink);
  let converted = 0;
  if (pick.urls.length) {
    const out = rewritePaymentLinksInHtml(html, product.id, pick.urls);
    html = out.html;
    converted = out.count;
  }
  const alreadySells = hasProductMarker(html, product.id) || html.includes(ctx.base.buyLink);
  const addCard = !alreadySells && (ctx.args.addCard ?? converted === 0);
  if (addCard) html = insertBeforeFooter(html, productSection(product.id, opts));
  if (converted > 0 || addCard) await Template.patch({ id: row.id }).set({ compiledHtml: html }).go();

  linkNotes(converted, pick.unclear, ctx.base.warnings);
  const changed = converted > 0 || addCard;
  return {
    ...ctx.base,
    kind: "html",
    alreadyThere: !changed,
    convertedLinks: converted,
    addedCard: addCard,
    live: true,
    publishedUrl: await liveUrl(ctx.siteId),
    snippet: productMarker(product.id, opts),
    unclearLinks: pick.unclear,
    message: `${summary(ctx, { converted, addedCard: addCard })}.${changed ? " It's live now — buyers pay on the page and every purchase is recorded as an order." : ""}`,
  };
}

async function sellOnVisualPage(ctx: Ctx): Promise<SellProductResult> {
  const { resolved, row, product, args, opts } = ctx;
  const design = await currentDesign(row);
  const snippet = productMarker(product.id, opts);
  const links = ctx.wantsLinks ? design.pages.flatMap((p) => paymentLinkNodes(p.rootNode as never)) : [];
  const pick = pickLinksToConvert(links.map((l) => l.url), args.paymentLink);
  const toConvert = links.filter((l) => pick.urls.includes(l.url));
  const json = JSON.stringify(design);
  const cardPresent = json.includes(product.id) && /productOffer|data-plexo|"mode":"buy"|plexo-buy-/.test(json);
  const addCard = !cardPresent && (args.addCard ?? toConvert.length === 0);

  // Hand-built elements change by id; a ready-made section's buttons change through the section's own fields.
  const commands: Record<string, unknown>[] = [];
  const linksPerCommand: number[] = [];
  const bySection = new Map<string, { path: string; content: Record<string, unknown> }[]>();
  for (const l of toConvert) {
    if ("nodeId" in l) {
      commands.push({ op: "updateElement", nodeId: l.nodeId, href: buyHref(product.id) });
      linksPerCommand.push(1);
    } else bySection.set(l.sectionId, [...(bySection.get(l.sectionId) ?? []), { path: l.path, content: l.content }]);
  }
  for (const [sectionId, sectionLinks] of bySection) {
    commands.push({ op: "updateSection", sectionId, content: sectionLinkPatch(sectionLinks, buyHref(product.id)) });
    linksPerCommand.push(sectionLinks.length);
  }
  if (addCard) commands.push({ op: "addSection", kind: "productOffer", variant: "centered", content: { heading: str(args.heading) || product.name, text: str(args.text), productId: product.id } });

  linkNotes(toConvert.length, pick.unclear, ctx.base.warnings);
  const rootId = row.parentId ? await rootOf(row) : row.id;
  if (commands.length === 0) {
    return { ...ctx.base, kind: "visual", alreadyThere: true, convertedLinks: 0, addedCard: false, live: !row.draftJson, publishedUrl: await liveUrl(rootId), snippet, unclearLinks: pick.unclear, message: `${summary(ctx, { converted: 0, addedCard: false })}.` };
  }

  const hadDraft = Boolean(row.draftJson);
  const saved = await saveEdit(row, commands, { live: false });
  if (!saved.ok || !saved.saved) {
    const why = (saved.results ?? []).filter((r: { ok: boolean }) => !r.ok).map((r: { message: string }) => r.message).join(" ") || "the page couldn't take it";
    throw new PageToolError(`I couldn't update "${row.name}": ${why}`);
  }
  const converted = linksPerCommand.reduce((sum, n, i) => sum + ((saved.results ?? [])[i]?.ok ? n : 0), 0);

  // Publishing a working copy also publishes whatever else is waiting in it — so only do it
  // on the owner's behalf when this is the one change waiting.
  const wantsPublish = args.publish !== false;
  let live = false;
  let publishedUrl = await liveUrl(rootId);
  if (wantsPublish && !hadDraft && publishedUrl) {
    const published = await publishPage(resolved, { templateId: row.id });
    live = true;
    publishedUrl = published.publishedUrl ?? publishedUrl;
  }
  const done = summary(ctx, { converted, addedCard: addCard });
  const message = live
    ? `${done} and published it — buyers can pay right on the page, and every purchase is recorded as an order.`
    : hadDraft && wantsPublish
      ? `${done} in the working copy. That page has other unpublished changes, so I left it unpublished — review it in the editor and publish when you're happy.`
      : `${done} in the working copy. Publish the page to put it live.`;
  return { ...ctx.base, kind: "visual", alreadyThere: false, convertedLinks: converted, addedCard: addCard, live, publishedUrl, snippet, unclearLinks: pick.unclear, message };
}

async function sellOnClassicPage(ctx: Ctx): Promise<SellProductResult> {
  const { row, siteId, product, args, opts } = ctx;
  const snippet = productMarker(product.id, opts);
  const hasDraft = Boolean(row.draftJson);
  let design: Row = (hasDraft ? row.draftJson : row.designJson) ?? { body: { style: {}, rows: [] } };
  const pick = pickLinksToConvert(ctx.wantsLinks ? classicPaymentLinks(design) : [], args.paymentLink);
  let converted = 0;
  if (pick.urls.length) {
    const out = rewriteClassicPaymentLinks(design, product.id, pick.urls);
    design = out.design;
    converted = out.count;
  }
  const json = JSON.stringify(design);
  const addCard = !(json.includes(product.id) && /"mode":"buy"|plexo-buy-/.test(json)) && (args.addCard ?? converted === 0);
  if (addCard) {
    design = { ...design, body: { ...design.body, rows: [...(design.body?.rows ?? []), markerRow("product", { productId: product.id, mode: "buy", ...(opts.buttonLabel ? { buttonLabel: opts.buttonLabel } : {}) }, "420px")] } };
  }

  linkNotes(converted, pick.unclear, ctx.base.warnings);
  if (converted === 0 && !addCard) {
    return { ...ctx.base, kind: "classic", alreadyThere: true, convertedLinks: 0, addedCard: false, live: !hasDraft, publishedUrl: await liveUrl(siteId), snippet, unclearLinks: pick.unclear, message: `${summary(ctx, { converted: 0, addedCard: false })}.` };
  }
  const compiledHtml = await compileGenerated(siteId, { id: row.id, name: row.name, designFormat: "v1", designJson: design });
  if (hasDraft) await Template.patch({ id: row.id }).set({ draftJson: design, draftHtml: compiledHtml }).go();
  else await Template.patch({ id: row.id }).set({ designJson: design, compiledHtml }).go();
  const done = summary(ctx, { converted, addedCard: addCard });
  return {
    ...ctx.base,
    kind: "classic",
    alreadyThere: false,
    convertedLinks: converted,
    addedCard: addCard,
    live: !hasDraft,
    publishedUrl: await liveUrl(siteId),
    snippet,
    unclearLinks: pick.unclear,
    message: hasDraft ? `${done} in the working copy. Publish the page to put it live.` : `${done} and it's live${addCard ? " — drag its block in the editor wherever you'd like it" : ""}.`,
  };
}

// ------------------------------------------------------------------ helpers

async function rootOf(row: Row): Promise<string> {
  let cur: Row = row;
  for (let i = 0; i < 20 && cur.parentId; i++) {
    const { data } = await Template.get({ id: cur.parentId }).go();
    if (!data) break;
    cur = data;
  }
  return cur.id;
}

async function liveUrl(rootId: string): Promise<string | null> {
  const { data: domains } = await PublishedDomain.query.primary({ templateId: rootId }).go({ pages: "all" });
  const live = domains.find((d: Row) => !d.planDisabledAt) ?? domains[0];
  if (!live) return null;
  return `${process.env.NODE_ENV === "development" ? "http" : "https"}://${live.domain}`;
}
