/**
 * Maps one SectionSpec (types.ts) to one or more real plexo-sdk RowJSON objects
 * (body.rows[].columns[].elements[]). This is the single place that has to know the
 * real element schema (server/sanitizer.ts's TemplateJSONSchema) — spec files never
 * touch row/column/element shapes directly.
 */
import type {
  CtaLink,
  FormFieldSpec,
  SectionSpec,
} from "./types";

export function seededImage(seed: string, w = 1200, h = 800): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

export class IdGen {
  private counters: Record<string, number> = {};
  constructor(private readonly prefix: string) {}
  next(kind: string): string {
    const n = (this.counters[kind] = (this.counters[kind] || 0) + 1);
    return `${this.prefix}-${kind}-${n}`;
  }
}

type Style = Record<string, string | number | undefined>;

function heading(id: IdGen, text: string, style: Style) {
  return { id: id.next("heading"), type: "heading" as const, style, attributes: { text } };
}
function paragraph(id: IdGen, text: string, style: Style) {
  return { id: id.next("paragraph"), type: "paragraph" as const, style, attributes: { text } };
}
function textEl(id: IdGen, text: string, style: Style) {
  return { id: id.next("text"), type: "text" as const, style, attributes: { text } };
}
function buttonEl(id: IdGen, cta: CtaLink, style: Style) {
  return { id: id.next("button"), type: "button" as const, style, attributes: { text: cta.text, href: cta.href || "#" } };
}
function imageEl(id: IdGen, src: string, alt: string, style: Style) {
  return { id: id.next("image"), type: "image" as const, style, attributes: { src, alt } };
}
function spacerEl(id: IdGen, height: string) {
  return { id: id.next("spacer"), type: "spacer" as const, style: { height }, attributes: {} };
}
function dividerEl(id: IdGen, style: Style) {
  return { id: id.next("divider"), type: "divider" as const, style, attributes: {} };
}
function cardEl(id: IdGen, title: string, description: string, style: Style) {
  return { id: id.next("card"), type: "card" as const, style, attributes: { title, description } };
}
function iconEl(id: IdGen, iconName: string, style: Style, href?: string) {
  return { id: id.next("icon"), type: "icon" as const, style, attributes: { iconName, ...(href ? { href } : {}) } };
}
function carouselEl(id: IdGen, images: Array<{ src: string; alt?: string; caption?: string }>, style: Style) {
  return { id: id.next("carousel"), type: "carousel" as const, style, attributes: { images, activeIdx: 0 } };
}
function videoEl(id: IdGen, videoUrl: string, alt: string, style: Style) {
  return { id: id.next("video"), type: "video" as const, style, attributes: { videoUrl, alt, href: videoUrl } };
}
function timerEl(id: IdGen, targetDate: string, style: Style) {
  return { id: id.next("timer"), type: "timer" as const, style, attributes: { targetDate, showLabels: true } };
}
function socialEl(id: IdGen, links: Array<{ provider: string; url?: string }>, style: Style) {
  return {
    id: id.next("social"),
    type: "social" as const,
    style,
    attributes: { links: links.map((l) => ({ provider: l.provider, url: l.url || "#" })) },
  };
}
function menuEl(id: IdGen, links: Array<{ label: string; href?: string }>, style: Style) {
  return {
    id: id.next("menu"),
    type: "menu" as const,
    style,
    attributes: { links: links.map((l) => ({ label: l.label, href: l.href || "#" })) },
  };
}
function tableEl(id: IdGen, headers: string[], rows: string[][], style: Style) {
  const cells = [headers, ...rows];
  return {
    id: id.next("table"),
    type: "table" as const,
    style,
    attributes: { rowCount: cells.length, colCount: headers.length, cells, enableHeader: true, striped: true },
  };
}
function formContainerEl(id: IdGen, fields: FormFieldSpec[], submitLabel: string, style: Style) {
  const resolvedFields = fields.map((f, i) => ({
    id: `field-${i}`,
    kind: f.kind,
    name: f.name,
    label: f.label,
    showLabel: true,
    required: !!f.required,
    placeholder: f.placeholder || "",
    ...(f.kind === "select" && f.options
      ? { options: f.options.map((o) => ({ label: o, value: o.toLowerCase().replace(/\s+/g, "-") })) }
      : {}),
    fontSize: "13px",
    labelFontWeight: "700",
    borderRadius: "10px",
    borderWidth: "1px",
    borderColor: "#cbd5e1",
  }));
  return {
    id: id.next("form"),
    type: "form_container" as const,
    style,
    attributes: { fields: resolvedFields, submitLabel, actionUrl: "#" },
  };
}

