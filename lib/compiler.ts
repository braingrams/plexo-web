import type { TemplateJSON, ElementJSON, RowJSON } from '@charisol/plexo-sdk';

const normalizeSocialProvider = (provider: string) => {
  if (provider === 'twitter') return 'x';
  return provider;
};

const getSocialIconMarkup = (provider: string, color = 'currentColor') => {
  const normalized = normalizeSocialProvider(provider);

  switch (normalized) {
    case 'facebook':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="${color}" d="M14 8h2V4h-2c-2.2 0-4 1.8-4 4v2H8v4h2v6h4v-6h2.5l.5-4H14V8c0-.55.45-1 1-1Z"/></svg>`;
    case 'instagram':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" ry="5" fill="none" stroke="${color}" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="none" stroke="${color}" stroke-width="2"/><circle cx="17" cy="7" r="1" fill="${color}"/></svg>`;
    case 'linkedin':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="8" cy="9" r="1.25" fill="${color}"/><path fill="${color}" d="M7 11h2v6H7zM11 11h2v.9c.5-.7 1.34-1.15 2.4-1.15 2 0 3.1 1.25 3.1 3.6V17h-2v-2.2c0-1.3-.45-2.05-1.55-2.05-1.2 0-1.85.8-1.85 2.05V17h-2z"/></svg>`;
    case 'x':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="${color}" d="M6 5h3.1l3 4.2L15.7 5H18l-4.8 5.5L18.4 18h-3.1l-3.3-4.7L8 18H5.6l5-5.8z"/></svg>`;
    case 'youtube':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="6.5" width="18" height="11" rx="3" fill="${color}"/><path fill="#fff" d="m10 9 5 3-5 3z"/></svg>`;
    case 'pinterest':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="${color}" d="M12 4a8 8 0 0 0-2.9 15.46c-.04-1.17 0-2.58.3-3.82l1.1-4.6s-.27-.56-.27-1.4c0-1.3.75-2.27 1.68-2.27.8 0 1.18.6 1.18 1.3 0 .8-.5 2-.77 3.12-.22.94.47 1.7 1.4 1.7 1.67 0 2.8-2.15 2.8-4.7 0-1.93-1.3-3.37-3.67-3.37-2.68 0-4.35 2-4.35 4.23 0 .77.23 1.34.6 1.77.17.2.2.29.13.53l-.2.8c-.07.25-.3.34-.56.25-1.55-.63-2.27-2.32-2.27-4.22 0-3.14 2.64-6.9 7.89-6.9 4.21 0 6.98 3.05 6.98 6.32 0 4.32-2.4 7.54-5.93 7.54-1.18 0-2.28-.64-2.65-1.37l-.73 2.78c-.26.95-.77 2.14-1.22 2.96A8 8 0 1 0 12 4Z"/></svg>`;
    case 'whatsapp':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="${color}" d="M12 4a8 8 0 0 0-6.9 12.04L4 20l4.11-1.06A8 8 0 1 0 12 4Zm4.55 11.36c-.2.56-1.14 1.04-1.57 1.1-.4.06-.92.09-1.48-.08-.34-.11-.78-.25-1.35-.5-2.37-1.03-3.92-3.45-4.04-3.6-.11-.15-.96-1.27-.96-2.42s.6-1.72.8-1.96c.2-.24.45-.3.6-.3h.43c.14 0 .33-.05.51.38.2.48.7 1.67.75 1.79.06.12.1.26.02.42-.07.15-.11.26-.22.39-.11.13-.23.29-.33.39-.11.11-.22.23-.1.45.11.22.52.86 1.11 1.39.76.68 1.4.89 1.62.99.22.11.35.09.48-.06.13-.15.56-.65.72-.88.15-.22.31-.18.52-.11.22.08 1.36.64 1.6.76.23.11.38.17.44.27.06.1.06.61-.14 1.17Z"/></svg>`;
    case 'tiktok':
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="${color}" d="M14.4 4c.24 1.12.9 2.08 1.86 2.67.7.42 1.52.64 2.35.63V10a6.5 6.5 0 0 1-4.2-1.52v5.24A4.72 4.72 0 1 1 9.7 9v2.6a2.12 2.12 0 1 0 2.1 2.12V4z"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="${color}"/></svg>`;
  }
};

/**
 * Converts high-level AI section block rows (hero, features, cta, etc.) into Plexo column/element layouts.
 */
