// Lambda adapters for frameworks that don't ship one. Each shim is generated as ESM source that
// esbuild bundles together with the framework's server build into a single `index.mjs`, so the
// per-customer function needs no node_modules folder (Lambda's unzipped size limit is 250MB).
// Handler: `index.handler`. Payload format: Lambda Function URL (payload v2).

/** Shared conversion between a Function URL event and the Fetch API's Request/Response. */
export const LAMBDA_ADAPTER = `
function toRequest(event, origin) {
  const http = event.requestContext?.http ?? {};
  const method = http.method ?? event.httpMethod ?? "GET";
  const path = event.rawPath ?? http.path ?? "/";
  const query = event.rawQueryString ? "?" + event.rawQueryString : "";
  const body = method === "GET" || method === "HEAD" || !event.body
    ? undefined
    : event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  return new Request(origin + path + query, { method, headers: event.headers ?? {}, body, redirect: "manual" });
}

async function toLambdaResponse(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const headers = {};
  for (const [key, value] of response.headers) {
    if (key !== "set-cookie") headers[key] = value;
  }
  return {
    statusCode: response.status,
    headers,
    cookies: response.headers.getSetCookie?.() ?? [],
    body: buffer.toString("base64"),
    isBase64Encoded: true,
  };
}
`;

/** Remix: the server build exports `build`; @remix-run/node turns requests into responses. */
export function remixShim(serverEntryImport: string): string {
  return `import * as build from ${JSON.stringify(serverEntryImport)};
import { createRequestHandler } from "@remix-run/node";
${LAMBDA_ADAPTER}
const handleRequest = createRequestHandler(build, process.env.NODE_ENV ?? "production");
const origin = "https://app.invalid";

export const handler = async (event) => {
  const response = await handleRequest(toRequest(event, origin));
  return toLambdaResponse(response);
};
`;
}

/** Astro (Node adapter, standalone mode): the function folder holds dist/server and its production
 * node_modules. Loading the entry starts Astro's HTTP server on a local port, and the handler
 * forwards each Function URL request to it. `entryRelative` is relative to this index.mjs. */
export function astroFunctionShim(entryRelative: string): string {
  return `process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.PORT ?? "8787";
const origin = "http://127.0.0.1:" + process.env.PORT;
await import(new URL(${JSON.stringify(entryRelative)}, import.meta.url).href);
${LAMBDA_ADAPTER}
let ready;
async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await fetch(origin + "/", { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("The Astro server did not start in time.");
}

export const handler = async (event) => {
  ready ??= waitForServer();
  await ready;
  const incoming = toRequest(event, origin);
  const url = new URL(incoming.url);
  const response = await fetch(new Request(origin + url.pathname + url.search, incoming));
  return toLambdaResponse(response);
};
`;
}

/** The secrets loader that runs before a customer's server code. It fetches the app's secrets from
 * Plexo (PLEXO_SECRETS_URL, with PLEXO_SERVICE_KEY) and sets them as environment variables, unless the
 * variable is already set (visible variables win). Failing to load fails the cold start, rather than
 * running the app without its secrets. Written next to the server code by the build. */
export const SECRETS_LOADER_SOURCE = `
let loaded = null;

export function loadSecrets() {
  loaded ??= fetchSecrets().catch((err) => {
    loaded = null; // try again on the next cold start, rather than remembering the failure
    throw err;
  });
  return loaded;
}

async function fetchSecrets() {
  const url = process.env.PLEXO_SECRETS_URL;
  const key = process.env.PLEXO_SERVICE_KEY;
  if (!url || !key) return; // not running on Plexo (a local run): nothing to load
  const res = await fetch(url, { headers: { "x-plexo-service-key": key } });
  if (!res.ok) throw new Error("Couldn't load this app's secrets (" + res.status + ").");
  const body = await res.json();
  for (const [name, value] of Object.entries(body?.data ?? {})) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
`;

/** The new entry point: load secrets, then load the server code it wraps (app.mjs). */
export const ENTRY_WRAPPER_SOURCE = `import { loadSecrets } from "./plexo-env.mjs";

await loadSecrets();
const app = await import("./app.mjs");
export const handler = app.handler;
`;
