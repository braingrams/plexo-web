#!/usr/bin/env node
// Self-hosts the Monaco editor (the app editor's Code Mode) instead of loading it from a
// CDN at runtime: copies monaco-editor's prebuilt files into public/monaco/<version>/vs, served
// by the app itself (and from the assets bucket in deployed environments — CloudFront's
// "monaco/*" behavior, compute-stack.ts). The version in the path lets those files be cached
// forever: an upgrade changes the address. Runs before dev/build.
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "node_modules/monaco-editor/min/vs");
const version = JSON.parse(readFileSync(join(root, "node_modules/monaco-editor/package.json"), "utf8")).version;
const target = join(root, `public/monaco/${version}/vs`);
const stamp = join(root, `public/monaco/${version}/.version`);

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) process.exit(0);
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
writeFileSync(stamp, version);
console.log(`Copied monaco-editor ${version} to public/monaco/${version}/vs`);