export function convertSectionRowToPlexoRow(row: any): any {
  if (!row || typeof row !== 'object') return null;

  if (Array.isArray(row.columns) && row.columns.length > 0) {
    return row;
  }

  const type = (row.type || "").toLowerCase();
  const content = row.props || row.content || row.attributes || row.data || row.payload || row;
  const style = row.style || {};

  switch (type) {
    case "hero": {
      const headline = content.headline || content.title || content.text || "Build faster. Scale smarter.";
      const subheadline = content.subheadline || content.description || content.subtitle || "";
      const primaryBtn = content.primaryButton || content.button || content.cta || "Get Started";
      const secondaryBtn = content.secondaryButton || "";

      const elements: any[] = [
        {
          type: "heading",
          style: { fontSize: "48px", fontWeight: "800", textAlign: "center", marginBottom: "16px" },
          attributes: { text: headline },
        },
      ];

      if (subheadline) {
        elements.push({
          type: "paragraph",
          style: { fontSize: "18px", color: "#94a3b8", textAlign: "center", maxWidth: "700px", margin: "0 auto 32px auto" },
          attributes: { text: subheadline },
        });
      }

      if (primaryBtn) {
        elements.push({
          type: "button",
          style: { textAlign: "center", backgroundColor: "#8b5cf6", color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "600" },
          attributes: { text: primaryBtn, href: "#signup" },
        });
      }

      if (secondaryBtn) {
        elements.push({
          type: "button",
          style: { textAlign: "center", backgroundColor: "rgba(255,255,255,0.1)", color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "600", marginLeft: "12px" },
          attributes: { text: secondaryBtn, href: "#demo" },
        });
      }

      return {
        id: row.id || `row-hero-${Math.random().toString(36).substring(2, 7)}`,
        style: { paddingTop: "80px", paddingBottom: "80px", textAlign: "center", ...style },
        columns: [
          {
            id: `col-hero-${Math.random().toString(36).substring(2, 7)}`,
            width: "100%",
            elements,
          },
        ],
      };
    }

    case "features": {
      const title = content.title || content.headline || "Features";
      const items = Array.isArray(content.items) ? content.items : Array.isArray(content.features) ? content.features : [];

      const elements: any[] = [
        {
          type: "heading",
          style: { fontSize: "32px", fontWeight: "700", textAlign: "center", marginBottom: "40px" },
          attributes: { text: title },
        },
      ];

      const columns: any[] = [];
      if (items.length > 0) {
        const colWidth = items.length === 2 ? "50%" : items.length >= 3 ? "33.33%" : "100%";
        items.forEach((item: any, idx: number) => {
          const itemTitle = typeof item === "string" ? item : item.title || item.name || `Feature ${idx + 1}`;
          const itemDesc = typeof item === "string" ? "" : item.description || item.text || "";

          columns.push({
            id: `col-feat-${idx}`,
            width: colWidth,
            elements: [
              {
                type: "card",
                style: { backgroundColor: "#111827", borderRadius: "16px", padding: "24px", borderWidth: "1px", borderColor: "rgba(255,255,255,0.08)" },
                attributes: { title: itemTitle, description: itemDesc || "Powerful functionality built for performance and scale." },
              },
            ],
          });
        });
      }

      return {
        id: row.id || `row-features-${Math.random().toString(36).substring(2, 7)}`,
        style: { paddingTop: "60px", paddingBottom: "60px", ...style },
        columns: columns.length > 0 ? columns : [{ id: "col-feat-fallback", width: "100%", elements }],
      };
    }

    case "cta": {
      const headline = content.headline || content.title || "Ready to transform your workflow?";
      const btnText = content.button || content.primaryButton || content.cta || "Get Started";

      return {
        id: row.id || `row-cta-${Math.random().toString(36).substring(2, 7)}`,
        style: { backgroundColor: "rgba(139, 92, 246, 0.12)", borderRadius: "24px", padding: "48px", textAlign: "center", marginTop: "40px", marginBottom: "60px", borderWidth: "1px", borderColor: "rgba(139, 92, 246, 0.3)", ...style },
        columns: [
          {
            id: `col-cta-${Math.random().toString(36).substring(2, 7)}`,
            width: "100%",
            elements: [
              {
                type: "heading",
                style: { fontSize: "32px", color: "#ffffff", fontWeight: "700", textAlign: "center", marginBottom: "20px" },
                attributes: { text: headline },
              },
              {
                type: "button",
                style: { textAlign: "center", backgroundColor: "#8b5cf6", color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontWeight: "700" },
                attributes: { text: btnText, href: "#signup" },
              },
            ],
          },
        ],
      };
    }

    default: {
      const title = content.headline || content.title || content.text || "";
      const description = content.subheadline || content.description || content.subtitle || "";
      const btnText = content.button || content.primaryButton || content.cta || "";

      const elements: any[] = [];
      if (title) {
        elements.push({
          type: "heading",
          style: { fontSize: "32px", fontWeight: "700", marginBottom: "16px" },
          attributes: { text: title },
        });
      }
      if (description) {
        elements.push({
          type: "paragraph",
          style: { fontSize: "16px", color: "#94a3b8", marginBottom: "24px" },
          attributes: { text: description },
        });
      }
      if (btnText) {
        elements.push({
          type: "button",
          style: { backgroundColor: "#8b5cf6", color: "#ffffff", borderRadius: "12px", paddingTop: "12px", paddingBottom: "12px", paddingLeft: "24px", paddingRight: "24px" },
          attributes: { text: btnText, href: "#action" },
        });
      }

      return {
        id: row.id || `row-generic-${Math.random().toString(36).substring(2, 7)}`,
        style: { paddingTop: "40px", paddingBottom: "40px", ...style },
        columns: [
          {
            id: `col-generic-${Math.random().toString(36).substring(2, 7)}`,
            width: "100%",
            elements: elements.length > 0 ? elements : [{ type: "heading", attributes: { text: "Section" } }],
          },
        ],
      };
    }
  }
}

