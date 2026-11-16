/** Where each kind of page is edited (the existing editors). A pure helper shared by server and client code. */
export function editHrefFor(id: string, sourceType: string | null | undefined): string {
  return sourceType === "REACT_PROJECT" ? `/dashboard/apps/${id}` : `/dashboard/templates/${id}`;
}
