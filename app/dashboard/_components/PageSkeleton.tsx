"use client";

/** The standard loading state for any dashboard route segment — drop a `loading.tsx` next
 * to a page and render this; Next's App Router shows it automatically during the
 * server-side data fetch for that segment (e.g. switching sites, opening a page for the
 * first time), so nothing needs to be wired manually. Shape mirrors PageContainer's own
 * column so the skeleton doesn't visibly reflow into the real content once it lands. */
export function PageSkeleton({ withSidebar = false }: { withSidebar?: boolean }) {
  return (
    <div style={{ padding: "2rem 32px", maxWidth: 1920, width: "100%", margin: "0 auto" }}>
      <style>{`
        @keyframes plexo-skeleton-shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .plexo-skeleton-block {
          background: linear-gradient(90deg, rgba(255,255,255,0.045) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.045) 63%);
          background-size: 800px 100%;
          animation: plexo-skeleton-shimmer 1.4s ease-in-out infinite;
          border-radius: 8px;
        }
      `}</style>
      <div className="plexo-skeleton-block" style={{ width: 220, height: 28, marginBottom: 10 }} />
      <div className="plexo-skeleton-block" style={{ width: 340, height: 14, marginBottom: 28 }} />
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        {withSidebar && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: 190, flexShrink: 0 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="plexo-skeleton-block" style={{ height: 34 }} />
            ))}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="plexo-skeleton-block" style={{ height: 200 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
