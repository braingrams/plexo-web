/**
 * Internal header the middleware sets when it rewrites a customer's published site to /pub.
 * The root layout reads it to keep Plexo's own tags (GTM, Clarity) off customer sites.
 * Visitors can't use it to change anything else: it only switches tags off on that request.
 */
export const TENANT_HEADER = "x-plexo-tenant";
