import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { createHash, randomBytes } from "node:crypto";
import { Shield, CheckCircle2, Bot, Sparkles, ArrowRight } from "lucide-react";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export default async function McpLoginPage(props: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const searchParams = await props.searchParams;
  const callbackUrl = searchParams.callbackUrl;

  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/mcp/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`)}`);
  }

  // Find or create an MCP API key for this user
  let apiKeyRecord = await prisma.apiKey.findFirst({
    where: {
      userId: session.user.id,
      name: "Plexo MCP AI Integration Key",
      isActive: true,
    },
  });

  let rawKey = "";
  if (!apiKeyRecord) {
    rawKey = `plexo_mcp_${randomBytes(24).toString("hex")}`;
    const hashedKey = sha256(rawKey);
    const maskedKey = `${rawKey.slice(0, 10)}...${rawKey.slice(-4)}`;

    apiKeyRecord = await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        name: "Plexo MCP AI Integration Key",
        hashedKey,
        maskedKey,
        useAi: true,
      },
    });
  } else {
    // Produce token representation
    rawKey = apiKeyRecord.maskedKey;
  }

  // If a local callbackUrl was passed by the MCP OAuth flow, redirect back automatically
  if (callbackUrl && (callbackUrl.startsWith("http://localhost:") || callbackUrl.startsWith("http://127.0.0.1:"))) {
    const redirectTarget = new URL(callbackUrl);
    redirectTarget.searchParams.set("token", rawKey);
    redirectTarget.searchParams.set("user", session.user.email);
    redirect(redirectTarget.toString());
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#111827]/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Plexo AI Integration
              <Sparkles className="w-4 h-4 text-pink-400" />
            </h1>
            <p className="text-xs text-slate-400">Model Context Protocol & Custom Actions</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">Successfully Authenticated</p>
            <p className="text-xs text-emerald-400/80 mt-0.5">
              Logged in as <span className="font-medium text-white">{session.user.email}</span>
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-slate-300 mb-8">
          <p className="leading-relaxed">
            Your AI assistant on Claude, ChatGPT, or Cursor is now authorized to create landing pages, view email templates, and read analytics on your Plexo account.
          </p>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-pink-300 break-all select-all">
            <span className="text-slate-500 block mb-1 font-sans text-[11px] font-medium">YOUR AUTHORIZATION TOKEN:</span>
            {rawKey}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href="/dashboard/integrations"
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white font-medium text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-pink-500/25"
          >
            Go to Integration Dashboard
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
