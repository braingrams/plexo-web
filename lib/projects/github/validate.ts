// Pure checks for values that come from the browser before they reach GitHub or a redirect.
// Kept free of database and network imports so they can be tested on their own.

const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const GIT_REF = /^[\w./-]{1,200}$/;

/** "owner/name" as GitHub allows it. "." and ".." are rejected so the value can't walk the URL. */
export function isValidRepoFullName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  return parts.every((p) => REPO_PART.test(p) && p !== "." && p !== "..");
}

/** A branch, tag, or commit name. No "..", no leading or trailing slash. */
export function isValidGitRef(value: unknown): value is string {
  return typeof value === "string" && GIT_REF.test(value) && !value.includes("..") && !value.startsWith("/") && !value.endsWith("/");
}

/** Where to send someone after a GitHub install: an in-app path under /dashboard/ only, never an
 * absolute or protocol-relative URL (that would be an open redirect). */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300) return false;
  if (!value.startsWith("/dashboard/")) return false;
  if (value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return false;
  return true;
}