function row(id: IdGen, style: Style, columns: any[]) {
  return { id: id.next("row"), style, columns };
}
function col(id: IdGen, width: string, elements: any[]) {
  return { id: id.next("col"), width, elements };
}

const ROW_PAD = "64px 40px";
const ROW_PAD_TIGHT = "40px 32px";

export function buildSection(id: IdGen, spec: SectionSpec): any[] {
  switch (spec.type) {
    case "hero":
      return buildHero(id, spec);
    case "grid":
      return buildGrid(id, spec);
    case "testimonials":
      return buildTestimonials(id, spec);
    case "stats":
      return buildStats(id, spec);
    case "pricing":
      return buildPricing(id, spec);
    case "cta":
      return buildCta(id, spec);
    case "form":
      return buildForm(id, spec);
    case "gallery":
      return buildGallery(id, spec);
    case "video":
      return buildVideo(id, spec);
    case "countdown":
      return buildCountdown(id, spec);
    case "footer":
      return buildFooter(id, spec);
    case "richtext":
      return buildRichText(id, spec);
    case "table":
      return buildTable(id, spec);
    case "iconrow":
      return buildIconRow(id, spec);
    case "menubar":
      return buildMenuBar(id, spec);
    default:
      throw new Error(`Unknown section type: ${JSON.stringify((spec as any)?.type)}`);
  }
}

function buildHero(id: IdGen, spec: import("./types").HeroSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const accent = spec.accentColor || "#4f46e5";
  const align = spec.align || "center";

  const textElements = [
    ...(spec.eyebrow ? [textEl(id, spec.eyebrow, { color: accent, fontSize: "13px", fontWeight: "700", textAlign: align, letterSpacing: "1px" })] : []),
    heading(id, spec.heading, { color: textColor, fontSize: "44px", fontWeight: "800", textAlign: align, padding: "12px 0px 0px 0px" }),
    ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "18px", textAlign: align, padding: "14px 0px 0px 0px" })] : []),
    ...(spec.primaryCta || spec.secondaryCta
      ? [
          {
            ...buttonEl(id, spec.primaryCta || spec.secondaryCta!, {
              backgroundColor: accent,
              color: "#ffffff",
              padding: "14px 30px",
              borderRadius: "10px",
              fontWeight: "700",
              textAlign: align,
              margin: align === "center" ? "26px auto 0px" : "26px 12px 0px 0px",
            }),
          },
          ...(spec.primaryCta && spec.secondaryCta
            ? [
                buttonEl(id, spec.secondaryCta, {
                  backgroundColor: "transparent",
                  color: textColor,
                  padding: "14px 30px",
                  borderRadius: "10px",
                  fontWeight: "700",
                  textAlign: align,
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: mutedColor,
                  margin: "26px 0px 0px 12px",
                }),
              ]
            : []),
        ]
      : []),
  ];

  if (spec.imageSeed) {
    return [
      row(id, { backgroundColor: spec.bg, padding: ROW_PAD },
        [
          col(id, "55%", textElements),
          col(id, "45%", [imageEl(id, seededImage(spec.imageSeed), spec.imageAlt || spec.heading, { width: "100%", borderRadius: "16px" })]),
        ]),
    ];
  }

  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD, textAlign: "center" }, [col(id, "100%", textElements)])];
}

