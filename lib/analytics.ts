import { PLAN, RETIRED_PLAN, PaidPlanId } from "@/lib/plan/plans";
/** Google Tag Manager container ID (GTM-…). GA4 and other tags are configured inside the container. */
export const GTM_CONTAINER_ID = "GTM-N5VXD9KB";
/** The only deployment that sends GTM and Clarity data. Staging and PR previews build with other URLs. */
export const PRODUCTION_APP_URL = "https://plexo.charisol.io";

/** A dataLayer push. Most have an event name; the ecommerce clear does not. */
type DataLayerEvent = Record<string, unknown>;

/** Pushes an event to the GTM dataLayer. No-op on the server. */
export function trackEvent(payload: DataLayerEvent): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(payload);
}

// The plan names the analytics spec uses: free, starter, pro, enterprise (the spec's plan list).
export function analyticsPlan(plan: string): string {
  return plan.toLowerCase();
}

let userIdentifiedThisLoad = false;
/** user_identified: once per page load, before any other Plexo event on that load. */
export function trackUserIdentifiedOnce(params: { user_id: string; plan_name: string; plan_status: string }): void {
  if (userIdentifiedThisLoad) return;
  userIdentifiedThisLoad = true;
  trackEvent({ event: "user_identified", ...params });
}

const PLAN_ITEMS = {
  STARTER: { name: "Starter", price: 9 },
  PRO: { name: "Pro", price: 19 },
  // Enterprise is a custom plan, so $99 is only the list-price starting point, not a fixed charge.
  ENTERPRISE: { name: "Enterprise", price: 99 },
} as const;

/** The ecommerce item for a subscription plan, with the spec's item IDs. Prices are the USD list prices. */
export function subscriptionItem(plan: PaidPlanId): { item_id: string; item_name: string; item_category: string; item_variant: string; price: number; quantity: number } {
  const item = PLAN_ITEMS[plan];
  return {
    item_id: `${plan.toLowerCase()}_monthly`,
    item_name: item.name,
    item_category: "subscription",
    item_variant: "monthly",
    price: item.price,
    quantity: 1,
  };
}

/** The template name for create_project: snake_case, as the spec's examples are. */
export function templateNameFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** purchase_type: an upgrade when the account already had a paid plan, otherwise a new subscription.
 * ULTRA is only accepted because it's a value stored before the plan rename (it reads as Pro). */
export function purchaseTypeFor(previousPlan: string | null | undefined): "new_subscription" | "upgrade" {
  return previousPlan === PLAN.STARTER || previousPlan === PLAN.PRO || previousPlan === PLAN.ENTERPRISE || previousPlan === RETIRED_PLAN.ULTRA ? "upgrade" : "new_subscription";
}

/** create_project, with is_first_project from the backend count. Omitted if the count can't be read. */
export async function trackProjectCreated(input: { projectId: string; projectType: "site" | "app"; creationMethod: string; templateName?: string }): Promise<void> {
  let isFirst: boolean | undefined;
  try {
    const res = await fetch("/api/analytics/project-count", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { count: number };
      if (data.count >= 1) isFirst = data.count === 1;
    }
  } catch {
    // leave is_first_project out rather than guess
  }
  trackEvent({
    event: "create_project",
    project_id: input.projectId,
    project_type: input.projectType,
    creation_method: input.creationMethod,
    ...(isFirst !== undefined ? { is_first_project: isFirst } : {}),
    ...(input.templateName ? { template_name: input.templateName } : {}),
  });
}

/** publish_project for an app. The backend confirms the build and works out the first-publish fields. */
export async function trackAppPublished(appId: string, buildId: string): Promise<void> {
  let milestone: { isFirst: boolean; minutesSinceSignup?: number } | null = null;
  try {
    const res = await fetch("/api/analytics/publish-success", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, buildId }),
    });
    if (res.ok) milestone = (await res.json()) as { isFirst: boolean; minutesSinceSignup?: number };
  } catch {
    // leave the first-publish fields out rather than guess
  }
  trackEvent({
    event: "publish_project",
    project_id: appId,
    project_type: "app",
    publish_target: "plexo_subdomain",
    ...(milestone ? { is_first_publish: milestone.isFirst } : {}),
    ...(milestone?.isFirst && milestone.minutesSinceSignup !== undefined ? { minutes_since_signup: milestone.minutesSinceSignup } : {}),
  });
}

/** purchase: once per transaction. Clears the ecommerce object first, as the spec requires. */
export function trackPurchaseOnce(transactionId: string, payload: DataLayerEvent): void {
  if (typeof window === "undefined") return;
  const flag = "purchase_" + transactionId;
  if (window.sessionStorage.getItem(flag)) return;
  window.sessionStorage.setItem(flag, "1");
  trackEvent({ ecommerce: null });
  trackEvent(payload);
}

/** Sends the event once per browser tab session for a key (a refresh must not send it again). */
export function trackOnce(key: string, payload: DataLayerEvent): void {
  if (typeof window === "undefined") return;
  const flag = "plexo_tracked_" + key;
  if (window.sessionStorage.getItem(flag)) return;
  window.sessionStorage.setItem(flag, "1");
  trackEvent(payload);
}
