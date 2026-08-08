import * as cheerio from "cheerio";
import postcss, { type Rule } from "postcss";

import type { ExternalStylesheet } from "@/lib/htmlColorExtraction";

// A bare one-class selector with nothing else — e.g. ".reveal", not ".reveal:hover" or
// ".reveal .child".
const SIMPLE_CLASS_SELECTOR = /^\.([a-zA-Z_-][\w-]*)$/;
// The SAME class immediately compounded with exactly one more class on the same element —
// e.g. ".reveal.in". Captures [base, modifier].
const TWO_CLASS_COMPOUND_SELECTOR = /^\.([a-zA-Z_-][\w-]*)\.([a-zA-Z_-][\w-]*)$/;

function declaredOpacity(rule: Rule): number | undefined {
  for (const node of rule.nodes ?? []) {
    if (node.type === "decl" && node.prop.toLowerCase() === "opacity") {
      const value = parseFloat(node.value);
      if (!Number.isNaN(value)) return value;
    }
  }
  return undefined;
}

/**
 * Undoes the single most common "scroll reveal" pattern generated templates use: a base
 * class sets `opacity:0` (plus usually a transform offset), and a small vanilla-JS
 * IntersectionObserver adds a second class once the element scrolls into view, whose rule
 * sets `opacity:1` (see e.g. a real generated template's own main.js: `.reveal{opacity:0}` /
 * `.reveal.in{opacity:1}`, toggled by `entries.forEach(e => e.target.classList.add('in'))`).
 *
 * The Text Content preview deliberately never runs page JS (see RawTextContentEditor.tsx /
 * ScriptAccessControl.tsx — running untrusted script there would require dropping
 * `allow-same-origin`, which the live-editing DOM sync depends on). Without the fix below,
 * EVERY section styled with this pattern — which is extremely common; it's the default
 * "fade/slide up on scroll" effect most landing-page generators produce — stays invisible
 * forever in the static preview, since the observer that would ever add the reveal class
 * never runs. Since this preview can't scroll-trigger anything anyway, the correct static
 * substitute is simply "already revealed": statically add the modifier class in the markup
 * wherever the CSS shows it undoes that exact opacity:0 base state.
 *
 * Deliberately narrow: only fires when a bare `.foo{opacity:0-ish}` rule AND a same-element
 * `.foo.bar{opacity:~1}` rule both exist — not any other hide/animate technique — so it can't
 * misfire on an unrelated compound selector (e.g. `.card.featured` styling that has nothing
 * to do with visibility) the way a broad "force everything visible" override would.
 * Cosmetic-only, exactly like htmlAssetRewrite.ts — never touches what gets persisted.
 */
export function forceRevealAnimationsForPreview(html: string, externalStylesheets: ExternalStylesheet[] = []): string {
  const $ = cheerio.load(html);

  const cssTexts: string[] = [];
  $("style").each((_, el) => { cssTexts.push($(el).html() ?? ""); });
  for (const sheet of externalStylesheets) cssTexts.push(sheet.content);

  const hiddenBaseClasses = new Set<string>();
  const modifiersByBase = new Map<string, Set<string>>();

  for (const cssText of cssTexts) {
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      continue;
    }
    parsed.walkRules((rule) => {
      for (const rawSelector of rule.selector.split(",")) {
        const selector = rawSelector.trim();
        const simple = SIMPLE_CLASS_SELECTOR.exec(selector);
        if (simple) {
          const opacity = declaredOpacity(rule);
          if (opacity !== undefined && opacity <= 0.02) hiddenBaseClasses.add(simple[1]);
          continue;
        }
        const compound = TWO_CLASS_COMPOUND_SELECTOR.exec(selector);
        if (compound) {
          const [, base, modifier] = compound;
          const opacity = declaredOpacity(rule);
          if (opacity !== undefined && opacity >= 0.98) {
            if (!modifiersByBase.has(base)) modifiersByBase.set(base, new Set());
            modifiersByBase.get(base)!.add(modifier);
          }
        }
      }
    });
  }

  let changed = false;
  for (const base of hiddenBaseClasses) {
    const modifiers = modifiersByBase.get(base);
    if (!modifiers || modifiers.size === 0) continue;
    $(`.${base}`).each((_, el) => {
      for (const modifier of modifiers) {
        if (!$(el).hasClass(modifier)) {
          $(el).addClass(modifier);
          changed = true;
        }
      }
    });
  }

  return changed ? $.html() : html;
}
