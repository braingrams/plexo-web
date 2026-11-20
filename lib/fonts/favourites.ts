/** An owner's favourite fonts, kept in this browser (a convenience, not part of the brand). Pure helpers plus a guarded storage wrapper. */
export const FAVOURITES_KEY = "plexo.fonts.favourites";
const MAX = 60;

export function parseFavourites(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/.test(x)))].slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export const toggleFavourite = (list: string[], name: string): string[] => (list.includes(name) ? list.filter((n) => n !== name) : [name, ...list].slice(0, MAX));

export function loadFavourites(): string[] {
  try {
    return parseFavourites(window.localStorage.getItem(FAVOURITES_KEY));
  } catch {
    return [];
  }
}
export function saveFavourites(list: string[]): void {
  try {
    window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(list));
  } catch {
    /* private window or blocked storage: favourites just last for this visit */
  }
}
