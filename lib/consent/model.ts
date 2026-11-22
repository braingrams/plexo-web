/** What the owner can change about the notice. Everything has a default that works, so nobody has to set anything up. */
export type ConsentSettings = {
  enabled: boolean;
  message: string;
  acceptLabel: string;
  declineLabel: string;
  position: "bar" | "card";
  /** #rrggbb, or null to follow the site's brand colour. */
  accentColor: string | null;
};

export const DEFAULT_CONSENT: ConsentSettings = {
  enabled: true,
  message: "We use cookies to count visitors and see which pages people like. Is that okay?",
  acceptLabel: "Accept",
  declineLabel: "No thanks",
  position: "bar",
  accentColor: null,
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Turns anything the owner (or an AI assistant) sent into settings that are safe to put on a page. Returns an error in plain words when something is off. */
export function normalizeConsentInput(input: unknown, base: ConsentSettings = DEFAULT_CONSENT): { ok: true; settings: ConsentSettings } | { ok: false; error: string } {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const next: ConsentSettings = { ...base };
  if ("enabled" in i) {
    if (typeof i.enabled !== "boolean") return { ok: false, error: "Choose on or off for the cookie notice." };
    next.enabled = i.enabled;
  }
  for (const [key, max, label] of [["message", 240, "message"], ["acceptLabel", 24, "accept button"], ["declineLabel", 24, "decline button"]] as const) {
    if (key in i) {
      const text = clean(i[key], max);
      // An empty box means "use the standard wording".
      next[key] = text || DEFAULT_CONSENT[key];
      if (typeof i[key] === "string" && (i[key] as string).trim().length > max) return { ok: false, error: `The ${label} text is too long. Keep it under ${max} characters.` };
    }
  }
  if ("position" in i) {
    if (i.position !== "bar" && i.position !== "card") return { ok: false, error: "Choose a bar along the bottom, or a small card in the corner." };
    next.position = i.position;
  }
  if ("accentColor" in i) {
    if (i.accentColor === null || i.accentColor === "") next.accentColor = null;
    else if (typeof i.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(i.accentColor.trim())) next.accentColor = i.accentColor.trim().toLowerCase();
    else return { ok: false, error: "Pick a colour from the colour picker (for example #1d4ed8), or leave it empty to follow your brand." };
  }
  return { ok: true, settings: next };
}

