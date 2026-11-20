/**
 * What the "Delete this site" confirmation says. One place, so the My sites cards, the all-sites dashboard and Site settings
 * warn in exactly the same plain words: what goes, what stays, and that it can't be undone. Pure.
 */
export type DeleteSiteInput = { name: string; live: boolean; address?: string | null; kind?: string | null };

export type DeleteSiteCopy = {
  title: string;
  /** What will happen, one short sentence each. */
  goes: string[];
  /** What is not touched. */
  stays: string[];
  /** A live site asks for a tick before the button works, so a stray tap can never take down a working site. */
  needsTick: boolean;
  tickLabel: string;
  confirmLabel: string;
  keepLabel: string;
};

export function deleteSiteCopy({ name, live, address, kind }: DeleteSiteInput): DeleteSiteCopy {
  const what = kind === "Online store" ? "its products and orders" : kind === "Blog" ? "its posts" : kind === "Course" ? "its lessons" : "everything on it";
  const goes = [`All the pages of "${name}" and ${what} are deleted for good.`];
  if (live) goes.push(address ? `${address} stops working straight away. Visitors will not find your site there any more.` : "Visitors will not find your site any more.");
  goes.push("This can't be undone.");
  return {
    title: `Delete "${name}"?`,
    goes,
    stays: ["Your other websites and your Plexo account are not touched."],
    needsTick: live,
    tickLabel: "Yes, take this site down and delete it",
    confirmLabel: "Delete for good",
    keepLabel: "Keep my site",
  };
}
