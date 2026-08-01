// Plain <form method="get">, no client JS needed — submitting navigates to
// /marketplace?... and the server component above re-renders with the new filters.
export function MarketplaceFilters({
  categories,
  current,
}: {
  categories: string[];
  current: { category?: string; kind?: string; free?: string; q?: string; sort: string };
}) {
  return (
    <form method="get" action="/marketplace" className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        name="q"
        defaultValue={current.q}
        placeholder="Search templates…"
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500 w-48"
      />
      <select
        name="category"
        defaultValue={current.category ?? ""}
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        name="kind"
        defaultValue={current.kind ?? ""}
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500"
      >
        <option value="">All types</option>
        <option value="LANDING_PAGE">Landing page</option>
        <option value="EMAIL">Email</option>
      </select>
      <select
        name="free"
        defaultValue={current.free ?? ""}
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500"
      >
        <option value="">Free &amp; paid</option>
        <option value="true">Free only</option>
        <option value="false">Paid only</option>
      </select>
      <select
        name="sort"
        defaultValue={current.sort}
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500"
      >
        <option value="latest">Latest</option>
        <option value="popular">Popular</option>
      </select>
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
      >
        Apply
      </button>
    </form>
  );
}
