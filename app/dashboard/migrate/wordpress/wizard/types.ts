// Shapes the migration API returns, as the wizard uses them.

export type Outcome = "NATIVE" | "PRESERVED" | "NEEDS_ATTENTION" | "NOT_NEEDED";
export interface Plugin { slug: string; name: string; outcome: Outcome; explanation: string }

export interface Preview {
  siteName: string;
  siteDescription: string;
  origin: string;
  homeUrl: string;
  inSubdirectory: boolean;
  staticPages: string[];
  counts: { pages: number; posts: number; media: number; categories: number; tags: number };
  theme: { slug: string; parentSlug: string | null } | null;
  plugins: Plugin[];
}

export interface Counts {
  pages: number; pagesDone: number; pagesFailed: number;
  posts: number; postsDone: number; postsFailed: number;
  assets: number; assetsDone: number; assetsFailed: number; assetsSkipped: number;
  products?: number; productsDone?: number; productsSkipped?: number; productsFailed?: number;
}

export interface ChecklistItem { id: string; label: string; status: "done" | "blocked" | "review" | "todo"; detail: string }
export interface PageRow { key: string; kind: string; title: string; sourceUrl: string; newPath: string | null; status: string; error: string | null; seo: Record<string, boolean> | null }

export interface Report {
  source: { origin: string; homeUrl: string; siteName: string };
  summary: { pagesCopied: number; pagesFailed: number; postsCopied: number; postsFailed: number; filesCopied: number; filesFailed: number; filesAlreadyMissing: number; bytesCopied: number; formsReconnected: number; productsMoved?: number };
  seo: { pagesChecked: number; titles: number; descriptions: number; canonicals: number; structuredData: number; robots: number };
  pages: PageRow[];
  forms: { page: string; name: string; fields: string[] }[];
  brokenLinks: { from: string; href: string; reason: string }[];
  failedFiles: { path: string; reason: string }[];
  missingOnSource: { path: string; from: string | null }[];
  plugins: Plugin[];
  checklist: ChecklistItem[];
  readyForCutover: boolean;
}

export interface JobStatus {
  id: string;
  templateId: string;
  sourceUrl: string;
  phase: string;
  pausedIn?: string | null;
  lastHeartbeatAt?: string | null;
  counts: Counts | null;
  /** Server's estimate of the time left; null while the site's size is still being read. */
  estimatedSecondsLeft?: number | null;
  report: Report | null;
  errors: string[];
  install?: { siteName?: string; origin?: string };
}

export interface DomainRow { domain: string; type: "SUBDOMAIN" | "CUSTOM"; active: boolean; dnsVerified: boolean }

export interface ExistingMigration { id: string; templateId: string; siteName: string | null; phase: string }
