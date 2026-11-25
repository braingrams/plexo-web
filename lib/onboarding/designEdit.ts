/**
 * Personalizing a new-editor (V2) marketplace design by editing THE DESIGN, not its HTML.
 *
 * What a "personalized design" is: the marketplace listing's design JSON plus a small, replayable recipe (`DesignEdits`: the owner's name,
 * description, colour and logo, SOL's words by number, which optional sections to drop). `editDesign` is a pure function of those two,
 * so:
 *  - the browser never sends design JSON (a design can be up to 5 MB) and the server never has to trust it: the source is always the
 *    listing's own design, loaded server-side by id;
 *  - nothing has to be stored between the preview and "Create my website": the same recipe, replayed on the same listing, gives the
 *    same design, so the preview is exactly what the editor will hold and what publishes (no short-lived draft rows to expire or clean up);
 *  - the preview HTML is compiled FROM that design with the compiler the editor and publisher use, so HTML is never the source.
 * The edited design is checked with parseV2Design before it is used; if SOL's part cannot be applied safely the design falls back, step by
 * step, to the owner's name/colour/logo only, then to the design as the maker made it, and the owner is told in plain words.
 */
import { createHash } from "node:crypto";
import { applyCommands, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { Template } from "@/lib/db/contentEntities";
import { lookTokens } from "@/lib/dashboardV3/brandLook";
import { withHeaderLogo } from "@/lib/sites/headerLogo";
import { designFormatOf, parseV2Design } from "@/lib/v2/design";
import { resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { compileV2Design } from "@/lib/v2/compile";
import { descriptionCopy, sampleNamesOnPage, swapNameInText } from "./brandPreview";
import { DOMAIN_STOCK_PHOTOS, detectPersonalizationDomain } from "./personalize";
import { applySlotCopy, copyBySlot, listSlots, removableSections, removeSections, type Slot, type SlotDoc } from "./designSlots";

export type DesignEdits = {
  /** The site's name: replaces the design's sample business name wherever the design writes it. */
  name: string;
  /** What the owner said about their business: becomes the intro line when it reads like a real sentence, and the search description. */
  about?: string;
  /** The marketplace design's own name and description (used to know its sample business name, and what kind of business it was made for). */
  designName?: string;
  designDescription?: string;
  /** The brand colours (#rrggbb, main first) and logo address. The same "setBrand" change the Brand page makes is applied to the design. */
  colors?: string[];
  logoUrl?: string;
  /** SOL's new words keyed by the number it was shown for each (see slotNodes). */
  copy?: Record<string, string>;
  /** Which version of the design's words SOL read (slotsKeyOf): when the listing has changed since, SOL's numbered words no longer line up and are not used. */
  slotsKey?: string;
  /** Ids of optional sections SOL chose to remove (only ones removableSections offers are removed). */
  remove?: string[];
  /** The kind of business SOL read (decides whether stock photos are swapped, as before). */
  domain?: string;
  /** The owner gave SOL their phone, email or address while it asked its questions. */
  contact?: boolean;
};

export type EditedDesign = {
  /** The listing's design JSON with the edits applied (everything else, such as the brand kept in storage, exactly as the listing has it). */
  design: Record<string, unknown>;
  /** Plain-words notes for the owner about anything that could not be applied. */
  warnings: string[];
  /** How many of SOL's pieces of text went into the design, and which sections were removed. */
  solApplied: number;
  removed: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const encodeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const HEX = /^#[0-9a-f]{6}$/i;

const HEADLINE_KEY = /^(headline|heading|title)$/i;
const INTRO_KEY = /^(sub|subtitle|subheadline|subhead|description|body|text|intro|lead|copy|paragraph)$/i;

/** The slot that holds the design's intro line: the first real sentence of copy after the page's main headline. */
function introSlot(slots: Slot[]): Slot | null {
  const page = slots.filter((s) => s.role === "page" && !/header|footer|nav/i.test(s.blockKind ?? "") && s.text);
  const at = page.findIndex((s) => HEADLINE_KEY.test(s.key) && s.part === undefined);
  if (at < 0) return null;
  const headline = page[at];
  return page.slice(at + 1, at + 7).find((s) => s.holder === headline.holder && s.part === undefined && INTRO_KEY.test(s.key) && s.text.length >= 40 && s.text.split(" ").length >= 7) ?? null;
}

const IMAGE_KEY = /(image|img|photo|picture|poster|background)$/i;
const NOT_PHOTO_KEY = /logo|icon|avatar|favicon|og/i;

/** Swaps the design's photos for the owner's kind of business, only when the design was made for another (the rule the HTML path always had). */
function swapPhotos(doc: unknown, photos: string[]): void {
  let i = 0;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isRecord(v)) return;
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "string" && IMAGE_KEY.test(k) && !NOT_PHOTO_KEY.test(k) && /^https?:\/\//i.test(val)) v[k] = photos[i++ % photos.length];
      else if (k !== "designSystem" && k !== "meta") visit(val);
    }
  };
  visit((doc as { pages?: unknown }).pages);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The brand's colours (and logo) put into the design with the Brand page's own mechanism ("setBrand" and the header's logo). */
function applyLook(design: Record<string, unknown>, edits: DesignEdits, warnings: string[]): Record<string, unknown> {
  let out = design;
  const colors = (edits.colors ?? []).filter((c) => HEX.test(c)).slice(0, 6);
  if (colors.length) {
    const applied = applyCommands(out.pages as never, (out.designSystem as never) ?? createDefaultDesignSystem(), [{ op: "setBrand", tokens: lookTokens(colors) }]);
    if (applied.results?.[0]?.ok === false) warnings.push("Your colours are saved on the Brand page, but this design can't be recoloured automatically. Ask SOL to restyle it with them.");
    else out = { ...out, pages: applied.pages, designSystem: applied.designSystem };
  }
  if (edits.logoUrl && /^https?:\/\//i.test(edits.logoUrl)) {
    const placed = withHeaderLogo(out, edits.logoUrl);
    if (placed.placed) out = placed.design;
    else warnings.push("Your logo is saved, but this design has no place for it in the header yet. SOL can add it for you.");
  }
  return out;
}

type Stage = "all" | "no-remove" | "brand-only" | "none";

/**
 * Pure apart from the SDK's setBrand. `look: true` also puts the colours and logo into the returned design (the preview); the new website
 * leaves that to applyOwnerLook, which applies them from the site's Brand tab (the one place they live) and also handles a big brand kept in storage.
 */
export async function editDesign(listing: unknown, edits: DesignEdits, opts: { look: boolean }): Promise<EditedDesign> {
  const original = isRecord(listing) ? listing : {};
  const warnings: string[] = [];
  let stale = false;
  const tryStage = async (stage: Stage): Promise<EditedDesign | null> => {
    if (stage === "none") {
      // Even the owner's name could not go in: the design as its maker made it, with the owner's colours and logo.
      const sole = opts.look ? applyLook(clone(original), edits, warnings) : original;
      return parseV2Design(sole).ok ? { design: sole, warnings: [], solApplied: 0, removed: [] } : null;
    }
    const base = clone(original);
    const docs: SlotDoc[] = [{ role: "page", design: base }];
    const slots = listSlots(docs);
    const replacements: Record<string, string> = {};

    // 1. The owner's name where the design writes its sample business name, and their description as the intro line.
    const name = edits.name.trim().slice(0, 60);
    const pseudo = slots.filter((s) => s.text).map((s) => `<p>${encodeText(s.text)}</p>`).join("");
    const samples = name ? sampleNamesOnPage(pseudo, edits.designName).filter((s) => !name.toLowerCase().includes(s.toLowerCase())) : [];
    const swap = (text: string) => samples.reduce((t, sample) => swapNameInText(t, sample, name), text);
    for (const s of slots) {
      if (!s.text) continue;
      const next = swap(s.text);
      if (next !== s.text) replacements[s.id] = next;
    }
    const intro = introSlot(slots);
    const copy = intro ? descriptionCopy(edits.about, Math.floor(intro.text.length * 1.6)) : null;
    if (intro && copy) replacements[intro.id] = copy;

    // 2. SOL's words win over the above (they already use the owner's name).
    let solApplied = 0;
    if (stage === "all" || stage === "no-remove") {
      stale = !!edits.slotsKey && edits.slotsKey !== slotsKeyOf(slots) && Object.keys(edits.copy ?? {}).length > 0;
      const sol = stale ? {} : copyBySlot(slots, edits.copy ?? {});
      Object.assign(replacements, sol);
      solApplied = Object.keys(sol).length;
    }
    const applied = applySlotCopy(docs, replacements);
    let pageDoc = applied.docs[0];

    // 3. The search description and title carry the owner's name and description too.
    const baseMeta = isRecord((pageDoc.design as { meta?: unknown }).meta) ? ({ ...((pageDoc.design as { meta: Record<string, unknown> }).meta) }) : {};
    for (const key of ["htmlTitle", "metaDescription"]) if (typeof baseMeta[key] === "string") baseMeta[key] = swap(baseMeta[key] as string);
    const metaCopy = descriptionCopy(edits.about, 160);
    if (metaCopy) baseMeta.metaDescription = metaCopy;
    let design: Record<string, unknown> = { ...(pageDoc.design as Record<string, unknown>), ...(Object.keys(baseMeta).length ? { meta: baseMeta } : {}) };
    pageDoc = { ...pageDoc, design };

    // 4. Optional sections SOL chose to drop, and photos when the design was made for another kind of business.
    let removed: string[] = [];
    if (stage === "all" && edits.remove?.length) {
      const r = removeSections(pageDoc, edits.remove);
      pageDoc = r.doc;
      removed = r.removed;
      design = pageDoc.design as Record<string, unknown>;
    }
    const photos = edits.domain ? DOMAIN_STOCK_PHOTOS[edits.domain] : undefined;
    if ((stage === "all" || stage === "no-remove") && photos?.length && detectPersonalizationDomain(`${edits.designName ?? ""} ${edits.designDescription ?? ""}`) !== edits.domain) {
      design = clone(design);
      swapPhotos(design, photos);
    }

    // 5. The colours and logo.
    const stageWarnings: string[] = [];
    if (opts.look) design = applyLook(design, edits, stageWarnings);

    const checked = parseV2Design(design);
    if (!checked.ok) return null;
    warnings.push(...stageWarnings);
    return { design, warnings: [], solApplied, removed };
  };

  for (const stage of ["all", "no-remove", "brand-only", "none"] as const) {
    let result: EditedDesign | null = null;
    try {
      result = await tryStage(stage);
    } catch (e) {
      console.warn(`[design-edit] ${stage} failed:`, e);
    }
    if (result) {
      if (stage === "brand-only" || stage === "none") {
        const solWanted = Object.keys(edits.copy ?? {}).length > 0 && !stale;
        if (solWanted) warnings.push("SOL's new words couldn't be fitted into this design safely, so it keeps its own words. You can ask SOL to rewrite them from the editor.");
      } else if (stale) {
        warnings.push("This design was updated by its maker while SOL was working, so SOL's new words weren't used. Ask SOL to rewrite them from the editor.");
      } else if (stage === "no-remove" && edits.remove?.length) {
        warnings.push("SOL's wording is in, but this design keeps all its sections.");
      }
      return { ...result, warnings };
    }
  }
  return { design: original, warnings, solApplied: 0, removed: [] };
}

/** A short code for one personalized design (which listing, which recipe): the preview and the new website both derive it, so a stale preview is easy to spot. */
export function designToken(designId: string, edits: DesignEdits): string {
  const stable = JSON.stringify([designId, edits.name, edits.about ?? "", edits.colors ?? [], edits.logoUrl ?? "", edits.domain ?? "", edits.remove ?? [], Object.entries(edits.copy ?? {}).sort(([a], [b]) => Number(a) - Number(b))]);
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

/** A short code for the words SOL was shown, so SOL's numbered answers are only used on the same words. */
export function slotsKeyOf(slots: Slot[]): string {
  return createHash("sha256").update(JSON.stringify(slots.map((s) => [s.id, s.text]))).digest("hex").slice(0, 16);
}

export type ListingForEdit = { id: string; name: string; description: string | null; designJson: Record<string, unknown> };

/** The published marketplace page design with this id, when it is a new-editor design a person can personalize; null for anything else (classic, uploaded, email, taken down). */
export async function loadListingForEdit(designId: string): Promise<ListingForEdit | null> {
  if (!designId || !/^[\w-]{1,80}$/.test(designId)) return null;
  const { data: row } = await Template.get({ id: designId }).go();
  if (!row || row.marketplaceStatus !== "PUBLISHED" || row.kind !== "LANDING_PAGE" || row.sourceType !== "BUILDER" || designFormatOf(row) !== "v2" || !isRecord(row.designJson)) return null;
  return { id: row.id, name: row.name, description: row.marketplaceDescription ?? null, designJson: row.designJson };
}

/** The slots of a listing's design (what SOL reads and rewrites) and the optional sections it may drop. */
export function slotsOfListing(listing: ListingForEdit): { slots: Slot[]; removable: ReturnType<typeof removableSections> } {
  const doc: SlotDoc = { role: "page", design: listing.designJson };
  return { slots: listSlots([doc]), removable: removableSections(doc) };
}

/** The design as a page: compiled with the compiler the editor and publisher use, so what is previewed is what the editor holds and what publishes. */
export async function compileEdited(listing: ListingForEdit, design: Record<string, unknown>): Promise<string> {
  const resolved = await resolveDesignSystem(design);
  return compileV2Design(resolved, { rootTemplateId: listing.id, pageTemplateId: listing.id, name: listing.name, layout: null });
}
