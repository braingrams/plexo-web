// No imports: shared by the build pipeline and its tests without loading the app around it.

/** Re-reads `next()` with gentle backoff until it's no longer pending or the deadline
 *  passes, then returns the last result. */
export async function settle<T extends { pending: boolean }>(next: () => Promise<T>, deadline: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let delay = 750;
  for (;;) {
    const result = await next();
    if (!result.pending || Date.now() >= deadline) return result;
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    delay = Math.min(delay * 1.4, 3000);
  }
}
