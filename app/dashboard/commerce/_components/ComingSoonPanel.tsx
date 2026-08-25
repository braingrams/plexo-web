export function ComingSoonPanel({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14,
      padding: "3rem 2rem",
      textAlign: "center",
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 12,
        background: "rgba(196,132,252,0.16)",
        display: "grid", placeItems: "center",
        margin: "0 auto 16px",
      }}>
        {icon}
      </div>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 6px" }}>{title}</h2>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}
