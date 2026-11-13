/** Google Tag Manager container ID (GTM-…). GA4 and other tags are configured inside the container. */
export const GTM_CONTAINER_ID = "GTM-N5VXD9KB";

type DataLayerEvent = { event: string } & Record<string, unknown>;

/** Pushes an event to the GTM dataLayer. No-op on the server. */
export function trackEvent(payload: DataLayerEvent): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(payload);
}
