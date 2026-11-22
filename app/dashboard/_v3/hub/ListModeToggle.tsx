"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { SegmentedControl } from "../ui";
import { listModeKey, parseListMode, type ListMode } from "@/lib/dashboardV3/listMode";

/** Grid or List for one hub list, remembered in this browser. Shared by Blog and Products so they behave alike. */
export function useListMode(list: string, fallback: ListMode = "list"): [ListMode, (m: ListMode) => void] {
  const [mode, setMode] = useState<ListMode>(fallback);
  useEffect(() => {
    try {
      setMode(parseListMode(window.localStorage.getItem(listModeKey(list)), fallback));
    } catch {
      /* private window: just use the default */
    }
  }, [list, fallback]);
  const set = useCallback(
    (m: ListMode) => {
      setMode(m);
      try {
        window.localStorage.setItem(listModeKey(list), m);
      } catch {
        /* not remembered, still works */
      }
    },
    [list],
  );
  return [mode, set];
}

export function ListModeToggle({ mode, onChange }: { mode: ListMode; onChange: (m: ListMode) => void }) {
  return (
    <SegmentedControl<ListMode>
      label="How to show the list"
      value={mode}
      onChange={onChange}
      options={[
        { value: "list", label: "List", icon: <List size={16} aria-hidden /> },
        { value: "grid", label: "Grid", icon: <LayoutGrid size={16} aria-hidden /> },
      ]}
    />
  );
}
