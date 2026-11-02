// One way to page a list everywhere in the dashboard: ?page=2&pageSize=50 in, a slice plus the numbers the
// pager needs out. Lists are fetched whole and cut here (the same "small in practice" assumption the rest of
// the data layer makes), so nothing is ever capped — the total is always the real total.

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type PageRequest = { page: number; pageSize: number };
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

const toInt = (v: unknown): number => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

/** Reads page / pageSize from query params. Garbage falls back to page 1 and the default size; size is limited to the offered choices. */
export function parsePageRequest(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  defaults: { pageSize?: number } = {},
): PageRequest {
  const get = (k: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined;
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = toInt(get("page"));
  const size = toInt(get("pageSize"));
  const fallback = defaults.pageSize ?? DEFAULT_PAGE_SIZE;
  const allowed = (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : fallback;
  return { page: page >= 1 ? page : 1, pageSize: allowed };
}

/** Cuts one page out of a list. A page past the end becomes the last page, so a bookmarked or just-emptied page still shows something. */
export function paginate<T>(all: readonly T[], req: PageRequest): Paged<T> {
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / req.pageSize));
  const page = Math.min(req.page, pageCount);
  const start = (page - 1) * req.pageSize;
  return { items: all.slice(start, start + req.pageSize), total, page, pageSize: req.pageSize, pageCount };
}

/** Page numbers to show, with null for a gap: 1 … 4 5 [6] 7 8 … 20. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}
