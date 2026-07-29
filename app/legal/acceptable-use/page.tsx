export const metadata = {
  title: "Acceptable Use Policy — Plexo",
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What raw HTML publishing is",
    body: [
      "Plexo lets you publish a self-contained HTML/CSS/JS site (uploaded as a single .html file or a .zip) exactly as you provide it — we do not sanitize, rewrite, or restrict the markup, styles, or scripts in what you upload, the same way Netlify Drop, GitHub Pages, or tiiny.host work.",
      "That means you are fully responsible for the content and behavior of anything you publish through this feature.",
    ],
  },
  {
    title: "Prohibited content",
    body: [
      "You may not use raw HTML publishing to host: phishing pages or credential-harvesting clones of another site or brand; malware, exploit kits, or drive-by download payloads; content that violates a third party's intellectual property; content that is illegal in the jurisdiction it targets; or anything designed to deceive visitors about who is publishing it or what it will do to their device or accounts.",
    ],
  },
  {
    title: "Enforcement",
    body: [
      "Published domains are periodically screened against Google Safe Browsing's threat lists. A domain that matches a known threat may be suspended — its content taken offline immediately — pending review, without prior notice, if the risk to visitors is judged to be immediate.",
      "We may also suspend a domain in response to a credible abuse report even absent an automated match.",
      "Repeated or severe violations may result in account suspension in addition to domain takedown.",
    ],
  },
  {
    title: "Appeals",
    body: [
      "If your domain is suspended and you believe it was in error, contact support with your domain name and account email and we will review it.",
    ],
  },
];

export default function AcceptableUsePage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem", color: "#f0f2ff", fontFamily: "inherit" }}>
      <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand, #8b5cf6)", marginBottom: "0.5rem" }}>
        Legal
      </p>
      <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.5rem" }}>
        Acceptable Use Policy — Raw HTML Publishing
      </h1>
      <p style={{ color: "rgba(240,242,255,0.5)", fontSize: "0.85rem", marginBottom: "2.5rem" }}>
        Applies specifically to sites published via file upload rather than the Plexo builder.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.title} style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.6rem" }}>{section.title}</h2>
          {section.body.map((p, i) => (
            <p key={i} style={{ color: "rgba(240,242,255,0.7)", fontSize: "0.9rem", lineHeight: 1.7, marginBottom: "0.75rem" }}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
