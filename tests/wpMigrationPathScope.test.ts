import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const indexes: Record<string, unknown> = {};

vi.mock("@/lib/wpMigration/http", () => ({
  fetchJson: vi.fn(async (url: string) => {
    calls.push(url);
    return indexes[url] ? { data: indexes[url], headers: new Headers() } : null;
  }),
  migrationFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return new Response("", { status: 404 });
  }),
}));

import { discoverWordPressInstall } from "@/lib/wpMigration/discover";

const serenity = { name: "Serenity Pas Therapy", home: "https://playmuzingo.com/serenity", url: "https://playmuzingo.com/serenity", namespaces: ["wp/v2"] };
const muzingo = { name: "Muzingo", home: "https://playmuzingo.com", url: "https://playmuzingo.com", namespaces: ["wp/v2"] };

describe("migrating only one folder of a domain", () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(indexes)) delete indexes[k];
    indexes["https://playmuzingo.com/serenity/wp-json/"] = serenity;
    indexes["https://playmuzingo.com/wp-json/"] = muzingo; // another WordPress at the root
  });

  it("picks the install at the folder, not the one at the domain root", async () => {
    const install = await discoverWordPressInstall("playmuzingo.com/serenity");
    expect(install.homeUrl).toBe("https://playmuzingo.com/serenity");
    expect(install.restRoot).toBe("https://playmuzingo.com/serenity/wp-json/");
    expect(install.scopedToPath).toBe("/serenity");
    expect(install.siteName).toBe("Serenity Pas Therapy");
  });

  it("never looks at the domain root, so no pages outside the folder come along", async () => {
    const install = await discoverWordPressInstall("https://playmuzingo.com/serenity/");
    expect(install.staticPages).toEqual([]);
    expect(calls.every((u) => u.startsWith("https://playmuzingo.com/serenity/"))).toBe(true);
  });

  it("a link to a page inside the folder still finds the folder's install", async () => {
    const install = await discoverWordPressInstall("https://playmuzingo.com/serenity/about");
    expect(install.scopedToPath).toBe("/serenity");
  });

  it("a root install given a deep link keeps the old behaviour (not treated as a folder)", async () => {
    delete indexes["https://playmuzingo.com/serenity/wp-json/"];
    const install = await discoverWordPressInstall("https://playmuzingo.com/about-us");
    expect(install.scopedToPath).toBeUndefined();
    expect(install.homeUrl).toBe("https://playmuzingo.com");
  });
});
