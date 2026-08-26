// Re-exported under its original name (sanitizeHtml) so every existing call site here keeps
// working unchanged — the actual allowlist/logic now lives in one place (the SDK) instead of
// being hand-duplicated across both repos. See @charisol/plexo-sdk's sanitizeCompiledHtml.ts
// for the full rationale; this used to be a local copy of exactly that file.
import { sanitizeCompiledHtml as sanitizeHtml } from '@charisol/plexo-sdk/sanitize';
import { z } from 'zod';

export { sanitizeHtml };

// ==========================================
// 1. Types & Interfaces
// ==========================================

export interface RawBuilderPayload {
  designJson: unknown;
  compiledHtml?: string;
}

export interface SanitizedBuilderPayload {
  designJson: any; // Type-safe TemplateJSON structure
  compiledHtml: string;
}

// ==========================================
// 2. Prototype Pollution Cleaner & DoS Guard
// ==========================================

/**
 * Recursively cleans an object, removing prototype pollution keys
 * and enforcing maximum depth limits.
 */
function sanitizeObject(obj: any, currentDepth = 0, maxDepth = 50): any {
  if (currentDepth > maxDepth) {
    throw new Error('Security Error: JSON payload structure depth limit exceeded.');
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, currentDepth + 1, maxDepth));
  }

  const cleanObj: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      // Strip potentially dangerous prototype pollution properties
      continue;
    }
    cleanObj[key] = sanitizeObject(obj[key], currentDepth + 1, maxDepth);
  }
  return cleanObj;
}

// ==========================================
// 3. Strict Zod Schema for Backend Validation
// ==========================================

const SafeStringSchema = z.string().max(4000, 'String value too long');
const StyleRecordSchema = z.record(z.string(), z.union([SafeStringSchema, z.number()]));

const ElementAttributesSchema = z.object({
  href: SafeStringSchema.optional(),
  src: SafeStringSchema.optional(),
  alt: SafeStringSchema.optional(),
  placeholder: SafeStringSchema.optional(),
  text: z.string().max(50000, 'Text content too large').optional(),
  htmlContent: z.string().max(100000, 'HTML content block too large').optional(),
  autoHeight: z.boolean().optional(),
  headingType: SafeStringSchema.optional(),
  options: z.array(z.object({
    label: SafeStringSchema,
    value: SafeStringSchema,
  })).max(100, 'Too many options in select element').optional(),
}).catchall(z.any());

const ElementTypeSchema = z.enum([
  'text', 'button', 'image', 'spacer', 'divider', 'card', 'form_container',
  'input', 'textarea', 'select', 'heading', 'paragraph', 'carousel',
  'video', 'social', 'menu', 'html', 'table', 'timer', 'icon', 'accordion',
  'blog_title', 'blog_content', 'blog_featured_image', 'blog_date',
  'blog_author', 'blog_categories', 'blog_comments', 'blog_post_list',
  // Plexo Commerce marker family (@charisol/plexo-sdk >= 1.4.6) — same "must be listed
  // here too or the whole template tree gets rejected" requirement as every blog_* entry
  // above; this schema is hand-maintained separately from the SDK's own.
  'product', 'booking', 'shop_grid', 'cart_summary', 'checkout_flow',
  'order_confirmation', 'order_tracking'
]);

export const ElementJSONSchema = z.object({
  id: z.string().max(100),
  type: ElementTypeSchema,
  style: StyleRecordSchema,
  attributes: ElementAttributesSchema,
  // Explicit per-breakpoint overrides (plexo-sdk's ElementJSON.styleTablet/styleMobile —
  // see utilities/responsiveDefaults.ts there). z.object() strips unrecognized keys by
  // default, so omitting these here would silently discard every explicit responsive
  // override on every save, even though the SDK itself round-trips them fine.
  styleTablet: StyleRecordSchema.optional(),
  styleMobile: StyleRecordSchema.optional(),
});

const ColumnJSONSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().max(100),
  width: z.string().max(20),
  styles: StyleRecordSchema.optional(),
  stylesTablet: StyleRecordSchema.optional(),
  stylesMobile: StyleRecordSchema.optional(),
  elements: z.array(ElementJSONSchema).max(200),
  nestedRows: z.array(RowJSONSchema).max(50).optional(),
  attrs: z.record(z.string(), z.any()).optional(),
  // plexo-sdk's ColumnJSON.childOrder — the true interleaved visual order of this column's
  // elements and nested rows (see plexo-sdk's utilities/columnOrder.ts). Same z.object()
  // unrecognized-key stripping as styleTablet/styleMobile above: omitting this silently
  // discarded any reordering that placed something above/below a nested row, or moved an
  // element out of insertion order, on every save AND on every /api/v1/compile call — the
  // canvas (reading the live in-memory JSON) showed the right order, but the compiled
  // output silently fell back to elements-then-nestedRows / insertion order.
  childOrder: z.array(z.string().max(100)).max(250).optional(),
}));

const RowJSONSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().max(100),
  style: StyleRecordSchema,
  styleTablet: StyleRecordSchema.optional(),
  styleMobile: StyleRecordSchema.optional(),
  columns: z.array(ColumnJSONSchema).max(12),
  htmlId: z.string().max(100).optional(),
  htmlClass: z.string().max(250).optional(),
}));

const StrataConfigSchema = z.object({
  projectId: z.string().max(100),
  syncEnabled: z.boolean(),
});

const UploadedImageSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(250),
  src: z.string().max(4000),
});

const PublishConfigSchema = z.object({
  apiKeyOverride: z.string().max(500).optional(),
});

// NOTE: apiKey/provider were dropped from this schema deliberately — a per-template
// override used to carry a raw provider key inside designJson, which is loaded into
// the browser wholesale for editing and could never be kept secret there. The actual
// key now always comes from the account's server-side, encrypted ApiKey row; a
// template may only override useAi/tier.
const AiConfigSchema = z.object({
  useAi: z.boolean().optional(),
  tier: z.string().max(100).optional(),
});

const BodyJSONSchema = z.object({
  style: StyleRecordSchema,
  rows: z.array(RowJSONSchema).max(200),
  strataConfig: StrataConfigSchema.optional(),
  uploadedImages: z.array(UploadedImageSchema).max(100).optional(),
  publishedDomain: z.object({
    domain: SafeStringSchema,
    type: z.enum(['SUBDOMAIN', 'CUSTOM']),
  }).optional(),
  publishConfig: PublishConfigSchema.optional(),
  aiConfig: AiConfigSchema.optional(),
});

export const TemplateJSONSchema = z.object({
  body: BodyJSONSchema,
});

// ==========================================
// 3.5. Structural Hydration for External/AI Callers
// ==========================================

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Fills in structural bookkeeping (ids, empty style/attributes objects, default
 * column widths) that external AI callers (MCP, REST publish) often omit.
 * Deliberately does NOT interpret or convert shorthand content blocks (e.g.
 * { type: "products", content: {...} }) into columns/elements — a row missing
 * that structure is left as-is so TemplateJSONSchema rejects it with an
 * actionable error instead of this layer silently guessing and dropping data.
 */
