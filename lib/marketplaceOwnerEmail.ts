/** Same well-known system account plexo-admin's marketplaceOwner.ts creates/uses for
 * admin-curated listings — plexo-web never creates it (only plexo-admin's curation tools
 * do), it only needs to recognize it to skip seller-crediting on admin-curated sales.
 * Its own dependency-free module so pure code (lib/plan/entitlement.ts) can use it. */
export const MARKETPLACE_OWNER_EMAIL = "templates@plexo.charisol.io";
