"use client";

import { usePathname } from "next/navigation";
import { useSolSidebar } from "../../sol/_components/SolSidebarContext";
import { ThreadList } from "./ThreadList";
import "./sol.css";

/** The conversation id in the address (not SOL's own pages), or the one the chat just opened. */
export function useActiveConversationId(): string | null {
  const pathname = usePathname() ?? "";
  const { activeConversationIdOverride } = useSolSidebar();
  const match = pathname.match(/^\/(?:dashboard|v3-preview)\/sol\/(?!settings$|memory$)([^/]+)$/);
  return match ? match[1] : activeConversationIdOverride;
}

/** Your conversations, drawn in the left column (inside SOL) in place of the main menu. */
export function SolChatsColumn() {
  const { refreshSignal } = useSolSidebar();
  return <ThreadList activeConversationId={useActiveConversationId()} refreshSignal={refreshSignal} />;
}
