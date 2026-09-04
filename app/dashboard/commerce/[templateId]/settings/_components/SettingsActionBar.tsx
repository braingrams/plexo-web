"use client";

type SettingsMessage = { kind: "success" | "error" | "warning"; text: string } | null;

/** Shared save bar for every Settings sub-page (General/Payments/Notifications) — sticky to
 * the bottom of the viewport so it's always in the same place regardless of how tall the
 * page above it is, instead of each page burying its own Save button (and message) at a
 * different scroll depth. */
export function SettingsActionBar({
  saving, message, onSave, saveLabel = "Save settings",
}: {
  saving: boolean;
  message: SettingsMessage;
  onSave: () => void;
  saveLabel?: string;
}) {
  const messageColor = message?.kind === "success" ? "#34d399" : message?.kind === "warning" ? "#fbbf24" : "#f87171";
  return (
    <div
      style={{
        position: "sticky", bottom: 0, zIndex: 5, marginTop: "1.75rem",
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1rem", flexWrap: "wrap",
        padding: "1rem 0", borderTop: "1px solid rgba(255,255,255,0.08)", background: "var(--bg)",
      }}
    >
      {message && (
        <p style={{ fontSize: "0.85rem", margin: 0, marginRight: "auto", color: messageColor }}>{message.text}</p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        style={{
          padding: "0.7rem 1.5rem", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
          fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700, whiteSpace: "nowrap",
        }}
      >
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
