"use client";

import { useRouter, usePathname } from "next/navigation";

type SiteOption = { id: string; name: string };

/** Lets a user with more than one site pick which one's Commerce catalog/orders/settings
 * they're looking at — swaps only the [templateId] path segment, preserving whatever
 * sub-page (Products, Orders, ...) they were already on. A single-site org just sees the
 * site's name, no dropdown needed. */
export function CommerceSiteSwitcher({ sites, currentTemplateId }: { sites: SiteOption[]; currentTemplateId: string }) {
  const router = useRouter();
  const pathname = usePathname();

  if (sites.length <= 1) {
    return (
      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.6)", padding: "0 0.15rem" }}>
        {sites[0]?.name ?? "Site"}
      </div>
    );
  }

  function handleChange(nextId: string) {
    if (nextId === currentTemplateId) return;
    const nextPath = pathname.replace(`/dashboard/commerce/${currentTemplateId}`, `/dashboard/commerce/${nextId}`);
    router.push(nextPath);
  }

  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "rgba(240,242,255,0.35)", marginBottom: "0.35rem",
      }}>
        Site
      </span>
      <select
        value={currentTemplateId}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 9,
          color: "#f0f2ff",
          padding: "0.55rem 2rem 0.55rem 0.7rem",
          fontSize: "0.82rem",
          fontWeight: 600,
          outline: "none",
          fontFamily: "inherit",
          cursor: "pointer",
          appearance: "none",
          WebkitAppearance: "none",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23a5adc9' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.7rem center",
          transition: "border-color 0.15s, background-color 0.15s",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.6)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
        onMouseEnter={(e) => { e.currentTarget.style.background = e.currentTarget.style.background.replace("0.06", "0.1"); e.currentTarget.style.borderColor = "rgba(255,255,255,0.28)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id} style={{ background: "#0d0f1a", color: "#f0f2ff" }}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
