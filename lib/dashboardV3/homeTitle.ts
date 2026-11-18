/** The big line at the top of Home. A site still called by its starting name ("Deployed app", "Untitled") reads oddly, so it says "your app" instead. */
const GENERIC = /^(deployed (app|site)|untitled( (site|app|website|project))?|my (new )?(site|app|website)|new (site|app|website)|(test )?(site|app|website)|test)$/i;

export const isGenericName = (name: string | null | undefined): boolean => !name?.trim() || GENERIC.test(name.trim());

/** "app" for an app, "site" for everything else. */
export const thingOf = (kind: string | null | undefined): "app" | "site" => (/\bapp\b/i.test(kind ?? "") ? "app" : "site");

/** What to call the site in a sentence: its name, or "Your app" / "Your site" when the name is only a starting name. */
export function callIt(name: string, kind: string | null | undefined): string {
  return isGenericName(name) ? `Your ${thingOf(kind)}` : name;
}

export function homeTitle(input: { name: string; kind?: string | null; allDone: boolean }): string {
  // Not online yet: the name is already in the card beside it, so the line speaks to the owner.
  if (!input.allDone) return `Let's get your ${thingOf(input.kind)} online`;
  return `${callIt(input.name, input.kind)} is online`;
}
