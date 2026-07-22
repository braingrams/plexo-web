"use client";

/**
 * Dynamic loader for TemplateEditorClient.
 *
 * PlexoBuilder uses browser-only APIs (drag-and-drop, ResizeObserver,
 * window events). Using next/dynamic with ssr:false ensures it is never
 * rendered on the server and avoids hydration mismatches.
 */
import dynamic from "next/dynamic";
import type { TemplateJSON } from "@charisol/plexo-sdk";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";

export type TemplateEditorProps = {
  templateId: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  initialDesignJson: TemplateJSON;
  subscriptionPlan: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  aiApiKey: string | null;
};

function EditorSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0a0c15",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid rgba(139,92,246,0.2)",
          borderTopColor: "#8b5cf6",
          animation: "spin 0.7s linear infinite",
        }}
      />
      <p style={{ color: "rgba(240,242,255,0.4)", fontSize: "0.875rem" }}>
        Loading editor…
      </p>
    </div>
  );
}

const TemplateEditorClientDynamic = dynamic(
  () =>
    import("./template-editor-client").then((m) => ({
      default: m.TemplateEditorClient,
    })),
  {
    ssr: false,
    loading: EditorSkeleton,
  },
);

export function TemplateEditorDynamic(props: TemplateEditorProps) {
  return <TemplateEditorClientDynamic {...props} />;
}
