/**
 * The longest a shared cache (CloudFront) or a browser may keep a server-rendered app's response.
 * An app can ask for a year (Next.js prerendered pages send s-maxage=31536000), which pins a page
 * at the edge after it changes. Clamping keeps a publish or a revalidation visible within a minute.
 */
export const SERVER_RESPONSE_MAX_AGE_SECONDS = 60;

const AGE_DIRECTIVE = /^(s-maxage|max-age)=(\d+)$/i;

/** Returns the Cache-Control value with any s-maxage or max-age above the cap lowered to the cap.
 * Other directives (public, private, no-store, stale-while-revalidate, immutable, …) are kept as sent. */
export function capCacheControl(value: string, maxSeconds: number = SERVER_RESPONSE_MAX_AGE_SECONDS): string {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const match = AGE_DIRECTIVE.exec(part);
      if (!match) return part;
      const seconds = Number(match[2]);
      return seconds > maxSeconds ? `${match[1].toLowerCase()}=${maxSeconds}` : part;
    })
    .join(", ");
}
