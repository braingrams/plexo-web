/** The oldest revisions beyond the cap, minus the ones a page can still go back to (its classic or block backup). Pure. */
export function staleRevisions<T extends { id: string }>(newestFirst: T[], max: number, protectedIds: Set<string>): T[] {
  return newestFirst.slice(max).filter((r) => !protectedIds.has(r.id));
}
