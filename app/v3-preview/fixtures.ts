import type { SiteSummary } from "@/lib/dashboardV3/sites";

const day = (n: number) => new Date(Date.UTC(2026, 10, 17) - n * 86_400_000).toISOString();

const NAMES = ["Home", "Haven Realty: premium", "Akinyemi Aqua Venture", "Software Engineering 101: an extremely long course name that never fits in a sidebar at all", "Muzingo | Online Music Bingo Game", "Home", "Haven Realty: premium", "Lagos Bakes", "Kitchen notes", "Ama's Kitchen"];

/** DEV ONLY: a real-looking account with many sites of every kind, including look-alike names and moved WordPress sites. */
export const MANY_SITES: SiteSummary[] = Array.from({ length: 30 }, (_, i): SiteSummary => {
  const kinds: SiteSummary["kind"][] = ["Website", "Online store", "Course", "App with sign-in", "Uploaded page", "Blog"];
  const name = i < NAMES.length ? NAMES[i] : i % 4 === 0 ? "Home" : `Client site ${i}`;
  return {
    id: `many-${String(i).padStart(4, "0")}`,
    name,
    kind: name.startsWith("Muzingo") ? "Uploaded page" : kinds[i % kinds.length],
    status: i % 3 === 0 ? "live" : "draft",
    address: i % 3 === 0 ? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "site"}${i}.plexopages.com` : null,
    updatedAt: day(i * 2),
    ...(name.startsWith("Muzingo") ? { movedFrom: "https://muzingo.com" } : {}),
  };
});

export const PREVIEW_WORKSPACES = [
  { id: "w1", name: "Ama's Workspace", role: "owner" },
  { id: "w2", name: "Haven Realty Team", role: "editor" },
  { id: "w3", name: "Charisol Studio", role: "admin" },
];
