import { CognitoJwtVerifier } from "aws-jwt-verify";

// Verifies Charisol/Cognito-issued ID tokens server-side before trusting any claim in
// them — checks signature against the shared products User Pool's JWKS *and* that the
// token was issued to Plexo's own client_id specifically, since the pool is shared across
// every Charisol product (see docs/verifying-tokens.md in the Charisol Auth repo).
//
// Built lazily (on first actual authorize() call below), not at module scope, deliberately:
// Next.js's build process imports route handler modules like app/api/auth/[...all]/route.ts
// to read their static exports, which executes this file's top-level code during `next
// build` itself — confirmed the hard way by this same migration's AUTH_SECRET, where
// NextAuth()'s own eager validation threw at build time until it was fetched into the CI
// build env specially (see deploy-staging.yml's comment on that step). CHARISOL_USER_POOL_ID
// is never set in the build environment (only at Lambda runtime, via lib/ssmEnv.ts's
// register()-time backfill) — constructing this eagerly would permanently bake in an empty
// userPoolId. Deferring construction to first real use guarantees it only ever runs inside
// a request, after that backfill has already populated process.env.
let charisolVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
export function getCharisolVerifier() {
  if (!charisolVerifier) {
    charisolVerifier = CognitoJwtVerifier.create({
      userPoolId: process.env.CHARISOL_USER_POOL_ID ?? "",
      tokenUse: "id",
      clientId: process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "",
    });
  }
  return charisolVerifier;
}
