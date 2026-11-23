const IGNORE = /^\/(favicon\.ico|apple-touch-icon.*|robots\.txt|sitemap.*\.xml|\.well-known\/.*|_next\/.*|__plexo\/.*)$/i;

/** True for addresses worth showing the owner: real pages people asked for, not browser or bot housekeeping. */
export function worthRecording(path: string): boolean {
  if (!path.startsWith("/") || path.length > 200) return false;
  if (IGNORE.test(path)) return false;
  if (/\.(map|png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|mp4|webm)$/i.test(path)) return false;
  return true;
}
