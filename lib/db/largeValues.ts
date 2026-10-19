import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// No row is ever too big. DynamoDB caps one item at 400 KB, but a page, an email, a design system, a long AI conversation or a
// site import can be larger than that. So the database client itself moves any big text value out to storage and puts a short
// marker in its place, and puts the real value back when the row is read. Nothing above this file knows: not the editor, not the
// compiler, not the API or MCP tools — they read and write whole values of any size.
//
//   write: a string longer than OFFLOAD_MIN_CHARS is gzipped into the user-content bucket under
//          private/db-values/<sha256 of the text>, and the row keeps  plx-value:v1:<sha256>:<characters>
//   read:  every such marker in what came back is replaced by the stored text, in parallel
//
// Content-addressing makes a stored value immutable and de-duplicates identical saves. Small values (everything ordinary) never
// touch storage, and rows written before this existed are read exactly as they were. If storage can't be written to, the value is
// left in the row (today's behaviour) rather than failing the save; if it can't be read, the read fails with a plain error rather
// than hand back a marker as if it were content.

/** Strings above this many characters leave the row. Low enough that a row with several big values stays far under 400 KB. */
export const OFFLOAD_MIN_CHARS = 40_000;
const MARKER = /^plx-value:v1:([a-f0-9]{64}):(\d+)$/;
export const markerFor = (hash: string, chars: number): string => `plx-value:v1:${hash}:${chars}`;
export const valueKey = (hash: string): string => `private/db-values/${hash}`;

export interface ValueBackend {
  put(hash: string, gz: Buffer): Promise<void>;
  get(hash: string): Promise<Buffer | null>;
}

const REGION = process.env.AWS_REGION || "us-east-1";
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: REGION, maxAttempts: 10, retryMode: "adaptive" }));
const bucket = (): string => {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new Error("USER_CONTENT_BUCKET_NAME is not configured.");
  return name;
};

const s3Backend: ValueBackend = {
  async put(hash, gz) {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: valueKey(hash), Body: gz, ContentType: "application/gzip" }));
  },
  async get(hash) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: valueKey(hash) }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  },
};

let backend: ValueBackend = s3Backend;
export const setValueBackend = (b: ValueBackend | null): void => {
  backend = b ?? s3Backend;
  cache.clear();
};

// Stored values are immutable, so a fetched one is reusable for as long as the process lives (bounded).
const cache = new Map<string, string>();
const CACHE_MAX_CHARS = 32 * 1024 * 1024;
let cacheChars = 0;
const remember = (hash: string, text: string) => {
  if (text.length > CACHE_MAX_CHARS / 2 || cache.has(hash)) return;
  cache.set(hash, text);
  cacheChars += text.length;
  while (cacheChars > CACHE_MAX_CHARS && cache.size) {
    const oldest = cache.keys().next().value as string;
    cacheChars -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
};

const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Replaces every string over the limit in a request, WITHOUT touching the caller's own objects (copy-on-write). */
async function offloadNode(node: unknown, stored: Map<string, Promise<boolean>>): Promise<unknown> {
  if (typeof node === "string") {
    if (node.length <= OFFLOAD_MIN_CHARS) return node;
    const hash = sha256(node);
    let ok = stored.get(hash);
    if (!ok) {
      ok = backend.put(hash, gzipSync(node)).then(() => true, (err) => {
        console.error("[largeValues] couldn't store a big value; keeping it in the row:", err instanceof Error ? err.message : err);
        return false;
      });
      stored.set(hash, ok);
    }
    return (await ok) ? markerFor(hash, node.length) : node;
  }
  if (Array.isArray(node)) {
    const next = await Promise.all(node.map((n) => offloadNode(n, stored)));
    return next.some((n, i) => n !== node[i]) ? next : node;
  }
  if (isPlain(node)) {
    const entries = await Promise.all(Object.entries(node).map(async ([k, v]) => [k, await offloadNode(v, stored)] as const));
    return entries.some(([k, v]) => v !== node[k]) ? Object.fromEntries(entries) : node;
  }
  return node;
}

/** The request with any big string moved out to storage. Fails open: a value that can't be stored stays in the row. */
export async function offloadLargeValues<T>(input: T): Promise<T> {
  return (await offloadNode(input, new Map())) as T;
}

/** Puts the real text back wherever a marker came back in a response (the response is ours, so it is changed in place). */
export async function rehydrateLargeValues<T>(output: T): Promise<T> {
  const found: Array<{ set: (text: string) => void; hash: string; chars: number }> = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        const m = typeof v === "string" && v.length < 100 ? MARKER.exec(v) : null;
        if (m) found.push({ set: (t) => void (node[i] = t), hash: m[1], chars: Number(m[2]) });
        else walk(v);
      });
    } else if (isPlain(node)) {
      for (const [k, v] of Object.entries(node)) {
        const m = typeof v === "string" && v.length < 100 ? MARKER.exec(v) : null;
        if (m) found.push({ set: (t) => void (node[k] = t), hash: m[1], chars: Number(m[2]) });
        else walk(v);
      }
    }
  };
  walk(output);
  if (!found.length) return output;
  const loaded = new Map<string, Promise<string>>();
  const load = (hash: string, chars: number): Promise<string> => {
    const hit = cache.get(hash);
    if (hit !== undefined) return Promise.resolve(hit);
    let p = loaded.get(hash);
    if (!p) {
      p = (async () => {
        let gz: Buffer | null;
        try {
          gz = await backend.get(hash);
        } catch {
          throw new Error("A large saved item couldn't be loaded right now. Please try again in a moment.");
        }
        if (!gz) throw new Error("A large saved item is missing from storage, so it can't be shown. Please contact support.");
        const text = gunzipSync(gz).toString("utf8");
        if (text.length !== chars) throw new Error("A large saved item didn't load correctly. Please try again.");
        remember(hash, text);
        return text;
      })();
      loaded.set(hash, p);
    }
    return p;
  };
  await Promise.all(found.map(async (f) => f.set(await load(f.hash, f.chars))));
  return output;
}

/**
 * Makes a DynamoDB document client (what ElectroDB and every raw call use) offload and rehydrate big values on every request.
 * Wrapping `send` covers every operation (put, get, query, update, batch, transactions) in one place.
 */
export function withLargeValues<C extends { send: (command: any, ...rest: any[]) => Promise<any> }>(doc: C): C {
  const original = doc.send.bind(doc);
  doc.send = (async (command: { input?: unknown }, ...rest: unknown[]) => {
    // A document command builds its low-level twin from its input when constructed, so a changed input needs a new command.
    let toSend: unknown = command;
    if (command && command.input !== undefined) {
      const input = await offloadLargeValues(command.input);
      if (input !== command.input) toSend = new (command.constructor as new (i: unknown) => unknown)(input);
    }
    return rehydrateLargeValues(await original(toSend, ...rest));
  }) as C["send"];
  return doc;
}
