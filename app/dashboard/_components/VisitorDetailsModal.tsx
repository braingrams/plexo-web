"use client";

import { useEffect, useState } from "react";

type VisitRow = {
  id: string;
  templateId: string;
  templateName: string | null;
  domain: string | null;
  createdAt: string;
  country: string | null;
  region: string | null;
  city: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
};

function formatLocation(v: VisitRow): string {
  const parts = [v.city, v.region, v.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

function deviceLabel(deviceType: string | null): string {
  if (!deviceType) return "Unknown";
  return deviceType[0].toUpperCase() + deviceType.slice(1);
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const LIMIT = 25;

/** Paginated drill-down into individual page views — backs "view visitor details" on the
 * overview analytics card. Only ever shows the coarse, already-derived fields (location down
 * to city, device/browser/os) — never a raw IP or full user-agent string. */
export function VisitorDetailsModal({
  open,
  onClose,
  templateId,
  filterType,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  filterType: "all" | "published";
}) {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) setOffset(0);
  }, [open, templateId, filterType]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const query = new URLSearchParams();
    if (templateId !== "all") query.set("templateId", templateId);
    else if (filterType === "published") query.set("filter", "published");
    query.set("limit", String(LIMIT));
    query.set("offset", String(offset));

    fetch(`/api/v1/analytics/visits?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setVisits(data.visits);
          setTotal(data.total);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading visit details:", err);
        setLoading(false);
      });
  }, [open, templateId, filterType, offset]);

  if (!open) return null;

  const page = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", zIndex: 10000 }}
      />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(760px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column",
          background: "rgba(22,20,44,0.97)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)", zIndex: 10001, overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <h3 style={{ fontSize: "1rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>Visitor Details</h3>
            <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.45)", margin: "0.2rem 0 0" }}>
              {total} visit{total === 1 ? "" : "s"} recorded
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.5)", padding: "0.25rem", lineHeight: 1, display: "grid", placeItems: "center" }}
          >
            <IconClose />
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: "3rem", display: "grid", placeItems: "center" }}>
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          ) : visits.length === 0 ? (
            <div style={{ padding: "3rem 1.5rem", textAlign: "center", color: "rgba(240,242,255,0.4)", fontSize: "0.85rem" }}>
              No visits recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "rgba(240,242,255,0.35)", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <th style={{ padding: "0.6rem 1.5rem" }}>Time</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Page</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Location</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Device</th>
                    <th style={{ padding: "0.6rem 1.5rem" }}>Browser</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.8)" }}>
                      <td style={{ padding: "0.65rem 1.5rem", whiteSpace: "nowrap", color: "rgba(240,242,255,0.55)" }}>
                        {new Date(v.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem" }}>{v.templateName || v.domain || "—"}</td>
                      <td style={{ padding: "0.65rem 0.75rem", whiteSpace: "nowrap" }}>{formatLocation(v)}</td>
                      <td style={{ padding: "0.65rem 0.75rem", whiteSpace: "nowrap" }}>
                        {deviceLabel(v.deviceType)}{v.os ? ` · ${v.os}` : ""}
                      </td>
                      <td style={{ padding: "0.65rem 1.5rem" }}>{v.browser || "Unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>Page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              style={{
                padding: "0.4rem 0.85rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 650,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: offset === 0 ? "rgba(240,242,255,0.25)" : "rgba(240,242,255,0.8)",
                cursor: offset === 0 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + LIMIT >= total}
              onClick={() => setOffset((o) => o + LIMIT)}
              style={{
                padding: "0.4rem 0.85rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 650,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: offset + LIMIT >= total ? "rgba(240,242,255,0.25)" : "rgba(240,242,255,0.8)",
                cursor: offset + LIMIT >= total ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
