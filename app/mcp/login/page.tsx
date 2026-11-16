import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { OAuthClient } from "@/lib/db/coreEntities";
import { OAuthAuthorizationCode } from "@/lib/db/opsEntities";
import { rotateMcpApiKey } from "@/lib/mcp/issueApiKey";
import { ConnectErrorView, ConnectKeyView } from "./views";

function errorPage(message: string) {
  return <ConnectErrorView message={message} />;
}

export default async function McpLoginPage(props: {
  searchParams: Promise<{
    callbackUrl?: string;
    state?: string;
    client_id?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const callbackUrl = searchParams.callbackUrl;
  const state = searchParams.state;
  const clientId = searchParams.client_id;
  const codeChallenge = searchParams.code_challenge;
  const codeChallengeMethod = searchParams.code_challenge_method;

  let session = null;

  try {
    session = await auth();
  } catch (err) {
    console.warn("[mcp/login] Session retrieval failed:", err);
  }

  // Handle unauthenticated state outside try/catch so Next.js redirect works
  if (!session?.user) {
    const resumeParams = new URLSearchParams();
    if (callbackUrl) resumeParams.set("callbackUrl", callbackUrl);
    if (state) resumeParams.set("state", state);
    if (clientId) resumeParams.set("client_id", clientId);
    if (codeChallenge) resumeParams.set("code_challenge", codeChallenge);
    if (codeChallengeMethod) resumeParams.set("code_challenge_method", codeChallengeMethod);
    const resumeQuery = resumeParams.toString();
    const loginTarget = `/auth/login?redirectTo=${encodeURIComponent(`/mcp/login${resumeQuery ? `?${resumeQuery}` : ""}`)}`;
    redirect(loginTarget);
  }

  // Resolve the org this MCP key should belong to, same as server/orgDynamo.ts's
  // ensureActiveOrganization: whichever org is active on the session, falling back to
  // this user's first membership.
  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }
  const organizationId = orgResolution.organizationId;

  // Real OAuth redirect flow (came via /api/v1/auth/oauth/authorize, or a direct link
  // carrying the same params). This page is itself a public URL, so it re-validates
  // client_id/redirect_uri here rather than trusting that /authorize already did —
  // otherwise anyone could hit /mcp/login directly with an arbitrary callbackUrl and get
  // it treated as trusted. Every previous version of this flow skipped that check
  // entirely (a real open-redirect: a crafted link could redirect a logged-in user's real
  // API key to an attacker's domain), so this validates client_id against a registered
  // OAuthClient and requires an EXACT redirect_uri match against what that client
  // registered — no prefix/substring matching, which is how open redirects usually creep
  // back in.
  if (callbackUrl) {
    if (!clientId) {
      return errorPage("This link is incomplete. Go back to your AI tool and start the connection again.");
    }
    const { data: client } = await OAuthClient.get({ clientId }).go();
    if (!client) {
      return errorPage("We don’t recognise this app. Remove it from your AI tool and add it again.");
    }
    if (!client.redirectUris.includes(callbackUrl)) {
      return errorPage("This connection link doesn’t look right. Remove the app from your AI tool and add it again.");
    }

    // Mint a short-lived, single-use, PKCE-bound authorization code — NOT a real
    // credential. The previous version handed back a real, long-lived API key directly
    // as "code" (and "token"), which meant a real secret sat in a browser redirect URL
    // (and, if any hop along the way — proxy, load balancer, browser history —  ever
    // gets logged, so would the credential). The external client now has to exchange
    // this code at /api/v1/auth/oauth/token to actually get a usable key.
    const code = `plexo_oac_${randomBytes(24).toString("hex")}`;
    await OAuthAuthorizationCode.create({
      code,
      clientId,
      redirectUri: callbackUrl,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod === "plain" ? "plain" : codeChallenge ? "S256" : undefined,
      userId: session.user.id,
      organizationId,
    }).go();

    const redirectTarget = new URL(callbackUrl);
    redirectTarget.searchParams.set("code", code);
    if (state) {
      redirectTarget.searchParams.set("state", state);
    }
    redirect(redirectTarget.toString());
  }

  // No callbackUrl — direct interactive use (a user visiting /mcp/login themselves to
  // grab a raw key for manual setup, not via an external OAuth client redirect). This is
  // the user directly authenticating in their own browser, so handing back a real,
  // immediately-usable credential here is fine — nothing is being redirected anywhere.
  const rawKey = await rotateMcpApiKey(session.user.id, organizationId);

  return <ConnectKeyView email={session.user.email} rawKey={rawKey} />;
}
