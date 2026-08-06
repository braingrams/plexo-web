import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import postcss, { type Rule } from "postcss";

/**
 * Companion to htmlTextExtraction.ts for the "Text Content" editor's Images section — same
 * deterministic-re-walk pattern (extract/apply both re-parse the ORIGINAL compiledHtml fresh
 * and assign ids in the same fixed order every time, so a GET's ids stay valid for a later
 * PATCH). Two independent id sequences, namespaced by `kind`, since "position" isn't
 * comparable between a DOM element (<img>) and a CSS AST declaration (background-image) —
 * a combined edit always needs both `kind` and `id`.
 */

const SKIP_IMG_ANCESTORS = "svg, head, noscript, template";

export type ExtractedImgNode = {
  kind: "img";
  id: number;
  label: string;
  src: string;
  alt: string;
  /** Current explicit size in px, from inline style or the width/height attributes — null
   * means unset (the image renders at its natural/CSS-driven size). */
  width: number | null;
  height: number | null;
};

export type ExtractedBackgroundNode = {
  kind: "background";
  id: number;
  label: string;
  src: string;
  /** null means no explicit background-size is set (browser default, i.e. auto/tiled). */
  backgroundSize: string | null;
  /** Shorthand `background: ... url(...)` declarations only expose URL editing — resizing
   * a shorthand's size component isn't supported, to avoid corrupting the rest of the value. */
  supportsResize: boolean;
};

export type ExtractedImageNode = ExtractedImgNode | ExtractedBackgroundNode;