function buildGrid(id: IdGen, spec: import("./types").GridSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const accent = spec.accentColor || "#4f46e5";
  const widthPct = `${(100 / spec.columns).toFixed(2)}%`;

  const rows: any[] = [];
  if (spec.heading) {
    rows.push(
      row(id, { padding: "0px 40px", textAlign: "center" }, [
        col(id, "100%", [
          heading(id, spec.heading, { color: textColor, fontSize: "32px", fontWeight: "800", textAlign: "center" }),
          ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "16px", textAlign: "center", padding: "10px 0px 0px 0px" })] : []),
        ]),
      ]),
    );
  }

  const columns = spec.items.map((item) => {
    const elements: any[] = [];
    if (item.imageSeed) {
      elements.push(imageEl(id, seededImage(item.imageSeed), item.imageAlt || item.title, { width: "100%", borderRadius: "12px" }));
    } else if (item.iconName) {
      elements.push(iconEl(id, item.iconName, { color: accent, padding: "0px 0px 8px 0px" }));
    }
    elements.push(heading(id, item.title, { color: textColor, fontSize: "19px", fontWeight: "700", padding: "12px 0px 0px 0px" }));
    if (item.text) elements.push(paragraph(id, item.text, { color: mutedColor, fontSize: "14px", padding: "6px 0px 0px 0px" }));
    if (item.price) elements.push(paragraph(id, item.price, { color: accent, fontSize: "18px", fontWeight: "700", padding: "8px 0px 0px 0px" }));
    if (item.cta) elements.push(buttonEl(id, item.cta, { backgroundColor: accent, color: "#ffffff", padding: "10px 20px", borderRadius: "8px", fontWeight: "700", margin: "12px auto 0px" }));
    return col(id, widthPct, elements);
  });

  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD }, columns));
  return rows;
}

function buildTestimonials(id: IdGen, spec: import("./types").TestimonialSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const cardBg = spec.cardBg || "#f8fafc";
  const widthPct = `${(100 / Math.max(1, spec.items.length)).toFixed(2)}%`;

  const rows: any[] = [];
  if (spec.heading) {
    rows.push(row(id, { padding: "0px 40px", textAlign: "center" }, [col(id, "100%", [heading(id, spec.heading, { color: textColor, fontSize: "30px", fontWeight: "800", textAlign: "center" })])]));
  }

  const columns = spec.items.map((item) =>
    col(id, widthPct, [
      cardEl(id, `"${item.quote}"`, `${item.name}${item.role ? ` — ${item.role}` : ""}`, {
        backgroundColor: cardBg,
        color: textColor,
        padding: "26px",
        borderRadius: "14px",
      }),
    ]),
  );

  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD }, columns));
  return rows;
}

function buildStats(id: IdGen, spec: import("./types").StatsSection): any[] {
  const accent = spec.accentColor || "#4f46e5";
  const mutedColor = spec.mutedColor || "#64748b";
  const widthPct = `${(100 / Math.max(1, spec.items.length)).toFixed(2)}%`;
  const columns = spec.items.map((item) =>
    col(id, widthPct, [
      heading(id, item.value, { color: accent, fontSize: "36px", fontWeight: "800", textAlign: "center" }),
      paragraph(id, item.label, { color: mutedColor, fontSize: "14px", textAlign: "center", padding: "6px 0px 0px 0px" }),
    ]),
  );
  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT }, columns)];
}

function buildPricing(id: IdGen, spec: import("./types").PricingSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const accent = spec.accentColor || "#4f46e5";
  const widthPct = `${(100 / Math.max(1, spec.tiers.length)).toFixed(2)}%`;

  const rows: any[] = [];
  if (spec.heading) {
    rows.push(
      row(id, { padding: "0px 40px", textAlign: "center" }, [
        col(id, "100%", [
          heading(id, spec.heading, { color: textColor, fontSize: "32px", fontWeight: "800", textAlign: "center" }),
          ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "16px", textAlign: "center", padding: "10px 0px 0px 0px" })] : []),
        ]),
      ]),
    );
  }

  const cleanColumns = spec.tiers.map((tier) => {
    const bg = tier.highlighted ? accent : "#f8fafc";
    const fg = tier.highlighted ? "#ffffff" : textColor;
    const sub = tier.highlighted ? "rgba(255,255,255,0.8)" : mutedColor;
    const c = col(id, widthPct, [
      heading(id, tier.name, { color: fg, fontSize: "18px", fontWeight: "700", textAlign: "center" }),
      heading(id, tier.price, { color: fg, fontSize: "34px", fontWeight: "800", textAlign: "center", padding: "8px 0px 0px 0px" }),
      ...(tier.period ? [paragraph(id, tier.period, { color: sub, fontSize: "13px", textAlign: "center" })] : []),
      ...tier.features.map((f) => paragraph(id, `✓ ${f}`, { color: fg, fontSize: "14px", textAlign: "center", padding: "6px 0px 0px 0px" })),
      buttonEl(id, tier.cta, {
        backgroundColor: tier.highlighted ? "#ffffff" : accent,
        color: tier.highlighted ? accent : "#ffffff",
        padding: "12px 24px",
        borderRadius: "8px",
        fontWeight: "700",
        margin: "18px auto 0px",
      }),
    ]);
    (c as any).styles = { backgroundColor: bg, borderRadius: "16px", padding: "12px" };
    return c;
  });

  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD }, cleanColumns));
  return rows;
}

