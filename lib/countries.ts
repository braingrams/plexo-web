// The countries Plexo knows (ISO-3166 alpha-2), their display names and broad regions.
// Pure and dependency-free so the sign-up form, the dashboard prompt, the API and the
// admin app (which keeps a copy of this file) all agree on what a valid country is.

const REGIONS: Record<string, string> = {
  Africa: "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  Europe: "AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB AX",
  "North America": "AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI",
  "South America": "AR BO BR CL CO EC FK GF GY PY PE SR UY VE GS",
  Oceania: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF CX CC HM",
  Asia: "AF AM AZ BH BD BT BN KH CN GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE AQ BV IO TF",
};

export type CountryRegion = keyof typeof REGIONS;

const REGION_OF = new Map<string, string>();
for (const [region, codes] of Object.entries(REGIONS)) for (const c of codes.split(" ")) REGION_OF.set(c, region);

export const COUNTRY_CODES: readonly string[] = [...REGION_OF.keys()].filter((c) => c !== "AQ" && c !== "BV" && c !== "HM" && c !== "TF" && c !== "GS" && c !== "UM" && c !== "IO");
export const COUNTRY_REGIONS: readonly string[] = Object.keys(REGIONS);

/** Upper-cases and validates; null when it isn't a real country code. */
export function normalizeCountryCode(value: unknown): string | null {
  const c = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(c) && COUNTRY_CODES.includes(c) ? c : null;
}

export function regionOfCountry(code: string | null | undefined): string | null {
  const c = normalizeCountryCode(code);
  return c ? (REGION_OF.get(c) ?? null) : null;
}

let namer: Intl.DisplayNames | null | undefined;
export function countryName(code: string | null | undefined): string {
  const c = normalizeCountryCode(code);
  if (!c) return "Unknown";
  if (namer === undefined) {
    try {
      namer = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      namer = null;
    }
  }
  return namer?.of(c) ?? c;
}

/** Every country, alphabetised by name. */
export function countryOptions(): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** A flag emoji for a country code (blank for an invalid one). */
export function countryFlag(code: string | null | undefined): string {
  const c = normalizeCountryCode(code);
  return c ? String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "";
}

/** Ask a signed-in owner for their country until they have set one. It can't be put off. */
export function shouldAskCountry(user: { country?: string | null; countryAskedAt?: string | null }): boolean {
  return !normalizeCountryCode(user.country);
}

