export function ComingSoonPanel({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)",
      border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)",
      borderRadius: 14,
      padding: "3rem 2rem",
      textAlign: "center",
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 12,
        background: "color-mix(in srgb, var(--cmx-brand, rgb(var(--brand-light-rgb))) 16%, transparent)",
        display: "grid", placeItems: "center",
        margin: "0 auto 16px",
      }}>
        {icon}
      </div>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--cmx-text, #f0f2ff)", margin: "0 0 6px" }}>{title}</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--cmx-muted, rgba(240,242,255,0.5))", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}
