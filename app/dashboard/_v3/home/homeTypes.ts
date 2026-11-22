import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { TaskProgress } from "@/lib/dashboardV3/tasks";
import type { SiteStats } from "@/lib/dashboardV3/homeData";
import type { HubFeatures } from "@/lib/dashboardV3/hubTabs";
import type { Experience } from "@/lib/dashboardV3/nav";

export type HomeBrand = { name?: string; color?: string; logoUrl?: string };

export type HomeSiteData = {
  site: SiteSummary;
  progress: TaskProgress;
  commerceEnabled: boolean;
  /** Present once every step is done (the live dashboard). */
  stats: SiteStats | null;
  /** What the "Add more to your site" area needs: the site's features and its pages today. Absent in previews or when they couldn't be read. */
  addMore?: { features: HubFeatures; pages: { name: string; path: string }[] };
};

export type HomeSiteRow = { site: SiteSummary; stats: SiteStats };

export type HomeProps = {
  firstName: string;
  experience: Experience;
  /** "none": no site yet. "site": one site (guided steps, then its dashboard). "all": every site together. */
  mode: "none" | "site" | "all";
  site: HomeSiteData | null;
  all: HomeSiteRow[];
  brand: HomeBrand;
  /** The free address ending, e.g. "plexopages.com". */
  baseDomain: string;
  /** How many sites they have (the "Show all my sites at once" button only appears with one or more). */
  siteCount?: number;
  /** Where "Create another website" goes. */
  newSiteHref: string;
  /** Set for people who already have sites and haven't tuned Plexo yet: where the "Fine-tune with SOL" card goes. */
  tuneHref?: string;
  /** Dev preview: do nothing to the server. */
  demo?: boolean;
};
