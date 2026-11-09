// Environment-file names. A client env file (.env, .env.local, .env.production, .envrc, prod.env, ...)
// holds values the browser would expose, so it never leaves the customer's machine or reaches a build.
// Kept free of zip libraries, so the build worker can import it.

const ENV_FILE_NAME = /^\.env(\..*)?$|^\.envrc$|\.env$/i;

/** True for a path whose file name is an environment file. */
export function isEnvFilePath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return ENV_FILE_NAME.test(name);
}

/** Message shown when env files were dropped, so the customer knows where those values go. */
export function envFilesDroppedMessage(dropped: string[]): string {
  const names = dropped.slice(0, 5).join(", ") + (dropped.length > 5 ? ` and ${dropped.length - 5} more` : "");
  return `${dropped.length} environment file${dropped.length === 1 ? "" : "s"} (${names}) left out of the upload. Set those values in the Variables and Secrets tabs instead.`;
}