function buildCta(id: IdGen, spec: import("./types").CtaSection): any[] {
  const textColor = spec.textColor || "#ffffff";
  const mutedColor = spec.mutedColor || "rgba(255,255,255,0.85)";
  const bg = spec.bg || "#4f46e5";
  const elements: any[] = [
    heading(id, spec.heading, { color: textColor, fontSize: "32px", fontWeight: "800", textAlign: "center" }),
    ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "16px", textAlign: "center", padding: "10px 0px 0px 0px" })] : []),
    buttonEl(id, spec.cta, { backgroundColor: "#ffffff", color: bg, padding: "14px 30px", borderRadius: "10px", fontWeight: "700", textAlign: "center", margin: "22px auto 0px" }),
  ];
  if (spec.secondaryCta) {
    elements.push(buttonEl(id, spec.secondaryCta, { backgroundColor: "transparent", color: textColor, padding: "14px 30px", borderRadius: "10px", fontWeight: "700", textAlign: "center", borderWidth: "1px", borderStyle: "solid", borderColor: textColor, margin: "22px 0px 0px 12px" }));
  }
  return [row(id, { backgroundColor: bg, padding: ROW_PAD, textAlign: "center" }, [col(id, "100%", elements)])];
}

function buildForm(id: IdGen, spec: import("./types").FormSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const accent = spec.accentColor || "#4f46e5";
  const elements: any[] = [
    heading(id, spec.heading, { color: textColor, fontSize: "28px", fontWeight: "800", textAlign: "center" }),
    ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "15px", textAlign: "center", padding: "8px 0px 0px 0px" })] : []),
    spacerEl(id, "16px"),
    formContainerEl(id, spec.fields, spec.submitLabel, {
      backgroundColor: "transparent",
      fieldSpacing: "14px",
      buttonBackgroundColor: accent,
      buttonTextColor: "#ffffff",
      buttonBorderRadius: "10px",
    }),
  ];
  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD, textAlign: "center" }, [col(id, "100%", elements)])];
}

function buildGallery(id: IdGen, spec: import("./types").GallerySection): any[] {
  const rows: any[] = [];
  if (spec.heading) {
    rows.push(row(id, { padding: "0px 40px", textAlign: "center" }, [col(id, "100%", [heading(id, spec.heading, { color: spec.textColor || "#0f172a", fontSize: "30px", fontWeight: "800", textAlign: "center" })])]));
  }
  rows.push(
    row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT }, [
      col(id, "100%", [carouselEl(id, spec.images.map((img) => ({ src: seededImage(img.seed), alt: img.alt, caption: img.caption })), { padding: "10px" })]),
    ]),
  );
  return rows;
}

function buildVideo(id: IdGen, spec: import("./types").VideoSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const elements: any[] = [];
  if (spec.heading) elements.push(heading(id, spec.heading, { color: textColor, fontSize: "30px", fontWeight: "800", textAlign: "center" }));
  if (spec.subheading) elements.push(paragraph(id, spec.subheading, { color: mutedColor, fontSize: "15px", textAlign: "center", padding: "8px 0px 16px 0px" }));
  elements.push(videoEl(id, spec.videoUrl, spec.alt || spec.heading || "Video", { borderRadius: "16px" }));
  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD, textAlign: "center" }, [col(id, "100%", elements)])];
}

function buildCountdown(id: IdGen, spec: import("./types").CountdownSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const elements: any[] = [
    heading(id, spec.heading, { color: textColor, fontSize: "28px", fontWeight: "800", textAlign: "center" }),
    ...(spec.subheading ? [paragraph(id, spec.subheading, { color: mutedColor, fontSize: "15px", textAlign: "center", padding: "8px 0px 16px 0px" })] : []),
    timerEl(id, spec.targetDate, { backgroundColor: "#f8fafc", digitsColor: "#0f172a", labelsColor: mutedColor, borderRadius: "12px", padding: "20px" }),
  ];
  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT, textAlign: "center" }, [col(id, "100%", elements)])];
}

