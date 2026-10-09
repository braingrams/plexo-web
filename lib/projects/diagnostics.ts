// Turns raw tool output (Vite/Rolldown build errors, tsc diagnostics, npm failures) into
// structured { file, line, column, message } diagnostics an AI can act on and a person can
// click. Dependency-free: shared by the build Lambda and the app.
import type { BuildDiagnostic } from "./buildJob";

const ANSI = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");

/** Makes an absolute path inside the build's working directory project-relative. */
export function relativeTo(root: string, file: string | undefined): string | undefined {
  if (!file) return undefined;
  let f = file.replace(/\\/g, "/").replace(/\?.*$/, "");
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (f.startsWith(`${r}/`)) f = f.slice(r.length + 1);
  return f.replace(/^\/+/, "");
}

/** `src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.` */
export function parseTscOutput(output: string, root: string, maxErrors = 50): BuildDiagnostic[] {
  const out: BuildDiagnostic[] = [];
  const lines = stripAnsi(output).split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < maxErrors; i++) {
    const m = lines[i].match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/);
    if (!m) continue;
    let message = m[5];
    // tsc continues a long message on indented lines.
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) message += `\n${lines[++i].trim()}`;
    out.push({ kind: "type", file: relativeTo(root, m[1]), line: Number(m[2]), column: Number(m[3]), message: `${message} (${m[4]})` });
  }
  return out;
}

type RawLog = {
  message?: string;
  code?: string;
  id?: string;
  loc?: { file?: string; line?: number; column?: number };
  frame?: string;
  plugin?: string;
  errors?: RawLog[];
};

/** Vite 8 (Rolldown) throws an aggregate whose `errors` array holds one entry per problem
 * (older shapes: a single error with `loc`/`id`/`frame`). Each entry's message is
 * "[CODE] text" followed by a drawn code frame whose header names the file
 * ("╭─[ src/App.tsx:1:17 ]") — the only place a syntax error names its file at all. Rolldown's
 * `loc.column` is 0-based; the frame header's is 1-based. */
export function parseBuildError(err: unknown, root: string): BuildDiagnostic[] {
  const raw = (err ?? {}) as RawLog;
  const items = Array.isArray(raw.errors) && raw.errors.length ? raw.errors : [raw];
  const seen = new Set<string>();
  const out: BuildDiagnostic[] = [];
  for (const item of items) {
    const text = stripAnsi(item.message ?? String(err));
    const header = text.match(/[╭┌]─*\[\s*([^\]\s]+?):(\d+):(\d+)\s*\]/);
    const lines = text.split("\n");
    // The message proper is everything before the drawn frame.
    const frameStart = lines.findIndex((l) => /^\s*[╭┌│]/.test(l));
    let message = (frameStart === -1 ? lines : lines.slice(0, frameStart)).join("\n").trim();
    message = message
      .replace(/^Error:\s*/, "")
      .replace(/^\[(?:plugin\s+)?[\w:.-]+\]\s*/, "")
      .replace(/^\[vite\]:\s*/, "")
      .replace(new RegExp(`${escapeRegExp(root.replace(/\/+$/, ""))}/?`, "g"), "");
    message = message.split("\n").filter((l) => l.trim() && !/^\s*at\s/.test(l)).slice(0, 4).join("\n");

    const importer = message.match(/\bfrom\s+"([^"]+\.(?:tsx?|jsx?|mjs|css))"/)?.[1];
    const file = relativeTo(root, item.loc?.file ?? item.id) ?? header?.[1] ?? extractLoc(message)?.file ?? importer;
    const line = header ? Number(header[2]) : item.loc?.line ?? extractLoc(message)?.line;
    const column = header ? Number(header[3]) : item.loc?.column !== undefined ? item.loc.column + 1 : extractLoc(message)?.column;
    const snippet = line ? frameLine(text, line) ?? (item.frame ? frameLine(stripAnsi(item.frame), line) : undefined) : undefined;
    if (file && message.startsWith(`${file}:`)) message = message.slice(file.length + 1).trim();

    const diag: BuildDiagnostic = { kind: "build", file, line, column, message: humanizeBuildMessage(message), snippet };
    const key = `${diag.file}:${diag.line}:${diag.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(diag);
    }
  }
  return out;
}

/** The source text of line `n` from a drawn code frame ("  12 │ const x = <div>"). */
function frameLine(frame: string, n: number): string | undefined {
  for (const l of frame.split("\n")) {
    const m = l.match(/^\s*>?\s*(\d+)\s*[│|]\s?(.*)$/);
    if (m && Number(m[1]) === n) return m[2];
  }
  return undefined;
}

function extractLoc(message: string): { file?: string; line?: number; column?: number } | undefined {
  const m = message.match(/([\w./@-]+\.(?:tsx?|jsx?|css|mjs))[:(](\d+)[:,](\d+)/);
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Adds the "what to do about it" to the messages that confuse people (and models) most. */
export function humanizeBuildMessage(message: string): string {
  const unresolved = message.match(/(?:failed to resolve import|Could not resolve)\s+["']([^"']+)["']/i);
  if (unresolved) {
    const spec = unresolved[1];
    if (spec.startsWith(".") || spec.startsWith("@/")) {
      return `${message}\nThe file "${spec}" doesn't exist — check the path and file name (they're case-sensitive), or create the file.`;
    }
    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return `${message}\nThe package "${pkg}" isn't installed — add it to package.json "dependencies".`;
  }
  if (/is not exported by|does not provide an export named|"[^"]+" is not exported/i.test(message)) {
    return `${message}\nCheck the import name matches what the file exports (default vs named export).`;
  }
  return message;
}

/** npm's ERESOLVE / E404 / ETARGET become one clear line per bad dependency. */
export function parseNpmError(output: string): BuildDiagnostic[] {
  const text = stripAnsi(output);
  const out: BuildDiagnostic[] = [];
  const e404 = text.match(/404\s+Not Found[^\n]*?['"]?(@?[\w./-]+)@?[^\s'"]*['"]? is not in this registry|404\s+'(@?[\w./-]+)@[^']*' is not in this registry/i);
  if (e404) out.push({ kind: "install", file: "package.json", message: `The package "${e404[1] ?? e404[2]}" doesn't exist on npm. Check its name or remove it from package.json.` });
  const etarget = text.match(/No matching version found for (@?[\w./-]+)@(\S+?)\.?(?:\s|$)/i);
  if (etarget) out.push({ kind: "install", file: "package.json", message: `No version of "${etarget[1]}" matches "${etarget[2]}". Use a version that exists (or "latest").` });
  if (/ERESOLVE/.test(text)) {
    const conflict = text.match(/Could not resolve dependency:\s*\n\s*(?:peer\s+)?([^\n]+)/);
    out.push({ kind: "install", file: "package.json", message: `Two packages need incompatible versions of a shared dependency${conflict ? ` (${conflict[1].trim()})` : ""}. Change one of the versions in package.json.` });
  }
  if (!out.length) {
    const firstErr = text.split("\n").filter((l) => /npm (ERR!|error)/.test(l)).slice(0, 4).join("\n");
    out.push({ kind: "install", file: "package.json", message: `Installing packages failed.${firstErr ? `\n${firstErr}` : ""}` });
  }
  return out;
}
