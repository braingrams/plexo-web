import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { OAuthClient } from "@/lib/db/coreEntities";
import { OAuthAuthorizationCode } from "@/lib/db/opsEntities";
import { rotateMcpApiKey } from "@/lib/mcp/issueApiKey";
import { CheckCircle2, Bot, Sparkles, ArrowRight, ShieldAlert } from "lucide-react";

function errorPage(message: string) {
  return (
    <div className="min-h-screen bg-[#08090f] text-[#f0f2ff] flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#111827]/90 border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-xl flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-400">Can't complete this request</p>
          <p className="text-xs text-white/70 mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
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
      return errorPage("Missing client_id for this sign-in request.");
    }
    const { data: client } = await OAuthClient.get({ clientId }).go();
    if (!client) {
      return errorPage("Unrecognized client. This integration may need to reconnect from scratch.");
    }
    if (!client.redirectUris.includes(callbackUrl)) {
      return errorPage("This app's redirect URL doesn't match what was registered. Reconnect the integration to try again.");
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

  return (
    <div className="min-h-screen bg-[#08090f] text-[#f0f2ff] flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#111827]/90 border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#8b5cf6]/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-[#34d399]/10 rounded-full blur-3xl" />

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#8b5cf6]/30">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Plexo AI Integration
              <Sparkles className="w-4 h-4 text-[#a78bfa]" />
            </h1>
            <p className="text-xs text-white/50">Model Context Protocol & Custom Actions</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#34d399]/10 border border-[#34d399]/20 mb-6 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#34d399] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#34d399]">Successfully Authenticated</p>
            <p className="text-xs text-[#34d399]/80 mt-0.5">
              Logged in as <span className="font-medium text-white">{session.user.email}</span>
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-white/70 mb-8">
          <p className="leading-relaxed">
            Your AI assistant on Claude, ChatGPT, or Cursor is now authorized to create landing pages, view email templates, and read analytics on your Plexo account.
          </p>

          <div className="p-4 rounded-xl bg-[#090d16] border border-white/10 text-xs font-mono text-[#a78bfa] break-all select-all">
            <span className="text-white/40 block mb-1 font-sans text-[11px] font-semibold">YOUR AUTHORIZATION TOKEN:</span>
            {rawKey}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href="/dashboard/integrations"
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:from-[#7c3aed] hover:to-[#6d28d9] text-white font-medium text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-[#8b5cf6]/25"
          >
            Go to Integration Dashboard
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