function parseStyleAttr(styleStr: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (styleStr ?? "").split(";").forEach((pair) => {
    const idx = pair.indexOf(":");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function serializeStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function pxToNumber(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^([\d.]+)px$/.exec(value.trim());
  return m ? Math.round(parseFloat(m[1])) : null;
}

function imgDims($: cheerio.CheerioAPI, el: Element): { width: number | null; height: number | null } {
  const style = parseStyleAttr($(el).attr("style"));
  let width = pxToNumber(style.width);
  let height = pxToNumber(style.height);
  if (width === null) {
    const wAttr = $(el).attr("width");
    if (wAttr && /^\d+$/.test(wAttr)) width = parseInt(wAttr, 10);
  }
  if (height === null) {
    const hAttr = $(el).attr("height");
    if (hAttr && /^\d+$/.test(hAttr)) height = parseInt(hAttr, 10);
  }
  return { width, height };
}

function imgLabel($: cheerio.CheerioAPI, el: Element): string {
  const cls = ($(el).attr("class") ?? "").toLowerCase();
  const alt = ($(el).attr("alt") ?? "").toLowerCase();
  const idAttr = ($(el).attr("id") ?? "").toLowerCase();
  const hay = `${cls} ${alt} ${idAttr}`;
  if (hay.includes("logo")) return "Logo";
  if (hay.includes("icon")) return "Icon";
  if (hay.includes("avatar") || hay.includes("profile")) return "Avatar";
  if ($(el).parents("header").length) return "Header image";
  if ($(el).parents("footer").length) return "Footer image";
  if ($(el).parents("nav").length) return "Nav image";
  return "Image";
}

function backgroundLabel($: cheerio.CheerioAPI, selector: string): string {
  try {
    const matched = $(selector).first();
    if (matched.length) {
      if (matched.parents("header").length || matched.is("header")) return "Header background";
      if (matched.parents("footer").length || matched.is("footer")) return "Footer background";
      if (matched.parents("nav").length) return "Nav background";
    }
  } catch {
    // Unsupported/invalid selector for cheerio's matcher — fall through to the generic label.
  }
  const cleanedSelector = selector.replace(/^[.#]/, "").split(/[.#\s>:]/)[0];
  if (/hero/i.test(cleanedSelector)) return "Hero background";
  return "Background image";
}

function extractUrl(declValue: string): string | null {
  const m = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(declValue);
  return m ? m[2] : null;
}

export function extractImageNodes(html: string): ExtractedImageNode[] {
  const $ = cheerio.load(html);
  const nodes: ExtractedImageNode[] = [];

  let imgId = 0;
  $("img").each((_, el) => {
    if ($(el).parents(SKIP_IMG_ANCESTORS).length) return;
    const src = $(el).attr("src");
    if (!src) return;
    const { width, height } = imgDims($, el);
    nodes.push({
      kind: "img",
      id: imgId++,
      label: imgLabel($, el),
      src,
      alt: $(el).attr("alt") ?? "",
      width,
      height,
    });
  });

  let bgId = 0;
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let root;
    try {
      root = postcss.parse(cssText);
    } catch {
      return;
    }
    root.walkDecls(/^background(-image)?$/i, (decl) => {
      const url = extractUrl(decl.value);
      if (!url) return;
      const rule = decl.parent;
      if (!rule || rule.type !== "rule") return;
      const selector = (rule as Rule).selector;
      const isShorthand = decl.prop.toLowerCase() === "background";
      let backgroundSize: string | null = null;
      if (!isShorthand) {
        const sizeDecl = rule.nodes?.find((n) => n.type === "decl" && n.prop.toLowerCase() === "background-size");
        backgroundSize = sizeDecl && sizeDecl.type === "decl" ? sizeDecl.value : null;
      }
      nodes.push({
        kind: "background",
        id: bgId++,
        label: backgroundLabel($, selector),
        src: url,
        backgroundSize,
        supportsResize: !isShorthand,
      });
    });
  });

  return nodes;
}

/**
 * Tags every extracted image/background node's rendering element(s) with `data-pimg` /
 * `data-pbg` so the live preview can locate, highlight, and resize them — same numbering
 * as extractImageNodes, since both re-walk the same input in the same order. A background
 * selector can match multiple elements (a shared class); all of them get tagged, same
 * `data-ptid` multi-id convention as htmlTextExtraction's text annotation.
 */
export function annotateImageNodesForPreview(html: string): string {
  const $ = cheerio.load(html);

  let imgId = 0;
  $("img").each((_, el) => {
    if ($(el).parents(SKIP_IMG_ANCESTORS).length) return;
    if (!$(el).attr("src")) return;
    $(el).attr("data-pimg", String(imgId++));
  });

  let bgId = 0;
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let root;
    try {
      root = postcss.parse(cssText);
    } catch {
      return;
    }
    root.walkDecls(/^background(-image)?$/i, (decl) => {
      if (!extractUrl(decl.value)) return;
      const rule = decl.parent;
      if (!rule || rule.type !== "rule") return;
      const currentId = bgId++;
      try {
        const matched = $((rule as Rule).selector);
        matched.each((__, matchedEl) => {
          const existing = $(matchedEl).attr("data-pbg");
          $(matchedEl).attr("data-pbg", existing ? `${existing} ${currentId}` : `${currentId}`);
        });
      } catch {
        // Selector syntax cheerio can't match (e.g. :hover) — id sequence still advances
        // consistently, this node just won't be highlightable in the preview.
      }
    });
  });

  return $.html();
}

export type ImgEdit = { id: number; src?: string; width?: number | null; height?: number | null };
export type BackgroundEdit = { id: number; src?: string; backgroundSize?: string | null };

/**
 * Re-parses the SAME html the ids came from (mirrors applyTextEdits) and applies each
 * requested edit in place. Background edits rewrite the CSS declaration inside its <style>
 * block, not an inline style — the source of truth stays the stylesheet, matching how the
 * template actually renders the background everywhere that selector applies.
 */
export function applyImageEdits(html: string, imgEdits: ImgEdit[], backgroundEdits: BackgroundEdit[]): string {
  const $ = cheerio.load(html);

  const imgEditById = new Map(imgEdits.map((e) => [e.id, e]));
  let imgId = 0;
  $("img").each((_, el) => {
    if ($(el).parents(SKIP_IMG_ANCESTORS).length) return;
    if (!$(el).attr("src")) return;
    const currentId = imgId++;
    const edit = imgEditById.get(currentId);
    if (!edit) return;

    if (edit.src !== undefined) $(el).attr("src", edit.src);

    const style = parseStyleAttr($(el).attr("style"));
    if (edit.width !== undefined) {
      if (edit.width === null) delete style.width;
      else style.width = `${edit.width}px`;
    }
    if (edit.height !== undefined) {
      if (edit.height === null) delete style.height;
      else style.height = `${edit.height}px`;
    }
    const newStyle = serializeStyle(style);
    if (newStyle) $(el).attr("style", newStyle);
    else $(el).removeAttr("style");
  });

  const bgEditById = new Map(backgroundEdits.map((e) => [e.id, e]));
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let root;
    try {
      root = postcss.parse(cssText);
    } catch {
      return;
    }
    let changed = false;
    let bgId = 0;
    root.walkDecls(/^background(-image)?$/i, (decl) => {
      if (!extractUrl(decl.value)) return;
      const rule = decl.parent;
      if (!rule || rule.type !== "rule") return;
      const currentId = bgId++;
      const edit = bgEditById.get(currentId);
      if (!edit) return;
      changed = true;

      if (edit.src !== undefined) {
        decl.value = decl.value.replace(/url\([^)]*\)/i, `url("${edit.src}")`);
      }
      if (edit.backgroundSize !== undefined && decl.prop.toLowerCase() === "background-image") {
        const sizeDecl = rule.nodes?.find((n) => n.type === "decl" && n.prop.toLowerCase() === "background-size");
        if (edit.backgroundSize === null) {
          sizeDecl?.remove();
        } else if (sizeDecl && sizeDecl.type === "decl") {
          sizeDecl.value = edit.backgroundSize;
        } else {
          decl.after({ prop: "background-size", value: edit.backgroundSize });
        }
      }
    });
    if (changed) $(styleEl).text(root.toString());
  });

  return $.html();
}
