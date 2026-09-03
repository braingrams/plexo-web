// Loading placeholder shown while the Charisol code exchange + Plexo session creation
// are in flight (see ../page.tsx) — shaped like the real dashboard shell (fixed left
// sidebar + main content, see app/dashboard/dashboard-shell-classic.tsx's own
// sidebarWidth/background constants) rather than a generic spinner, so the transition
// into the actual dashboard once sign-in completes feels continuous instead of jarring.
function Bar({ width, height = 10 }: { width: string | number; height?: number }) {
  return (
    <div
      className="animate-pulse rounded-md bg-white/10"
      style={{ width, height }}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0b0f19" }}>
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 250,
          background: "#08090f",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "1.25rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="animate-pulse rounded-lg" style={{ width: 28, height: 28, background: "linear-gradient(135deg, #8b5cf6, #6d28d9)" }} />
          <Bar width={70} height={14} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {[100, 85, 90, 70, 95, 75].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.6rem" }}>
              <div className="animate-pulse rounded" style={{ width: 16, height: 16, background: "rgba(255,255,255,0.08)" }} />
              <Bar width={`${w}px`} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="animate-pulse rounded-full" style={{ width: 32, height: 32, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <Bar width={90} height={9} />
            <Bar width={60} height={8} />
          </div>
        </div>
      </aside>

      <main style={{ marginLeft: 250, flex: 1, padding: "2rem 2.5rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Bar width={180} height={22} />
          <div className="animate-pulse rounded-lg" style={{ width: 120, height: 34, background: "rgba(139,92,246,0.25)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", padding: "1.1rem", height: 90 }}
            />
          ))}
        </div>

        <div
          className="animate-pulse"
          style={{ borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", flex: 1, minHeight: 280 }}
        />
      </main>
    </div>
  );
}
