/**
 * Simplified content DSL for bulk-generating marketplace templates. Each TemplateSpec
 * describes a template as an ordered list of section descriptors (hero, grid, pricing, ...);
 * compile.ts turns that into a real plexo-sdk TemplateJSON (body.rows[].columns[].elements[]).
 * Content authors (human or agent) only ever write TemplateSpec objects — never raw
 * row/column/element JSON — so the one place that has to get the real schema right is
 * sectionBuilders.ts, not every spec file.
 */

export type TemplateTier = "quick" | "premium";

export interface CtaLink {
  text: string;
  href?: string;
}

export interface HeroSection {
  type: "hero";
  eyebrow?: string;
  heading: string;
  subheading?: string;
  align?: "center" | "left";
  primaryCta?: CtaLink;
  secondaryCta?: CtaLink;
  /** When set, renders a 2-column hero (text | image) instead of a centered single column. */
  imageSeed?: string;
  imageAlt?: string;
  bg?: string;
  textColor?: string;
  accentColor?: string;
  mutedColor?: string;
}

export interface GridItem {
  imageSeed?: string;
  imageAlt?: string;
  iconName?: string;
  title: string;
  text?: string;
  price?: string;
  cta?: CtaLink;
}

export interface GridSection {
  type: "grid";
  heading?: string;
  subheading?: string;
  columns: 2 | 3 | 4;
  items: GridItem[];
  bg?: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
}

export interface TestimonialItem {
  quote: string;
  name: string;
  role?: string;
}

export interface TestimonialSection {
  type: "testimonials";
  heading?: string;
  items: TestimonialItem[];
  bg?: string;
  cardBg?: string;
  textColor?: string;
  mutedColor?: string;
}

export interface StatItem {
  value: string;
  label: string;
}

export interface StatsSection {
  type: "stats";
  items: StatItem[];
  bg?: string;
  textColor?: string;
  accentColor?: string;
  mutedColor?: string;
}

export interface PricingTier {
  name: string;
  price: string;
  period?: string;
  features: string[];
  cta: CtaLink;
  highlighted?: boolean;
}

export interface PricingSection {
  type: "pricing";
  heading?: string;
  subheading?: string;
  tiers: PricingTier[];
  bg?: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
}

export interface CtaSection {
  type: "cta";
  heading: string;
  subheading?: string;
  cta: CtaLink;
  secondaryCta?: CtaLink;
  bg?: string;
  textColor?: string;
  mutedColor?: string;
}

export type FormFieldKind = "text" | "email" | "number" | "date" | "textarea" | "select";

export interface FormFieldSpec {
  kind: FormFieldKind;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface FormSection {
  type: "form";
  heading: string;
  subheading?: string;
  fields: FormFieldSpec[];
  submitLabel: string;
  bg?: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
}

export interface GalleryImage {
  seed: string;
  alt: string;
  caption?: string;
}

export interface GallerySection {
  type: "gallery";
  heading?: string;
  images: GalleryImage[];
  bg?: string;
  textColor?: string;
}

export interface VideoSection {
  type: "video";
  heading?: string;
  subheading?: string;
  videoUrl: string;
  alt?: string;
  bg?: string;
  textColor?: string;
  mutedColor?: string;
}

export interface CountdownSection {
  type: "countdown";
  heading: string;
  subheading?: string;
  targetDate: string;
  bg?: string;
  textColor?: string;
  mutedColor?: string;
}

export interface FooterSection {
  type: "footer";
  brand?: string;
  links?: Array<{ provider: string; url?: string }>;
  menu?: Array<{ label: string; href?: string }>;
  copyright?: string;
  bg?: string;
  textColor?: string;
  mutedColor?: string;
}

export interface RichTextSection {
  type: "richtext";
  heading?: string;
  paragraphs: string[];
  imageSeed?: string;
  imageAlt?: string;
  imageSide?: "left" | "right";
  bg?: string;
  textColor?: string;
  mutedColor?: string;
}

export interface TableSection {
  type: "table";
  heading?: string;
  headers: string[];
  rows: string[][];
  bg?: string;
  textColor?: string;
}

export interface IconRowItem {
  iconName: string;
  label: string;
}

export interface IconRowSection {
  type: "iconrow";
  heading?: string;
  items: IconRowItem[];
  bg?: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
}

export interface MenuBarSection {
  type: "menubar";
  brand: string;
  links: Array<{ label: string; href?: string }>;
  cta?: CtaLink;
  bg?: string;
  textColor?: string;
  accentColor?: string;
}

export type SectionSpec =
  | HeroSection
  | GridSection
  | TestimonialSection
  | StatsSection
  | PricingSection
  | CtaSection
  | FormSection
  | GallerySection
  | VideoSection
  | CountdownSection
  | FooterSection
  | RichTextSection
  | TableSection
  | IconRowSection
  | MenuBarSection;

export interface PageStyle {
  backgroundColor: string;
  color: string;
  fontFamily?: string;
  htmlTitle: string;
}

export interface TemplateSpec {
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  /** "quick" = free; "premium" = larger/technical build, priced. */
  tier: TemplateTier;
  description: string;
  sections: SectionSpec[];
  pageStyle: PageStyle;
}

export interface CategoryBatch {
  category: string;
  specs: TemplateSpec[];
}
