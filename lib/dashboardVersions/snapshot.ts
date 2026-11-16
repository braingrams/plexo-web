import type { DashboardVersionRow } from "./types";

/** The last registry read on this server instance (shared by store.ts and the sync isDashboardV3). */
let snap: { at: number; rows: DashboardVersionRow[] } | null = null;

export const getSnapshot = () => snap;
export const setSnapshot = (rows: DashboardVersionRow[]) => {
  snap = { at: Date.now(), rows };
};
export const clearSnapshot = () => {
  snap = null;
};