function buildFooter(id: IdGen, spec: import("./types").FooterSection): any[] {
  const textColor = spec.textColor || "#94a3b8";
  const mutedColor = spec.mutedColor || "#64748b";
  const rows: any[] = [row(id, { padding: "0px 40px" }, [col(id, "100%", [dividerEl(id, { borderColor: "#334155" })])])];

  const elements: any[] = [];
  if (spec.brand) elements.push(heading(id, spec.brand, { color: textColor, fontSize: "18px", fontWeight: "800", textAlign: "center" }));
  if (spec.menu && spec.menu.length) elements.push(menuEl(id, spec.menu, { color: textColor, textAlign: "center", padding: "14px 0px 0px 0px" }));
  if (spec.links && spec.links.length) elements.push(socialEl(id, spec.links, { textAlign: "center", padding: "16px 0px 0px 0px" }));
  elements.push(paragraph(id, spec.copyright || "All rights reserved.", { color: mutedColor, fontSize: "12px", textAlign: "center", padding: "18px 0px 0px 0px" }));

  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT }, [col(id, "100%", elements)]));
  return rows;
}

function buildRichText(id: IdGen, spec: import("./types").RichTextSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#475569";
  const textElements: any[] = [
    ...(spec.heading ? [heading(id, spec.heading, { color: textColor, fontSize: "28px", fontWeight: "800" })] : []),
    ...spec.paragraphs.map((p) => paragraph(id, p, { color: mutedColor, fontSize: "16px", padding: "10px 0px 0px 0px", lineHeight: "1.7" })),
  ];

  if (spec.imageSeed) {
    const imageCol = col(id, "45%", [imageEl(id, seededImage(spec.imageSeed), spec.imageAlt || spec.heading || "Image", { width: "100%", borderRadius: "14px" })]);
    const textCol = col(id, "55%", textElements);
    const columns = spec.imageSide === "left" ? [imageCol, textCol] : [textCol, imageCol];
    return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD }, columns)];
  }

  return [row(id, { backgroundColor: spec.bg, padding: ROW_PAD }, [col(id, "100%", textElements)])];
}

function buildTable(id: IdGen, spec: import("./types").TableSection): any[] {
  const rows: any[] = [];
  if (spec.heading) {
    rows.push(row(id, { padding: "0px 40px", textAlign: "center" }, [col(id, "100%", [heading(id, spec.heading, { color: spec.textColor || "#0f172a", fontSize: "30px", fontWeight: "800", textAlign: "center" })])]));
  }
  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT }, [col(id, "100%", [tableEl(id, spec.headers, spec.rows, {})])]));
  return rows;
}

function buildIconRow(id: IdGen, spec: import("./types").IconRowSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const mutedColor = spec.mutedColor || "#64748b";
  const accent = spec.accentColor || "#4f46e5";
  const widthPct = `${(100 / Math.max(1, spec.items.length)).toFixed(2)}%`;
  const rows: any[] = [];
  if (spec.heading) {
    rows.push(row(id, { padding: "0px 40px", textAlign: "center" }, [col(id, "100%", [heading(id, spec.heading, { color: textColor, fontSize: "28px", fontWeight: "800", textAlign: "center" })])]));
  }
  const columns = spec.items.map((item) =>
    col(id, widthPct, [
      iconEl(id, item.iconName, { color: accent, textAlign: "center" }),
      paragraph(id, item.label, { color: mutedColor, fontSize: "14px", textAlign: "center", fontWeight: "600", padding: "8px 0px 0px 0px" }),
    ]),
  );
  rows.push(row(id, { backgroundColor: spec.bg, padding: ROW_PAD_TIGHT }, columns));
  return rows;
}

function buildMenuBar(id: IdGen, spec: import("./types").MenuBarSection): any[] {
  const textColor = spec.textColor || "#0f172a";
  const accent = spec.accentColor || "#4f46e5";
  const rightElements: any[] = [menuEl(id, spec.links, { color: textColor, textAlign: "right", fontWeight: "600" })];
  if (spec.cta) rightElements.push(buttonEl(id, spec.cta, { backgroundColor: accent, color: "#ffffff", padding: "10px 20px", borderRadius: "8px", fontWeight: "700", margin: "0px 0px 0px auto" }));
  return [
    row(id, { backgroundColor: spec.bg, padding: "20px 40px" }, [
      col(id, "40%", [heading(id, spec.brand, { color: textColor, fontSize: "20px", fontWeight: "800" })]),
      col(id, "60%", rightElements),
    ]),
  ];
}
