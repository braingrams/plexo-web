/** Grid or List for a hub list (posts, products …). Remembered per list in this browser. Pure. */
export type ListMode = "list" | "grid";

export const listModeKey = (list: string) => `plx:listMode:${list}`;

export function parseListMode(raw: unknown, fallback: ListMode = "list"): ListMode {
  return raw === "grid" || raw === "list" ? raw : fallback;
}
