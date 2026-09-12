/**
 * A section container matching SOL's own visual language (translucent surface, soft
 * border, no heavy card chrome) — used on Settings/Memory instead of the main dashboard's
 * generic Card component, so those pages read as genuinely part of SOL rather than a
 * standard dashboard settings page that happens to sit inside SOL's sidebar.
 */
export function SolPanel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: "1.25rem 1.35rem",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.025)",
      }}
    >
      <h2 style={{ margin: "0 0 0.3rem", fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>{title}</h2>
      {description && <p style={{ margin: "0 0 1.15rem", fontSize: "0.79rem", color: "rgba(240,242,255,0.4)", lineHeight: 1.5 }}>{description}</p>}
      {!description && <div style={{ marginBottom: "1.1rem" }} />}
      {children}
    </section>
  );
}
