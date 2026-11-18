/** Where people open their brand in Strata itself. Safe in the browser (no secrets). */
const APP = (process.env.NEXT_PUBLIC_STRATA_APP_URL || "https://strata.charisol.io").replace(/\/+$/, "");

/** The project's Brand bible page in Strata. Charisol is one sign-in, so someone already signed in to Charisol in this browser lands straight on it. */
export const strataBrandBibleUrl = (projectId: string): string => `${APP}/project/${encodeURIComponent(projectId)}?section=brand-bible`;
