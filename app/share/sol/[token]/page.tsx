import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleX, FileText, User as UserIcon } from "lucide-react";

import { MarkdownRenderer } from "@/app/dashboard/sol/_components/MarkdownRenderer";
import { SolIcon } from "@/app/dashboard/sol/_components/SolIcon";
import { loadSharedConversation, type SharedBlock, type SharedMessage } from "@/lib/sol/share";

// A shared SOL conversation (the chat header's Share → lib/sol/share.ts), read-only, for
// anyone with the link. Kept out of search results: it's shared with people, not published.

export const dynamic = "force-dynamic";

type Params = { token: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const shared = await loadSharedConversation((await params).token);
  return {
    title: shared ? `${shared.title} — shared from SOL` : "Shared conversation",
    robots: { index: false, follow: false },
  };
}

const page: React.CSSProperties = { minHeight: "100vh", background: "#07070c", color: "#f0f2ff", fontFamily: "var(--font-body), system-ui, sans-serif" };
const column: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "0 1.25rem" };

export default async function SharedSolConversation({ params }: { params: Promise<Params> }) {
  const shared = await loadSharedConversation((await params).token);

  if (!shared) {
    return (
      <main style={{ ...page, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={column}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>This conversation isn&apos;t shared anymore</h1>
          <p style={{ color: "rgba(240,242,255,0.6)", fontSize: "0.9rem" }}>The person who shared it has stopped sharing, or the link is incomplete.</p>
        </div>
      </main>
    );
  }

  const sharedOn = new Date(shared.upTo).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <main style={page}>
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "1rem 0", marginBottom: "2rem" }}>
        <div style={{ ...column, display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "linear-gradient(135deg,var(--brand),var(--brand-deeper))", color: "#fff" }}>
            <SolIcon size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "0.95rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shared.title}</h1>
            <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.5)" }}>Shared from SOL · as of {sharedOn}</p>
          </div>
        </div>
      </header>

      <div style={{ ...column, display: "flex", flexDirection: "column", gap: "1.6rem", paddingBottom: "3rem" }}>
        {shared.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "1.5rem 0" }}>
        <div style={{ ...column, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", fontSize: "0.8rem", color: "rgba(240,242,255,0.55)" }}>
          <span>SOL is Plexo&apos;s AI assistant for building and running your website.</span>
          <Link href="/" style={{ color: "#c4b5fd", fontWeight: 600, textDecoration: "none" }}>Try Plexo →</Link>
        </div>
      </footer>
    </main>
  );
}

function Message({ message }: { message: SharedMessage }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", gap: "0.75rem", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-start" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", color: "#fff", background: isUser ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,var(--brand),var(--brand-deeper))" }}>
        {isUser ? <UserIcon size={14} color="rgba(240,242,255,0.6)" /> : <SolIcon size={14} />}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0, maxWidth: isUser ? "min(640px, 82%)" : "100%", flex: isUser ? "0 1 auto" : "1 1 auto", alignItems: isUser ? "flex-end" : "flex-start" }}>
        {message.blocks.map((block, i) => (
          <Block key={i} block={block} isUser={isUser} />
        ))}
      </div>
    </div>
  );
}

function Block({ block, isUser }: { block: SharedBlock; isUser: boolean }) {
  if (block.kind === "text") {
    return isUser ? (
      <div style={{ background: "linear-gradient(135deg, rgba(var(--brand-rgb),0.18), rgba(109,40,217,0.14))", border: "1px solid rgba(var(--brand-rgb),0.25)", borderRadius: "16px 16px 4px 16px", padding: "0.65rem 0.95rem", fontSize: "0.9rem", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {block.text}
      </div>
    ) : (
      <div style={{ width: "100%" }}>
        <MarkdownRenderer text={block.text} />
      </div>
    );
  }
  if (block.kind === "image") {
    return (
      <figure style={{ display: "flex", flexDirection: "column", gap: "0.35rem", maxWidth: 240, padding: "0.5rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", margin: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={block.url} alt={block.description ?? block.name} style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, display: "block" }} />
        {block.description && <figcaption style={{ fontSize: "0.75rem", lineHeight: 1.4, color: "rgba(240,242,255,0.75)" }}>{block.description}</figcaption>}
        <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{block.name}</span>
      </figure>
    );
  }
  if (block.kind === "file") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.7)", padding: "0.45rem 0.7rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }}>
        <FileText size={13} /> {block.name}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.55)" }}>
      {block.failed ? <CircleX size={12} color="#f87171" /> : <CheckCircle2 size={12} color="#34d399" />}
      {block.label}
    </span>
  );
}
