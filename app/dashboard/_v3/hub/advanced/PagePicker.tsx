"use client";

import { useEffect, useState } from "react";
import { Select } from "../../ui";
import { hubApi } from "../hubApi";

export type PickerPage = { id: string; name: string; parentId: string | null; slug: string | null; sourceType: string };

/** The pages of a site, for sections that work on one page at a time. Home first. */
export function usePages(siteId: string): { pages: PickerPage[] | null; error: string | null } {
  const [pages, setPages] = useState<PickerPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    hubApi<{ pages: PickerPage[] }>(`/api/templates/${siteId}/pages`).then(
      (d) => setPages([...d.pages].sort((a, b) => (a.parentId === null ? -1 : b.parentId === null ? 1 : a.name.localeCompare(b.name)))),
      () => { setError("We couldn't load your pages."); setPages([]); },
    );
  }, [siteId]);
  return { pages, error };
}

export function PagePicker({ pages, value, onChange, label = "Page" }: { pages: PickerPage[]; value: string; onChange: (id: string) => void; label?: string }) {
  return <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} options={pages.map((p) => ({ value: p.id, label: p.parentId === null ? `${p.name} (home)` : p.name }))} />;
}
