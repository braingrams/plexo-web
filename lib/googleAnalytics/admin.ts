import { GoogleApiError } from "./dataClient";

const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

/** The measurement ID, property and stream the site's tag needs. */
export type Provisioned = { accountName: string; propertyName: string; propertyDisplayName: string; streamName: string; measurementId: string };

export type PropertyChoice = { accountName: string; accountDisplayName: string; propertyName: string; propertyDisplayName: string };

export interface AnalyticsAdminClient {
  /** Every property the signed-in person can use, for the "pick one" step. */
  listProperties(): Promise<PropertyChoice[]>;
  /** Accounts the person can add a new property to. */
  listAccounts(): Promise<{ accountName: string; displayName: string }[]>;
  /** The data stream for this site's address in a property, creating it when it does not exist yet. */
  ensureStream(propertyName: string, siteUrl: string, displayName: string): Promise<{ streamName: string; measurementId: string }>;
  /** A brand-new property plus stream, for owners who have never used Google Analytics. */
  createPropertyWithStream(accountName: string, siteUrl: string, siteName: string): Promise<Provisioned>;
}

type Json = Record<string, unknown>;

export class GoogleAnalyticsAdminClient implements AnalyticsAdminClient {
  constructor(private readonly accessToken: string) {}

  private async call<T>(path: string, init?: { method: "POST"; body: Json }): Promise<T> {
    const res = await fetch(`${ADMIN_API}/${path}`, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      // Google's own short reason ("quota exceeded", "account full") helps tell a full account from a real failure. It never holds a token.
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
      throw new GoogleApiError(res.status, `Google Analytics answered ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  async listProperties(): Promise<PropertyChoice[]> {
    const data = await this.call<{ accountSummaries?: { account: string; displayName?: string; propertySummaries?: { property: string; displayName?: string }[] }[] }>("accountSummaries?pageSize=200");
    return (data.accountSummaries ?? []).flatMap((a) =>
      (a.propertySummaries ?? []).map((p) => ({ accountName: a.account, accountDisplayName: a.displayName ?? "Your account", propertyName: p.property, propertyDisplayName: p.displayName ?? "Your property" })),
    );
  }

  /** Accounts the person can add a property to (they may have none with properties yet). */
  async listAccounts(): Promise<{ accountName: string; displayName: string }[]> {
    const data = await this.call<{ accountSummaries?: { account: string; displayName?: string }[] }>("accountSummaries?pageSize=200");
    return (data.accountSummaries ?? []).map((a) => ({ accountName: a.account, displayName: a.displayName ?? "Your account" }));
  }

  async ensureStream(propertyName: string, siteUrl: string, displayName: string): Promise<{ streamName: string; measurementId: string }> {
    type Stream = { name: string; type?: string; webStreamData?: { measurementId?: string; defaultUri?: string } };
    const host = hostOf(siteUrl);
    const existing = await this.call<{ dataStreams?: Stream[] }>(`${propertyName}/dataStreams?pageSize=200`);
    const web = (existing.dataStreams ?? []).filter((s) => s.type === "WEB_DATA_STREAM" && s.webStreamData?.measurementId);
    const match = web.find((s) => hostOf(s.webStreamData?.defaultUri ?? "") === host) ?? (web.length === 1 && !host ? web[0] : undefined);
    if (match) return { streamName: match.name, measurementId: match.webStreamData!.measurementId! };
    const created = await this.call<Stream>(`${propertyName}/dataStreams`, { method: "POST", body: { type: "WEB_DATA_STREAM", displayName: displayName.slice(0, 80), webStreamData: { defaultUri: siteUrl } } });
    const id = created.webStreamData?.measurementId;
    if (!id) throw new GoogleApiError(502, "Google did not return a measurement ID");
    return { streamName: created.name, measurementId: id };
  }

  async createPropertyWithStream(accountName: string, siteUrl: string, siteName: string): Promise<Provisioned> {
    const property = await this.call<{ name: string; displayName?: string }>("properties", {
      method: "POST",
      body: { parent: accountName, displayName: siteName.slice(0, 100) || hostOf(siteUrl), timeZone: "Africa/Lagos", currencyCode: "USD" },
    });
    const stream = await this.ensureStream(property.name, siteUrl, siteName || hostOf(siteUrl));
    return { accountName, propertyName: property.name, propertyDisplayName: property.displayName ?? siteName, ...stream };
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Sample accounts for dev and previews. */
export class MockAnalyticsAdminClient implements AnalyticsAdminClient {
  async listProperties(): Promise<PropertyChoice[]> {
    return [];
  }
  async listAccounts(): Promise<{ accountName: string; displayName: string }[]> {
    return [{ accountName: "accounts/1", displayName: "Sample account" }];
  }
  async ensureStream(propertyName: string): Promise<{ streamName: string; measurementId: string }> {
    return { streamName: `${propertyName}/dataStreams/1`, measurementId: "G-MOCK000000" };
  }
  async createPropertyWithStream(accountName: string, siteUrl: string, siteName: string): Promise<Provisioned> {
    return { accountName, propertyName: "properties/1", propertyDisplayName: siteName || hostOf(siteUrl), streamName: "properties/1/dataStreams/1", measurementId: "G-MOCK000000" };
  }
}
