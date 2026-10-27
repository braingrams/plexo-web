/** Verification: renders the stored (compiled) page of a template in Chrome. Usage: OUT=<dir> tsx screenshot-stored.ts <templateId> */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { Template } from "../../lib/db/contentEntities";
(async () => {
  const { data } = await Template.get({ id: process.argv[2] }).go();
  const out = process.env.OUT!;
  writeFileSync(out + "/stored-home.html", data!.compiledHtml as string);
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  for (const [n, w] of [["d", 1024], ["m", 390]] as const) {
    const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
    await p.goto("file://" + out + "/stored-home.html", { waitUntil: "networkidle" });
    await p.screenshot({ path: `${out}/stored-${n}.png`, fullPage: true });
  }
  await b.close();
})();
