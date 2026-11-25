/**
 * Whether SOL personalized a site, and whether the owner gave SOL their contact details. These are saved on the site row
 * (solPersonalizedAt, solContactGivenAt) so they survive the editor's recompiles; older sites only have them as markers stamped into
 * the page HTML (data-sol-personalized / data-sol-contact), so those still count.
 */
export type SolMarkSource = {
  solPersonalizedAt?: string | null;
  solContactGivenAt?: string | null;
  compiledHtml?: string | null;
  draftHtml?: string | null;
} | null | undefined;

const inHtml = (t: SolMarkSource, marker: string): boolean => Boolean(t?.compiledHtml?.includes(marker) || t?.draftHtml?.includes(marker));

export function solPersonalizedOf(t: SolMarkSource): boolean {
  return Boolean(t?.solPersonalizedAt) || inHtml(t, 'data-sol-personalized="true"');
}

export function solContactOf(t: SolMarkSource): boolean {
  return Boolean(t?.solContactGivenAt) || inHtml(t, 'data-sol-contact="true"');
}
