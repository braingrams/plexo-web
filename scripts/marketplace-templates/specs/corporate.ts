import type { CategoryBatch } from "../types";

export const corporateBatch: CategoryBatch = {
  category: "Corporate & Professional Services",
  specs: [
    // ---------------------------------------------------------------------
    // 1. LANDING_PAGE / quick — Law firm
    // ---------------------------------------------------------------------
    {
      name: "Ashcombe & Reid — Law Firm Landing Page",
      kind: "LANDING_PAGE",
      tier: "quick",
      description: "A confident, no-nonsense landing page for a litigation or general-practice law firm, with a services grid and a clear consultation CTA.",
      pageStyle: { backgroundColor: "#f8fafc", color: "#0f172a", htmlTitle: "Ashcombe & Reid Law" },
      sections: [
        {
          type: "hero",
          eyebrow: "ASHCOMBE & REID LLP",
          heading: "Trusted Counsel for Life's Most Consequential Moments",
          subheading: "Forty years of litigation and advisory experience, brought to bear on your case from day one.",
          primaryCta: { text: "Schedule a Consultation", href: "#consult" },
          secondaryCta: { text: "Our Practice Areas", href: "#services" },
          textColor: "#0f172a",
          mutedColor: "#475569",
          accentColor: "#1e3a5f",
        },
        {
          type: "grid",
          heading: "Practice Areas",
          subheading: "Focused expertise across the matters that matter most.",
          columns: 3,
          items: [
            { iconName: "Scale", title: "Civil Litigation", text: "Aggressive, precise representation from filing through trial or settlement." },
            { iconName: "Briefcase", title: "Business & Contract Law", text: "Formation, negotiation, and dispute resolution for companies of every size." },
            { iconName: "Home", title: "Estate & Trust Planning", text: "Wills, trusts, and succession plans that protect what you've built." },
          ],
          accentColor: "#1e3a5f",
          textColor: "#0f172a",
          mutedColor: "#475569",
        },
        {
          type: "cta",
          heading: "Your First Consultation Is Free",
          subheading: "Speak with an attorney within 48 hours — no obligation, no pressure.",
          cta: { text: "Book Your Free Consultation", href: "#consult" },
          bg: "#1e3a5f",
        },
        {
          type: "footer",
          brand: "Ashcombe & Reid LLP",
          menu: [{ label: "Practice Areas" }, { label: "Attorneys" }, { label: "Contact" }],
          links: [{ provider: "linkedin" }],
          copyright: "© Ashcombe & Reid LLP. Attorney advertising. Prior results do not guarantee a similar outcome.",
          bg: "#0f172a",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 2. LANDING_PAGE / quick — B2B design/marketing agency
    // ---------------------------------------------------------------------
    {
      name: "Northbound Studio — B2B Agency Landing Page",
      kind: "LANDING_PAGE",
      tier: "quick",
      description: "A bold, energetic landing page for a B2B branding or marketing agency, pairing a punchy hero with a services grid and a booked-out-feeling CTA.",
      pageStyle: { backgroundColor: "#ffffff", color: "#18181b", htmlTitle: "Northbound Studio" },
      sections: [
        {
          type: "hero",
          eyebrow: "B2B BRAND & GROWTH STUDIO",
          heading: "Brands That Move Markets, Built By Northbound",
          subheading: "We partner with ambitious B2B companies to build brand systems and demand engines that actually convert pipeline.",
          primaryCta: { text: "See Our Work", href: "#work" },
          imageSeed: "northbound-studio-hero",
          imageAlt: "Northbound Studio team reviewing brand work on a whiteboard",
          textColor: "#18181b",
          mutedColor: "#52525b",
          accentColor: "#b45309",
        },
        {
          type: "grid",
          heading: "What We Do",
          columns: 3,
          items: [
            { iconName: "Sparkles", title: "Brand Strategy & Identity", text: "Positioning, naming, and visual systems built to hold up under scale." },
            { iconName: "TrendingUp", title: "Demand Generation", text: "Full-funnel campaigns engineered for pipeline, not just impressions." },
            { iconName: "Globe", title: "Web & Product Design", text: "Sites and product experiences that turn visitors into qualified leads." },
          ],
          accentColor: "#b45309",
          textColor: "#18181b",
          mutedColor: "#52525b",
        },
        {
          type: "cta",
          heading: "We're Taking On 3 New Partners This Quarter",
          subheading: "Tell us about your growth goals — we'll tell you if we're a fit.",
          cta: { text: "Start the Conversation", href: "#contact" },
          bg: "#b45309",
          textColor: "#fffbeb",
        },
        {
          type: "footer",
          brand: "Northbound Studio",
          menu: [{ label: "Work" }, { label: "Services" }, { label: "Careers" }],
          links: [{ provider: "linkedin" }, { provider: "instagram" }],
          copyright: "© Northbound Studio. All rights reserved.",
          bg: "#18181b",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 3. LANDING_PAGE / premium — Management/strategy consulting
    // ---------------------------------------------------------------------
    {
      name: "Meridian Strategy Partners — Full Consulting Practice Page",
      kind: "LANDING_PAGE",
      tier: "premium",
      description: "A comprehensive management-consulting landing page with navigation, credibility stats, service packages, a tier comparison table, and testimonials — built to close enterprise engagements.",
      pageStyle: { backgroundColor: "#f1f5f9", color: "#0f1a2e", htmlTitle: "Meridian Strategy Partners" },
      sections: [
        {
          type: "menubar",
          brand: "Meridian Strategy Partners",
          links: [{ label: "Services" }, { label: "Case Studies" }, { label: "About" }, { label: "Careers" }],
          cta: { text: "Talk to Us", href: "#contact" },
          bg: "#0f1a2e",
          textColor: "#f1f5f9",
          accentColor: "#c9a227",
        },
        {
          type: "hero",
          eyebrow: "MANAGEMENT & STRATEGY CONSULTING",
          heading: "Clarity for the Decisions That Define Your Next Decade",
          subheading: "We help boards and executive teams navigate growth, transformation, and market disruption with rigorous analysis and honest counsel.",
          primaryCta: { text: "Request a Strategy Session", href: "#contact" },
          secondaryCta: { text: "View Our Approach", href: "#approach" },
          imageSeed: "meridian-partners-hero",
          imageAlt: "Meridian consultants presenting a strategy framework to executives",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
          accentColor: "#c9a227",
        },
        {
          type: "stats",
          items: [
            { value: "23", label: "Years advising Fortune 500 leadership" },
            { value: "310+", label: "Engagements delivered" },
            { value: "$4.2B", label: "In client value created" },
            { value: "94%", label: "Client retention rate" },
          ],
          bg: "#0f1a2e",
          textColor: "#f1f5f9",
          accentColor: "#c9a227",
          mutedColor: "#94a3b8",
        },
        {
          type: "grid",
          heading: "Where We Add the Most Value",
          columns: 3,
          items: [
            { iconName: "Target", title: "Corporate Strategy", text: "Growth roadmaps, market entry, and portfolio decisions grounded in data." },
            { iconName: "TrendingUp", title: "Operating Model Design", text: "Restructuring for speed, accountability, and cost discipline." },
            { iconName: "Briefcase", title: "M&A Advisory", text: "Due diligence and integration planning that protects deal value." },
          ],
          accentColor: "#c9a227",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
        },
        {
          type: "pricing",
          heading: "Engagement Models",
          subheading: "Structured to match the scope and urgency of your mandate.",
          tiers: [
            {
              name: "Advisory Sprint",
              price: "$18,000",
              period: "2-week engagement",
              features: ["Focused diagnostic on one strategic question", "Executive workshop", "Findings memo & recommendation"],
              cta: { text: "Start a Sprint", href: "#contact" },
            },
            {
              name: "Strategic Engagement",
              price: "$65,000",
              period: "per quarter",
              features: ["Dedicated consulting team", "Full market & competitive analysis", "Board-ready strategy roadmap", "Bi-weekly executive check-ins"],
              cta: { text: "Request Proposal", href: "#contact" },
              highlighted: true,
            },
            {
              name: "Transformation Retainer",
              price: "Custom",
              period: "annual",
              features: ["Ongoing embedded advisory team", "Operating model implementation support", "Quarterly board presentations", "Priority access to senior partners"],
              cta: { text: "Talk to a Partner", href: "#contact" },
            },
          ],
          accentColor: "#c9a227",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
        },
        {
          type: "table",
          heading: "Compare Engagement Tiers",
          headers: ["", "Advisory Sprint", "Strategic Engagement", "Transformation Retainer"],
          rows: [
            ["Duration", "2 weeks", "Per quarter", "12 months"],
            ["Senior partner involvement", "Consult only", "Weekly", "Embedded"],
            ["Deliverable", "Findings memo", "Strategy roadmap", "Full implementation plan"],
            ["Board presentation", "—", "Included", "Quarterly"],
          ],
          textColor: "#0f1a2e",
        },
        {
          type: "testimonials",
          heading: "What Executive Teams Say",
          items: [
            { quote: "Meridian gave our board the clarity to make a call we'd been avoiding for two years. Worth every dollar.", name: "Renata Souza", role: "CEO, Halden Industrial" },
            { quote: "Their diligence work on our acquisition surfaced risks our internal team missed entirely.", name: "Owen Fairweather", role: "CFO, Brightline Logistics" },
          ],
          cardBg: "#ffffff",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
        },
        {
          type: "footer",
          brand: "Meridian Strategy Partners",
          menu: [{ label: "Services" }, { label: "Case Studies" }, { label: "Careers" }, { label: "Contact" }],
          links: [{ provider: "linkedin" }],
          copyright: "© Meridian Strategy Partners. All rights reserved.",
          bg: "#0f1a2e",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 4. LANDING_PAGE / premium — Accounting & financial advisory
    // ---------------------------------------------------------------------
    {
      name: "Castellane Financial Advisory — Premium Practice Page",
      kind: "LANDING_PAGE",
      tier: "premium",
      description: "A trust-forward landing page for an accounting and financial advisory firm, combining credentials, service packages, a fee comparison table, and client testimonials.",
      pageStyle: { backgroundColor: "#ffffff", color: "#0b2545", htmlTitle: "Castellane Financial Advisory" },
      sections: [
        {
          type: "menubar",
          brand: "Castellane Financial",
          links: [{ label: "Services" }, { label: "Who We Serve" }, { label: "Insights" }, { label: "Contact" }],
          cta: { text: "Book a Consultation", href: "#contact" },
          bg: "#ffffff",
          textColor: "#0b2545",
          accentColor: "#0e7c61",
        },
        {
          type: "hero",
          eyebrow: "CERTIFIED PUBLIC ACCOUNTANTS & ADVISORS",
          heading: "Financial Clarity for Growing Businesses and Their Owners",
          subheading: "Tax, audit, and CFO-level advisory from a firm that treats your balance sheet like its own.",
          primaryCta: { text: "Book a Free Consultation", href: "#contact" },
          secondaryCta: { text: "Our Services", href: "#services" },
          textColor: "#0b2545",
          mutedColor: "#4b5c73",
          accentColor: "#0e7c61",
        },
        {
          type: "stats",
          items: [
            { value: "31", label: "Years serving local businesses" },
            { value: "1,200+", label: "Clients advised" },
            { value: "$180M", label: "In tax savings identified" },
            { value: "4.9/5", label: "Average client rating" },
          ],
          accentColor: "#0e7c61",
          textColor: "#0b2545",
          mutedColor: "#4b5c73",
        },
        {
          type: "grid",
          heading: "Services",
          columns: 4,
          items: [
            { iconName: "FileText", title: "Tax Planning & Preparation", text: "Proactive strategies that reduce liability, not just file returns." },
            { iconName: "Briefcase", title: "CFO & Advisory Services", text: "Fractional CFO support for scaling businesses." },
            { iconName: "ShieldCheck", title: "Audit & Assurance", text: "Independent audits that satisfy lenders, investors, and regulators." },
            { iconName: "Wallet", title: "Wealth & Retirement Planning", text: "Personal financial planning for owners and executives." },
          ],
          accentColor: "#0e7c61",
          textColor: "#0b2545",
          mutedColor: "#4b5c73",
        },
        {
          type: "pricing",
          heading: "Advisory Packages",
          subheading: "Transparent monthly retainers — no surprise invoices.",
          tiers: [
            {
              name: "Essentials",
              price: "$650",
              period: "/month",
              features: ["Monthly bookkeeping review", "Quarterly tax planning call", "Annual return preparation"],
              cta: { text: "Get Started", href: "#contact" },
            },
            {
              name: "Growth",
              price: "$1,900",
              period: "/month",
              features: ["Everything in Essentials", "Monthly CFO advisory session", "Cash flow forecasting", "Payroll & compliance support"],
              cta: { text: "Choose Growth", href: "#contact" },
              highlighted: true,
            },
            {
              name: "Enterprise",
              price: "Custom",
              period: "tailored retainer",
              features: ["Dedicated senior advisor", "Audit & assurance included", "M&A and due diligence support", "Priority year-round access"],
              cta: { text: "Talk to a Partner", href: "#contact" },
            },
          ],
          accentColor: "#0e7c61",
          textColor: "#0b2545",
          mutedColor: "#4b5c73",
        },
        {
          type: "table",
          heading: "Compare Our Packages",
          headers: ["", "Essentials", "Growth", "Enterprise"],
          rows: [
            ["Bookkeeping review", "Monthly", "Monthly", "Weekly"],
            ["CFO advisory calls", "—", "Monthly", "On demand"],
            ["Tax planning", "Quarterly", "Quarterly", "Ongoing"],
            ["Dedicated advisor", "Shared", "Shared", "Dedicated"],
          ],
          textColor: "#0b2545",
        },
        {
          type: "testimonials",
          heading: "Trusted By Business Owners",
          items: [
            { quote: "Castellane found deductions our previous accountant never mentioned. They pay for themselves.", name: "Marcus Delaine", role: "Owner, Delaine Contracting" },
            { quote: "Having a real CFO conversation every month changed how we make decisions.", name: "Priya Vashisht", role: "Founder, Vashisht Retail Group" },
          ],
          cardBg: "#f0fdf9",
          textColor: "#0b2545",
          mutedColor: "#4b5c73",
        },
        {
          type: "footer",
          brand: "Castellane Financial Advisory",
          menu: [{ label: "Services" }, { label: "Insights" }, { label: "Careers" }, { label: "Contact" }],
          links: [{ provider: "linkedin" }],
          copyright: "© Castellane Financial Advisory. A CPA-led firm.",
          bg: "#0b2545",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 5. EMAIL / quick — Consultation booked confirmation (law firm)
    // ---------------------------------------------------------------------
    {
      name: "Consultation Confirmed Email",
      kind: "EMAIL",
      tier: "quick",
      description: "A reassuring confirmation email for a booked legal or advisory consultation, with the appointment details and what to expect next.",
      pageStyle: { backgroundColor: "#ffffff", color: "#0f172a", htmlTitle: "Your Consultation Is Confirmed" },
      sections: [
        {
          type: "hero",
          eyebrow: "ASHCOMBE & REID LLP",
          heading: "Your Consultation Is Confirmed, Ms. Whitfield",
          subheading: "You're scheduled for Thursday, August 13 at 2:00 PM with Attorney Daniel Reid.",
          accentColor: "#1e3a5f",
          mutedColor: "#475569",
        },
        {
          type: "richtext",
          heading: "What to Bring",
          paragraphs: [
            "To make the most of your session, please have any relevant documents, correspondence, or contracts related to your matter on hand — either printed or ready to share on screen.",
            "If anything comes up before your appointment, simply reply to this email and our office will assist right away.",
          ],
          mutedColor: "#475569",
        },
        {
          type: "cta",
          heading: "Need to Reschedule?",
          subheading: "Life happens — just let us know at least 24 hours in advance.",
          cta: { text: "Manage My Appointment", href: "#reschedule" },
          bg: "#1e3a5f",
        },
        {
          type: "footer",
          brand: "Ashcombe & Reid LLP",
          copyright: "© Ashcombe & Reid LLP. Attorney advertising.",
          bg: "#0f172a",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 6. EMAIL / quick — Quarterly insights newsletter (consulting)
    // ---------------------------------------------------------------------
    {
      name: "Quarterly Insights Newsletter Email",
      kind: "EMAIL",
      tier: "quick",
      description: "A clean, editorial newsletter email sharing quarterly market insights and thought leadership from a consulting or advisory firm.",
      pageStyle: { backgroundColor: "#f8fafc", color: "#0f1a2e", htmlTitle: "Meridian Quarterly Insights" },
      sections: [
        {
          type: "hero",
          eyebrow: "Q3 2026 INSIGHTS",
          heading: "Three Shifts Reshaping Enterprise Strategy This Quarter",
          subheading: "Our partners break down what leadership teams should be watching heading into next year.",
          accentColor: "#c9a227",
          mutedColor: "#475569",
        },
        {
          type: "grid",
          heading: "In This Issue",
          columns: 3,
          items: [
            { iconName: "TrendingUp", title: "The New M&A Playbook", text: "Why deal structures are shifting toward earn-outs in a higher-rate environment." },
            { iconName: "Target", title: "Operating Model Resets", text: "How three of our clients cut decision latency by 40% this year." },
            { iconName: "Globe", title: "Global Supply Realignment", text: "What nearshoring means for mid-market manufacturers in 2027." },
          ],
          accentColor: "#c9a227",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
        },
        {
          type: "cta",
          heading: "Want to Discuss How This Applies to You?",
          subheading: "Our partners offer a complimentary 30-minute briefing for subscribers.",
          cta: { text: "Request a Briefing", href: "#briefing" },
          bg: "#0f1a2e",
          textColor: "#f1f5f9",
        },
        {
          type: "footer",
          brand: "Meridian Strategy Partners",
          copyright: "© Meridian Strategy Partners. You're receiving this as a subscriber to our insights list.",
          bg: "#0f1a2e",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 7. EMAIL / premium — Proposal follow-up with case studies (agency/recruiting)
    // ---------------------------------------------------------------------
    {
      name: "Proposal Follow-Up with Case Studies Email",
      kind: "EMAIL",
      tier: "premium",
      description: "A persuasive follow-up email after sending a proposal, reinforcing the pitch with relevant case studies, a comparison of engagement options, and testimonials to help close the deal.",
      pageStyle: { backgroundColor: "#ffffff", color: "#18181b", htmlTitle: "Following Up on Your Proposal" },
      sections: [
        {
          type: "hero",
          eyebrow: "NORTHBOUND STUDIO",
          heading: "Still Thinking It Over? Here's Why Teams Choose Us",
          subheading: "We sent your proposal last week — here's a bit more context while you weigh your options.",
          accentColor: "#b45309",
          mutedColor: "#52525b",
        },
        {
          type: "grid",
          heading: "Recent Results for Clients Like You",
          columns: 2,
          items: [
            { imageSeed: "case-study-halberd", title: "Halberd Systems", text: "Rebrand and web relaunch drove a 68% increase in qualified demo requests within 90 days." },
            { imageSeed: "case-study-arwen", title: "Arwen Logistics", text: "New positioning and campaign strategy cut cost-per-lead by 41% in the first quarter." },
          ],
          accentColor: "#b45309",
          textColor: "#18181b",
          mutedColor: "#52525b",
        },
        {
          type: "table",
          heading: "Your Proposed Engagement Options",
          headers: ["", "Project-Based", "Retainer"],
          rows: [
            ["Timeline", "8-12 weeks", "Ongoing, month to month"],
            ["Team", "Core project team", "Dedicated pod"],
            ["Best for", "A defined launch or rebrand", "Continuous growth marketing"],
          ],
          textColor: "#18181b",
        },
        {
          type: "testimonials",
          items: [
            { quote: "Northbound didn't just deliver a brand — they delivered a pipeline. Best agency partner we've had.", name: "Devon Achebe", role: "VP Marketing, Halberd Systems" },
          ],
          cardBg: "#fafaf9",
          textColor: "#18181b",
          mutedColor: "#52525b",
        },
        {
          type: "cta",
          heading: "Let's Find 20 Minutes This Week",
          subheading: "Happy to answer questions or adjust scope before you decide.",
          cta: { text: "Grab a Time on My Calendar", href: "#calendar" },
          bg: "#b45309",
          textColor: "#fffbeb",
        },
        {
          type: "footer",
          brand: "Northbound Studio",
          copyright: "© Northbound Studio. Reply anytime — we read every email personally.",
          bg: "#18181b",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 8. LANDING_PAGE opt-in / quick — Free consultation booking (recruiting)
    // ---------------------------------------------------------------------
    {
      name: "Talvera Search Group — Free Hiring Consultation Opt-In Page",
      kind: "LANDING_PAGE",
      tier: "quick",
      description: "A short, high-intent opt-in landing page for a recruiting and staffing firm, offering a free hiring-needs consultation in exchange for a short form submission.",
      pageStyle: { backgroundColor: "#fdf4ff", color: "#3b0764", htmlTitle: "Talvera Search Group — Free Consultation" },
      sections: [
        {
          type: "hero",
          eyebrow: "TALVERA SEARCH GROUP",
          heading: "Struggling to Fill a Critical Role? Let's Talk.",
          subheading: "Book a free 20-minute hiring consultation and get a candidate pipeline plan tailored to your open role.",
          accentColor: "#7e22ce",
          mutedColor: "#6b21a8",
        },
        {
          type: "form",
          heading: "Book Your Free Consultation",
          subheading: "We'll reach out within one business day to schedule.",
          fields: [
            { kind: "text", label: "Full Name", name: "fullName", placeholder: "Jordan Ellis", required: true },
            { kind: "text", label: "Company", name: "company", placeholder: "Your company name", required: true },
            { kind: "text", label: "Role You're Hiring For", name: "role", placeholder: "e.g. VP of Sales", required: true },
            { kind: "email", label: "Work Email", name: "email", placeholder: "you@company.com", required: true },
          ],
          submitLabel: "Book My Free Consultation",
          accentColor: "#7e22ce",
        },
        {
          type: "footer",
          brand: "Talvera Search Group",
          copyright: "© Talvera Search Group. Executive & specialized staffing.",
          bg: "#3b0764",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 9. LANDING_PAGE opt-in / quick — Whitepaper download (consulting)
    // ---------------------------------------------------------------------
    {
      name: "Meridian Industry Report Download Page",
      kind: "LANDING_PAGE",
      tier: "quick",
      description: "A lead-generation landing page offering a downloadable industry report in exchange for contact details — built for consulting and advisory content marketing.",
      pageStyle: { backgroundColor: "#f1f5f9", color: "#0f1a2e", htmlTitle: "2026 Enterprise Strategy Report" },
      sections: [
        {
          type: "hero",
          eyebrow: "FREE INDUSTRY REPORT",
          heading: "The 2026 Enterprise Strategy Outlook Report",
          subheading: "40 pages of proprietary research on how the fastest-growing companies are restructuring for the next decade — based on interviews with 200 executives.",
          imageSeed: "meridian-report-cover",
          imageAlt: "Cover of the 2026 Enterprise Strategy Outlook Report",
          accentColor: "#c9a227",
          mutedColor: "#475569",
        },
        {
          type: "form",
          heading: "Get Your Free Copy",
          subheading: "Delivered instantly to your inbox.",
          fields: [
            { kind: "text", label: "Full Name", name: "fullName", placeholder: "Alexandra Petrov", required: true },
            { kind: "email", label: "Work Email", name: "email", placeholder: "you@company.com", required: true },
            { kind: "text", label: "Company", name: "company", placeholder: "Your company name", required: false },
          ],
          submitLabel: "Download the Report",
          accentColor: "#c9a227",
        },
        {
          type: "iconrow",
          items: [
            { iconName: "CheckCircle", label: "Based on 200 executive interviews" },
            { iconName: "ShieldCheck", label: "No spam — unsubscribe anytime" },
            { iconName: "FileText", label: "Instant PDF delivery" },
          ],
          accentColor: "#c9a227",
          textColor: "#0f1a2e",
          mutedColor: "#475569",
        },
        {
          type: "footer",
          brand: "Meridian Strategy Partners",
          copyright: "© Meridian Strategy Partners.",
          bg: "#0f1a2e",
        },
      ],
    },

    // ---------------------------------------------------------------------
    // 10. LANDING_PAGE opt-in / quick — Newsletter signup (financial advisory)
    // ---------------------------------------------------------------------
    {
      name: "Castellane Insights Newsletter Signup Page",
      kind: "LANDING_PAGE",
      tier: "quick",
      description: "A simple, trust-building newsletter opt-in page for a financial advisory firm, collecting emails for a monthly tax and planning insights digest.",
      pageStyle: { backgroundColor: "#f0fdf9", color: "#0b2545", htmlTitle: "Castellane Insights Newsletter" },
      sections: [
        {
          type: "hero",
          eyebrow: "FREE MONTHLY DIGEST",
          heading: "Tax and Planning Insights, Straight From Our Partners",
          subheading: "One concise email a month covering the deadlines, deductions, and planning moves business owners shouldn't miss.",
          accentColor: "#0e7c61",
          mutedColor: "#4b5c73",
        },
        {
          type: "form",
          heading: "Join the Digest",
          subheading: "Free forever. Unsubscribe with one click.",
          fields: [{ kind: "email", label: "Email Address", name: "email", placeholder: "you@example.com", required: true }],
          submitLabel: "Send Me the Digest",
          accentColor: "#0e7c61",
        },
        {
          type: "footer",
          brand: "Castellane Financial Advisory",
          copyright: "© Castellane Financial Advisory. A CPA-led firm.",
          bg: "#0b2545",
        },
      ],
    },
  ],
};