const getInlineStyles = (styleObj: Record<string, any> = {}): string => {
  if (!styleObj || typeof styleObj !== 'object') return '';
  return Object.entries(styleObj)
    .filter(([_, val]) => val !== undefined && val !== null && val !== '')
    .map(([key, val]) => {
      const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      let value = val;
      if (
        typeof val === 'number' &&
        ['padding', 'margin', 'fontSize', 'borderRadius', 'borderWidth', 'width', 'height'].some((k) =>
          key.toLowerCase().includes(k)
        )
      ) {
        value = `${val}px`;
      }
      return `${kebabKey}: ${value};`;
    })
    .join(' ');
};

const getFormDefaultStyle = () => ({
  backgroundColor: '#ffffff',
  borderRadius: '20px',
  width: '100%',
  padding: '24px',
  paddingTop: '24px',
  paddingRight: '24px',
  paddingBottom: '24px',
  paddingLeft: '24px',
  fieldSpacing: '12px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#dbe4f0',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
  buttonBackgroundColor: '#0f172a',
  buttonTextColor: '#ffffff',
  buttonBorderRadius: '12px',
  buttonPaddingTop: '10px',
  buttonPaddingBottom: '10px',
  buttonPaddingLeft: '14px',
  buttonPaddingRight: '14px',
  buttonFontSize: '13px',
  buttonFontWeight: '700',
});