export function hydrateStructuralDefaults(inputJson: any): any {
  if (!inputJson || typeof inputJson !== 'object') return inputJson;

  const rawRows: any[] = Array.isArray(inputJson.body?.rows)
    ? inputJson.body.rows
    : Array.isArray(inputJson.rows)
      ? inputJson.rows
      : [];

  const rows = rawRows.map((row: any, rowIdx: number) => {
    if (!row || typeof row !== 'object') return row;
    return {
      ...row,
      id: typeof row.id === 'string' && row.id ? row.id : randomId(`row-${rowIdx}`),
      style: row.style && typeof row.style === 'object' ? row.style : {},
      columns: Array.isArray(row.columns)
        ? row.columns.map((col: any, colIdx: number) => {
            if (!col || typeof col !== 'object') return col;
            return {
              ...col,
              id: typeof col.id === 'string' && col.id ? col.id : randomId(`row-${rowIdx}-col-${colIdx}`),
              width: typeof col.width === 'string' && col.width ? col.width : '100%',
              elements: Array.isArray(col.elements)
                ? col.elements.map((el: any, elIdx: number) => {
                    if (!el || typeof el !== 'object') return el;
                    return {
                      ...el,
                      id: typeof el.id === 'string' && el.id ? el.id : randomId(`row-${rowIdx}-col-${colIdx}-el-${elIdx}`),
                      style: el.style && typeof el.style === 'object' ? el.style : {},
                      attributes: el.attributes && typeof el.attributes === 'object' ? el.attributes : {},
                    };
                  })
                : col.elements,
            };
          })
        : row.columns,
    };
  });

  const extractedStyle: Record<string, any> = {};
  const sources = [inputJson.style, inputJson.body?.style, inputJson.body, inputJson];
  for (const src of sources) {
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      if (src.backgroundColor !== undefined) extractedStyle.backgroundColor = src.backgroundColor;
      if (src.background !== undefined) extractedStyle.background = src.background;
      if (src.color !== undefined) extractedStyle.color = src.color;
      if (src.textColor !== undefined) extractedStyle.color = src.textColor;
      if (src.fontFamily !== undefined) extractedStyle.fontFamily = src.fontFamily;
      if (src.htmlTitle !== undefined) extractedStyle.htmlTitle = src.htmlTitle;
    }
  }

  const style: Record<string, any> = {
    backgroundColor: '#08090f',
    background: '#08090f',
    color: '#f0f2ff',
    fontFamily: 'Inter, sans-serif',
    ...extractedStyle,
  };
  if (style.backgroundColor && !style.background) style.background = style.backgroundColor;
  else if (style.background && !style.backgroundColor) style.backgroundColor = style.background;

  return { body: { style, rows } };
}

/** Formats the first few Zod issues into a single line an AI tool-caller can act on. */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

// ==========================================
// 4. HTML & Style Sanitizers
// ==========================================
//
// Moved to @charisol/plexo-sdk's sanitizeCompiledHtml.ts (imported above as `sanitizeHtml`) —
// this used to be a hand-duplicated copy of that same allowlist/logic, which is exactly the
// kind of two-repos-drifting-apart risk this consolidation removes. See that file for the
// full ALLOWED_TAGS/ALLOWED_ATTR/style-sanitization implementation and rationale.

// ==========================================
// 5. Main Payload Sanitizer Function
// ==========================================

/**
 * Validates and sanitizes a complete builder payload (designJson + compiledHtml)
 * before persisting to the database. Rejects invalid formats immediately.
 */
export function sanitizePlexoPayload(payload: RawBuilderPayload): SanitizedBuilderPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Security Error: Payload must be a non-null object.');
  }

  // 1. Prototype Pollution protection
  let cleanedDesignJson: any;
  try {
    cleanedDesignJson = sanitizeObject(payload.designJson);
  } catch (err) {
    throw new Error(`Security Error: Prototype pollution check failed. ${(err as Error).message}`);
  }

  // 2. Strict Zod Schema validation
  const validationResult = TemplateJSONSchema.safeParse(cleanedDesignJson);
  if (!validationResult.success) {
    throw new Error(`Security Error: Schema validation failed. Details: ${validationResult.error.message}`);
  }

  // 3. HTML Sanitization for compiled output
  const rawHtml = payload.compiledHtml ?? '';
  const sanitizedHtml = sanitizeHtml(rawHtml);

  return {
    designJson: validationResult.data,
    compiledHtml: sanitizedHtml,
  };
}
