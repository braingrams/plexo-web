import DOMPurify from 'isomorphic-dompurify';
import { z } from 'zod';

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
  'video', 'social', 'menu', 'html', 'table', 'timer', 'icon'
]);

export const ElementJSONSchema = z.object({
  id: z.string().max(100),
  type: ElementTypeSchema,
  style: StyleRecordSchema,
  attributes: ElementAttributesSchema,
});

const ColumnJSONSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().max(100),
  width: z.string().max(20),
  styles: StyleRecordSchema.optional(),
  elements: z.array(ElementJSONSchema).max(200),
  nestedRows: z.array(RowJSONSchema).max(50).optional(),
  attrs: z.record(z.string(), z.any()).optional(),
}));

const RowJSONSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().max(100),
  style: StyleRecordSchema,
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
// 4. HTML & Style Sanitizers
// ==========================================

/**
 * Sanitizes an inline CSS style declaration string to prevent injection
 */
function sanitizeStyleString(style: string): string {
  const declarations = style.split(';');
  const cleanDeclarations: string[] = [];

  const blockedProperties = new Set([
    'position',
    'z-index',
    'top',
    'left',
    'right',
    'bottom',
    'behavior',
    'pointer-events',
  ]);

  for (const decl of declarations) {
    if (!decl.trim()) continue;
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) continue;

    const property = decl.slice(0, colonIndex).trim().toLowerCase();
    const value = decl.slice(colonIndex + 1).trim();

    if (blockedProperties.has(property)) {
      continue;
    }

    const valueLower = value.toLowerCase();
    if (
      valueLower.includes('javascript:') ||
      valueLower.includes('vbscript:') ||
      valueLower.includes('expression') ||
      valueLower.includes('url(') ||
      valueLower.includes('@import') ||
      valueLower.includes('-moz-binding') ||
      valueLower.includes('behavior') ||
      /\\/g.test(value)
    ) {
      continue;
    }

    if (property.includes('margin') && value.includes('-')) {
      continue;
    }

    cleanDeclarations.push(`${property}: ${value}`);
  }

  return cleanDeclarations.join('; ');
}

/**
 * Purifies raw HTML against XSS/DOM Cloaking with strict tag and attribute whitelists.
 */
export function sanitizeHtml(html: string): string {
  const ALLOWED_TAGS = [
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'button', 'svg', 'path', 'table', 'thead', 'tbody',
    'tr', 'th', 'td', 'hr', 'br', 'ul', 'ol', 'li', 'section', 'article',
    'main', 'header', 'footer', 'aside'
  ];

  const ALLOWED_ATTR = [
    'href', 'src', 'alt', 'class', 'id', 'style', 'title', 'target', 'rel',
    'width', 'height', 'align', 'valign', 'cellpadding', 'cellspacing',
    'border', 'viewbox', 'fill', 'stroke', 'd', 'xmlns'
  ];

  DOMPurify.removeAllHooks();

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Force secure links
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');

      const href = node.getAttribute('href') || '';
      const trimmedHref = href.trim().toLowerCase();
      if (
        trimmedHref.startsWith('javascript:') ||
        trimmedHref.startsWith('vbscript:') ||
        trimmedHref.startsWith('data:')
      ) {
        node.removeAttribute('href');
      }
    }

    if (node.hasAttribute('src')) {
      const src = node.getAttribute('src') || '';
      const trimmedSrc = src.trim().toLowerCase();
      if (
        trimmedSrc.startsWith('javascript:') ||
        trimmedSrc.startsWith('vbscript:') ||
        trimmedSrc.startsWith('data:')
      ) {
        node.removeAttribute('src');
      }
    }

    // Strict inline CSS sanitization
    if (node.hasAttribute('style')) {
      const style = node.getAttribute('style') || '';
      const sanitized = sanitizeStyleString(style);
      if (sanitized) {
        node.setAttribute('style', sanitized);
      } else {
        node.removeAttribute('style');
      }
    }
  });

  const cleaned = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    RETURN_TRUSTED_TYPE: false,
  });

  DOMPurify.removeAllHooks();
  return cleaned;
}

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
