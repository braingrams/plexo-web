"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Check, Search, Star, Upload } from "lucide-react";
import { Button, Modal } from "../ui";
import { FONTS, FONT_KINDS, FONT_PAIRS, WEIGHT_NAMES, cssFamily, findFont, nearestWeight, searchFonts, type FontKind, type FontPair } from "@/lib/fonts/catalogue";
import { FONT_FILE_ACCEPT, MAX_FONT_FILE_BYTES, guessFontFromFile, type CustomFont } from "@/lib/fonts/customFonts";
import { loadFavourites, saveFavourites, toggleFavourite } from "@/lib/fonts/favourites";
import { loadFontFamily, loadFontPreview } from "@/lib/fonts/loadClient";
import { errMsg, hubApi } from "./hubApi";

const PAGE = 40;
type Tab = "all" | "favourites" | "mine";

/** A font's name written in its own face. The font's tiny preview stylesheet is only requested once the row scrolls into view. */
function FontRow({ name, kind, selected, favourite, onPick, onStar, custom }: { name: string; kind: string; selected: boolean; favourite: boolean; onPick: () => void; onStar?: () => void; custom?: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return void setSeen(true);
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => { if (seen && !custom) loadFontPreview(name); }, [seen, name, custom]);
  return (
    <li ref={ref} className="plx-fp__row" data-selected={selected || undefined}>
      <button type="button" className="plx-fp__pick" aria-pressed={selected} onClick={onPick}>
        <span className="plx-fp__name" style={{ fontFamily: seen ? cssFamily(name, findFont(name)?.kind) : undefined }}>{name}</span>
        <span className="plx-small">{kind}</span>
        {selected ? <Check size={16} aria-hidden /> : null}
      </button>
      {onStar ? <button type="button" className="plx-fp__star" aria-label={favourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`} aria-pressed={favourite} onClick={onStar}><Star size={16} aria-hidden fill={favourite ? "currentColor" : "none"} /></button> : null}
    </li>
  );
}

/** The font picker: search about 1,800 fonts, filter by style, star favourites, choose a weight, or upload your own. */
export function FontPickerModal({ open, onClose, title, value, weight, customFonts, siteId, onChoose, onCustomFonts }: {
  open: boolean; onClose: () => void; title: string; value: string; weight: number; customFonts: CustomFont[]; siteId?: string;
  onChoose: (family: string, weight: number) => void; onCustomFonts?: (list: CustomFont[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FontKind | "all">("all");
  const [tab, setTab] = useState<Tab>("all");
  const [shown, setShown] = useState(PAGE);
  const [favs, setFavs] = useState<string[]>([]);
  const [pick, setPick] = useState(value);
  const [pickWeight, setPickWeight] = useState(weight);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setFavs(loadFavourites()); setPick(value); setPickWeight(weight); setQuery(""); setShown(PAGE); setError(null); } }, [open, value, weight]);
  useEffect(() => { setShown(PAGE); }, [query, kind, tab]);

  const results = useMemo(() => searchFonts({ query, kind, only: tab === "favourites" ? favs : undefined }), [query, kind, tab, favs]);
  const mine = useMemo(() => customFonts.filter((f) => !query.trim() || f.family.toLowerCase().includes(query.trim().toLowerCase())), [customFonts, query]);
  const catalogue = findFont(pick);
  const custom = customFonts.find((f) => f.family.toLowerCase() === pick.toLowerCase());
  const weights = custom ? [...new Set(custom.variants.map((v) => v.weight))].sort((a, b) => a - b) : catalogue?.weights ?? [400, 700];

  useEffect(() => { if (open && catalogue) loadFontFamily(catalogue.name, [...weights.filter((w) => [400, 700].includes(w)), pickWeight]); }, [open, catalogue, weights, pickWeight]);

  const choose = (family: string) => {
    setPick(family);
    const f = findFont(family);
    const c = customFonts.find((x) => x.family.toLowerCase() === family.toLowerCase());
    setPickWeight(c ? (c.variants.some((v) => v.weight === pickWeight) ? pickWeight : c.variants[0].weight) : f ? nearestWeight(family, pickWeight) : pickWeight);
  };
  const star = (name: string) => { const next = toggleFavourite(favs, name); setFavs(next); saveFavourites(next); };

  async function upload(file: File) {
    if (!siteId) return;
    setError(null);
    const guess = guessFontFromFile(file.name);
    if (!guess.format) return setError("That isn't a font file we can use. Try a .woff2, .woff, .ttf or .otf file.");
    if (file.size > MAX_FONT_FILE_BYTES) return setError("That font file is too big. Fonts up to 3 MB work.");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await hubApi<{ url: string }>("/api/v1/media/font", { method: "POST", body: form }, "We couldn't upload that font. Please try again.");
      const family = guess.family || "My font";
      const res = await hubApi<{ customFonts: CustomFont[] }>(`/api/v1/sites/${encodeURIComponent(siteId)}/fonts`, { method: "POST", json: { family, weight: guess.weight, style: guess.style, format: guess.format, url: up.url } }, "We couldn't add that font. Please try again.");
      onCustomFonts?.(res.customFonts);
      setTab("mine");
      setPick(family);
      setPickWeight(guess.weight);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button disabled={!pick} onClick={() => { onChoose(pick, pickWeight); onClose(); }}>Use {pick || "this font"}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} description="Search every Google font, or upload your own. Each name is shown in its own style." footer={footer} width={720}>
      <div className="plx-fp">
        <div className="plx-fp__tools">
          <label className="plx-fp__search">
            <Search size={16} aria-hidden />
            <span className="plx-sr-only">Search fonts</span>
            <input type="search" value={query} placeholder={`Search ${FONTS.length.toLocaleString("en-US")} fonts`} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div role="group" aria-label="Font style" className="plx-bdef__choices">
            <button type="button" className="plx-bdef__choice" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All</button>
            {FONT_KINDS.map((k) => <button key={k.id} type="button" className="plx-bdef__choice" aria-pressed={kind === k.id} title={k.hint} onClick={() => setKind(k.id)}>{k.label}</button>)}
          </div>
          <div role="tablist" aria-label="Which fonts" className="plx-fp__tabs">
            <button role="tab" type="button" aria-selected={tab === "all"} onClick={() => setTab("all")}>All fonts</button>
            <button role="tab" type="button" aria-selected={tab === "favourites"} onClick={() => setTab("favourites")}>Favourites{favs.length ? ` (${favs.length})` : ""}</button>
            <button role="tab" type="button" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>My fonts{customFonts.length ? ` (${customFonts.length})` : ""}</button>
          </div>
        </div>

        {tab === "mine" ? (
          <div className="plx-fp__mine">
            {siteId ? (
              <>
                <input ref={fileRef} type="file" accept={FONT_FILE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                <Button variant="secondary" leftIcon={<Upload size={16} aria-hidden />} loading={uploading} onClick={() => fileRef.current?.click()}>Upload my own font</Button>
                <p className="plx-small" style={{ margin: 0 }}>Use a .woff2, .woff, .ttf or .otf file you have the right to use on a website. It goes on every page of your site.</p>
              </>
            ) : null}
            {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
            <ul className="plx-fp__list" aria-label="My fonts">
              {mine.map((f) => <FontRow key={f.family} custom name={f.family} kind="Uploaded by you" selected={pick.toLowerCase() === f.family.toLowerCase()} favourite={false} onPick={() => choose(f.family)} />)}
            </ul>
            {!mine.length ? <p className="plx-small">You haven&apos;t uploaded a font yet.</p> : null}
          </div>
        ) : (
          <>
            {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
            <ul className="plx-fp__list" aria-label="Fonts">
              {results.slice(0, shown).map((f) => (
                <FontRow key={f.name} name={f.name} kind={FONT_KINDS.find((k) => k.id === f.kind)?.label ?? ""} selected={pick.toLowerCase() === f.name.toLowerCase()} favourite={favs.includes(f.name)} onPick={() => choose(f.name)} onStar={() => star(f.name)} />
              ))}
            </ul>
            {results.length > shown ? <div><Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show more fonts ({(results.length - shown).toLocaleString("en-US")} left)</Button></div> : null}
            {!results.length ? <p className="plx-small" role="status">{tab === "favourites" ? "Tap the star next to a font to keep it here." : `No font is called “${query}”. Try a shorter word, or another style.`}</p> : null}
          </>
        )}

        {pick ? (
          <div className="plx-fp__preview" aria-label="Preview">
            <div style={{ fontFamily: cssFamily(pick, catalogue?.kind), fontWeight: pickWeight }}>
              <div style={{ fontSize: 28, lineHeight: 1.2 }}>The quick brown fox</div>
              <div style={{ fontSize: 16 }}>Fresh bread, baked slow. 0123456789</div>
            </div>
            <div role="radiogroup" aria-label="Weight" className="plx-bdef__choices">
              {weights.map((w) => <button key={w} type="button" role="radio" aria-checked={pickWeight === w} className="plx-bdef__choice" onClick={() => setPickWeight(w)}>{WEIGHT_NAMES[w] ?? w}</button>)}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** One font choice on the page: the font's name in its own face, its weight, and a button that opens the picker. */
export function FontField({ label, hint, value, weight, customFonts, siteId, onChange, onCustomFonts }: { label: string; hint: string; value: string; weight: number; customFonts: CustomFont[]; siteId?: string; onChange: (family: string, weight: number) => void; onCustomFonts?: (list: CustomFont[]) => void }) {
  const [open, setOpen] = useState(false);
  const font = findFont(value);
  useEffect(() => { if (value && font) loadFontFamily(font.name, [weight, 400, 700]); }, [value, font, weight]);
  return (
    <div className="plx-fp__field">
      <span className="plx-field__label">{label}</span>
      <button type="button" className="plx-fp__current" onClick={() => setOpen(true)} aria-label={`${label}: ${value}, ${WEIGHT_NAMES[weight] ?? weight}. Change`}>
        <span className="plx-fp__aa" style={{ fontFamily: cssFamily(value, font?.kind), fontWeight: weight }} aria-hidden>Aa</span>
        <span className="plx-fp__meta"><b style={{ fontFamily: cssFamily(value, font?.kind) }}>{value}</b><span className="plx-small">{WEIGHT_NAMES[weight] ?? weight} · {hint}</span></span>
        <span className="plx-fp__change">Change</span>
      </button>
      <FontPickerModal open={open} onClose={() => setOpen(false)} title={`Choose your ${label.toLowerCase()} font`} value={value} weight={weight} customFonts={customFonts} siteId={siteId} onChoose={onChange} onCustomFonts={onCustomFonts} />
    </div>
  );
}

/** "Fonts that go well together": ready-made heading and text pairs. Tapping one fills both choices. */
export function FontPairs({ heading, body, onPair }: { heading: string; body: string; onPair: (pair: FontPair) => void }) {
  useEffect(() => { for (const p of FONT_PAIRS) { loadFontPreview(p.heading); loadFontPreview(p.body); } }, []);
  return (
    <div className="plx-fp__pairs">
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Fonts that go well together</h4>
      <p className="plx-small" style={{ margin: 0 }}>Not sure? Pick a pair and both fonts are set for you.</p>
      <ul className="plx-fp__paircards">
        {FONT_PAIRS.slice(0, 8).map((p) => {
          const on = p.heading === heading && p.body === body;
          return (
            <li key={`${p.heading}|${p.body}`}>
              <button type="button" aria-pressed={on} onClick={() => onPair(p)}>
                <span style={{ fontFamily: cssFamily(p.heading), fontWeight: 700, fontSize: 18 }}>{p.heading}</span>
                <span style={{ fontFamily: cssFamily(p.body), fontSize: 14 }}>with {p.body}</span>
                <span className="plx-small">{p.mood}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