const escapeHtmlAttr = (value: string): string =>
  (value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const getOptionalAttr = (name: string, value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return ` ${name}="${escapeHtmlAttr(trimmed)}"`;
};

// HTML Element compiler
const compileElementToHTML = (elem: ElementJSON): string => {
  if (!elem || typeof elem !== 'object') return '';
  const elemStyle = elem.style || {};
  const styles = getInlineStyles(elem.type === 'form_container' ? { ...getFormDefaultStyle(), ...elemStyle } : elemStyle);
  const attrs = elem.attributes || {};

  switch (elem.type) {
    case 'heading':
      return `<h2 style="margin-top: 0; margin-bottom: 8px; ${styles}">${attrs.text || 'Heading'}</h2>`;
    case 'paragraph':
      return `<p style="margin-top: 0; margin-bottom: 12px; ${styles}">${attrs.text || 'Paragraph text content.'}</p>`;
    case 'text':
      return `<div style="${styles}">${attrs.text || ''}</div>`;
    case 'button':
      return `<div style="text-align: ${elemStyle.textAlign || 'center'};"><a href="${attrs.href || '#'
        }" target="${attrs.openInNewTab ? '_blank' : '_self'}" style="display: inline-block; text-decoration: none; ${styles}">${attrs.text || 'Button'
        }</a></div>`;
    case 'image': {
      const align =
        elemStyle.textAlign === 'center'
          ? 'margin: 0 auto; display: block;'
          : elemStyle.textAlign === 'right'
            ? 'margin-left: auto; display: block;'
            : 'display: inline-block;';
      return `<img src="${attrs.src || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
        }" alt="${attrs.alt || ''}" style="${styles} ${align}" />`;
    }
    case 'divider':
      return `<hr style="border: 0; border-top: ${elemStyle.borderWidth || '1px'} ${elemStyle.borderStyle || 'solid'
        } ${elemStyle.borderColor || '#334155'}; ${styles}" />`;
    case 'spacer':
      return `<div style="height: ${elemStyle.height || '24px'};"></div>`;
    case 'card':
      return `<div style="${styles}">
        <h3 style="margin-top: 0; margin-bottom: 8px; color: #ffffff;">${attrs.title || 'Card Title'}</h3>
        <p style="margin: 0; color: #94a3b8; font-size: 14px;">${attrs.description || 'Card description.'}</p>
      </div>`;
    default:
      return `<!-- Unsupported block ${elem.type} -->`;
  }
};

const compileRowToHTML = (rawRow: RowJSON | any): string => {
  if (!rawRow || typeof rawRow !== 'object') return '';
  const row = convertSectionRowToPlexoRow(rawRow);
  if (!row) return '';

  const rowStyle = getInlineStyles(row.style || {});
  const rowIdAttr = getOptionalAttr('id', row.htmlId);
  const rowClassAttr = getOptionalAttr('class', row.htmlClass);
  let html = `\n    <!-- ROW START: ${row.id || 'row'} -->`;
  html += `\n    <div${rowIdAttr}${rowClassAttr} class="plexo-row" style="display: flex; flex-wrap: wrap; margin-left: -8px; margin-right: -8px; ${rowStyle}">`;

  const columns = Array.isArray(row.columns) ? row.columns : [];
  for (const col of columns) {
    if (!col) continue;
    const colStyle = getInlineStyles(col.styles || col.style || {});
    const colIdAttr = getOptionalAttr('id', col.attrs?.htmlId);
    const colCustomClass = col.attrs?.htmlClass ? ` ${col.attrs.htmlClass}` : '';
    html += `\n      <!-- COLUMN START: ${col.id || 'col'} -->`;
    html += `\n      <div${colIdAttr} class="plexo-col${colCustomClass}" style="box-sizing: border-box; padding-left: 8px; padding-right: 8px; width: ${col.width || '100%'}; ${colStyle}">`;

    const elements = Array.isArray(col.elements) ? col.elements : [];
    for (const elem of elements) {
      if (!elem) continue;
      const elemAttrs = elem.attributes || {};
      const elementClass =
        typeof elemAttrs.htmlClassNames === 'string'
          ? elemAttrs.htmlClassNames
          : typeof elemAttrs.htmlClass === 'string'
            ? elemAttrs.htmlClass
            : typeof elemAttrs.className === 'string'
              ? elemAttrs.className
              : '';
      const elementIdAttr = getOptionalAttr('id', elemAttrs.htmlId);
      const elementClassAttr = getOptionalAttr('class', elementClass);
      html += `\n        <div${elementIdAttr}${elementClassAttr} style="margin-bottom: 16px;">`;
      html += `\n          ${compileElementToHTML(elem)}`;
      html += `\n        </div>`;
    }

    html += `\n      </div>`;
  }

  html += `\n    </div>`;
  return html;
};

export const compileToHTML = (rawTemplate: TemplateJSON | any): string => {
  if (!rawTemplate || typeof rawTemplate !== 'object') {
    return '<!-- Empty template -->';
  }

  const template = rawTemplate.designJson || rawTemplate.template || rawTemplate;
  const bodyObj = template.body || (Array.isArray(template.rows) ? { style: template.style || {}, rows: template.rows } : { style: {}, rows: [] });
  const bodyStyleObj = bodyObj.style || {};
  const bodyStyle = getInlineStyles(bodyStyleObj);

  const htmlTitle =
    typeof bodyStyleObj.htmlTitle === 'string' && bodyStyleObj.htmlTitle.trim()
      ? bodyStyleObj.htmlTitle.trim()
      : 'Plexo Rendered Page';
  const htmlIdAttr = getOptionalAttr('id', bodyStyleObj.htmlId);
  const htmlClassAttr = getOptionalAttr('class', bodyStyleObj.htmlClass);
  const customCss =
    typeof bodyStyleObj.customCss === 'string' && bodyStyleObj.customCss.trim()
      ? bodyStyleObj.customCss.trim()
      : '';
  const customJs =
    typeof bodyStyleObj.customJs === 'string' && bodyStyleObj.customJs.trim()
      ? bodyStyleObj.customJs.trim()
      : '';

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtmlAttr(htmlTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .plexo-row {
      display: flex;
      flex-wrap: wrap;
    }
    @media (max-width: 768px) {
      .plexo-row {
        flex-direction: column !important;
      }
      .plexo-col {
        width: 100% !important;
        max-width: 100% !important;
        margin-bottom: 16px;
      }
    }
  </style>
  ${customCss ? `<style>\n${customCss}\n  </style>` : ''}
</head>
<body${htmlIdAttr}${htmlClassAttr} style="${bodyStyle}">
  <div style="max-width: 1200px; margin: 0 auto; width: 100%;">`;

  const rows = Array.isArray(bodyObj.rows) ? bodyObj.rows : [];
  for (const row of rows) {
    html += compileRowToHTML(row);
  }

  html += `\n  </div>
${customJs ? `  <script>\n${customJs}\n  </script>` : ''}
</body>
</html>`;

  return html;
};
