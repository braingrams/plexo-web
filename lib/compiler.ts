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

const compileFormFields = (fields: Array<any>, defaultSharedStyles: string) => {
  let previousField: any = null;
  return fields
    .map((field) => {
      const resolved = field.inheritStylesFromPrevious && previousField
        ? {
            ...field,
            fontSize: previousField.fontSize,
            borderRadius: previousField.borderRadius,
            borderWidth: previousField.borderWidth,
            borderColor: previousField.borderColor,
            labelColor: previousField.labelColor,
            inputTextColor: previousField.inputTextColor,
            placeholderColor: previousField.placeholderColor,
          }
        : field;
      
      previousField = resolved;
      
      const required = resolved.required ? 'required' : '';
      const labelColor = resolved.labelColor || '#94a3b8';
      const labelFontSize = resolved.fontSize || '12px';
      const label = `<label style="display:block;font-size:${labelFontSize};color:${labelColor};margin-bottom:4px;">${resolved.label || resolved.name || 'Field'}${resolved.required ? ' *' : ''}</label>`;
      
      const fieldStyles = [
        `border-radius: ${resolved.borderRadius || '12px'}`,
        `border-width: ${resolved.borderWidth || '1px'}`,
        `border-color: ${resolved.borderColor || '#cbd5e1'}`,
        `color: ${resolved.inputTextColor || '#1e293b'}`,
        `font-size: ${resolved.fontSize || '13px'}`,
      ].join(';');
      
      const combinedStyles = `${defaultSharedStyles};${fieldStyles}`;

      if (resolved.kind === 'textarea') {
        return `<div style="margin-bottom:12px;">${label}<textarea name="${resolved.name || ''}" placeholder="${resolved.placeholder || ''}" ${required} style="width:100%;box-sizing:border-box;min-height:80px;${combinedStyles}"></textarea></div>`;
      }

      if (resolved.kind === 'select') {
        const options = ((resolved.options as Array<any>) || [])
          .map((option) => `<option value="${option.value}">${option.label}</option>`)
          .join('');
        return `<div style="margin-bottom:12px;">${label}<select name="${resolved.name || ''}" ${required} style="width:100%;box-sizing:border-box;${combinedStyles}">${options}</select></div>`;
      }

      if (resolved.kind === 'radio' || resolved.kind === 'checkbox') {
        const inputType = resolved.kind;
        const options = ((resolved.options as Array<any>) || [])
          .map(
            (option) =>
              `<label style="display:inline-flex;align-items:center;gap:8px;margin:0 12px 8px 0;font-size:12px;color:${resolved.inputTextColor || '#475569'};"><input type="${inputType}" name="${resolved.name || ''}" value="${option.value}" ${required} />${option.label}</label>`
          )
          .join('');
        return `<div style="margin-bottom:12px;">${label}<div>${options}</div></div>`;
      }

      const type = resolved.kind === 'email' ? 'email' : 'text';
      return `<div style="margin-bottom:12px;">${label}<input type="${type}" name="${resolved.name || ''}" placeholder="${resolved.placeholder || ''}" ${required} style="width:100%;box-sizing:border-box;${combinedStyles}" /></div>`;
    })
    .join('');
};

// Helper to convert style objects to inline style strings
const getInlineStyles = (styleObj: Record<string, any> = {}): string => {
  return Object.entries(styleObj)
    .filter(([_, val]) => val !== undefined && val !== null && val !== '')
    .map(([key, val]) => {
      const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      // Ensure dimensions have pixels if they are raw numbers
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
  value
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
  const styles = getInlineStyles(elem.type === 'form_container' ? { ...getFormDefaultStyle(), ...(elem.style || {}) } : elem.style);
  const attrs = elem.attributes || {};

  switch (elem.type) {
    case 'heading':
      return `<h2 style="margin-top: 0; margin-bottom: 8px; ${styles}">${attrs.text || 'Heading'}</h2>`;
    case 'paragraph':
      return `<p style="margin-top: 0; margin-bottom: 12px; ${styles}">${attrs.text || 'Paragraph text content.'}</p>`;
    case 'text':
      return `<div style="${styles}">${attrs.text || ''}</div>`;
    case 'button':
      return `<div style="text-align: ${elem.style.textAlign || 'center'};"><a href="${attrs.href || '#'
        }" target="${attrs.openInNewTab ? '_blank' : '_self'}" style="display: inline-block; text-decoration: none; ${styles}">${attrs.text || 'Button'
        }</a></div>`;
    case 'image': {
      const align =
        elem.style.textAlign === 'center'
          ? 'margin: 0 auto; display: block;'
          : elem.style.textAlign === 'right'
            ? 'margin-left: auto; display: block;'
            : 'display: inline-block;';
      return `<img src="${attrs.src || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
        }" alt="${attrs.alt || ''}" style="${styles} ${align}" />`;
    }
    case 'divider':
      return `<hr style="border: 0; border-top: ${elem.style.borderWidth || '1px'} ${elem.style.borderStyle || 'solid'
        } ${elem.style.borderColor || '#334155'}; ${styles}" />`;
    case 'spacer':
      return `<div style="height: ${elem.style.height || '24px'};"></div>`;
    case 'card':
      return `<div style="${styles}">
        <h3 style="margin-top: 0; margin-bottom: 8px; color: #ffffff;">${attrs.title || 'Card Title'}</h3>
        <p style="margin: 0; color: #94a3b8; font-size: 14px;">${attrs.description || 'Card description.'}</p>
      </div>`;
    case 'form_container':
      {
        const fields = (attrs.fields as Array<any>) || [];
        const actionMode = attrs.actionMode || 'submit';
        const formAction = actionMode === 'submit' ? attrs.actionUrl || '#' : '#';
        const formMethod = attrs.method || 'POST';
        const formExtras =
          actionMode === 'javascript'
            ? `onsubmit="${attrs.buttonFunction || 'handleSubmit'}(event); return false;"`
            : actionMode === 'redirect'
              ? `onsubmit="window.location.href='${attrs.redirectUrl || '#'}'; return false;"`
              : '';
        const fieldMarkup = compileFormFields(fields, 'padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;background:#fff;color:#1e293b;');
        const buttonType = actionMode === 'submit' ? 'submit' : 'button';
        const buttonAction =
          actionMode === 'javascript'
            ? `onclick="${attrs.buttonFunction || 'handleSubmit'}(event)"`
            : actionMode === 'redirect'
              ? `onclick="window.location.href='${attrs.redirectUrl || '#'}'"`
              : '';

        const btnStyles = [
          `display: inline-block`,
          `border: none`,
          `cursor: pointer`,
          `background-color: ${elem.style.buttonBackgroundColor || '#0f172a'}`,
          `color: ${elem.style.buttonTextColor || '#ffffff'}`,
          `border-radius: ${elem.style.buttonBorderRadius || '12px'}`,
          `font-size: ${elem.style.buttonFontSize || '13px'}`,
          `font-weight: ${elem.style.buttonFontWeight || '700'}`,
          `padding-top: ${elem.style.buttonPaddingTop || elem.style.buttonPadding || '10px'}`,
          `padding-bottom: ${elem.style.buttonPaddingBottom || elem.style.buttonPadding || '10px'}`,
          `padding-left: ${elem.style.buttonPaddingLeft || elem.style.buttonPadding || '14px'}`,
          `padding-right: ${elem.style.buttonPaddingRight || elem.style.buttonPadding || '14px'}`,
          elem.style.buttonMarginTop || elem.style.buttonMargin ? `margin-top: ${elem.style.buttonMarginTop || elem.style.buttonMargin}` : '',
          elem.style.buttonMarginBottom || elem.style.buttonMargin ? `margin-bottom: ${elem.style.buttonMarginBottom || elem.style.buttonMargin}` : '',
          elem.style.buttonMarginLeft || elem.style.buttonMargin ? `margin-left: ${elem.style.buttonMarginLeft || elem.style.buttonMargin}` : '',
          elem.style.buttonMarginRight || elem.style.buttonMargin ? `margin-right: ${elem.style.buttonMarginRight || elem.style.buttonMargin}` : '',
          attrs.buttonAutoWidth === false ? `width: ${elem.style.buttonWidth || '100%'}` : 'width: auto',
          attrs.buttonAutoHeight === false ? `height: ${elem.style.buttonHeight || 'auto'}` : '',
        ].filter(Boolean).join(';');

        const alignVal = elem.style.buttonAlign === 'center' ? 'center' : elem.style.buttonAlign === 'right' ? 'right' : 'left';

        return `<form name="${attrs.formName || 'form'}" action="${formAction}" method="${formMethod}" ${formExtras} style="${styles}">${fieldMarkup}<div style="width:100%;text-align:${alignVal};"><button type="${buttonType}" ${buttonAction} style="${btnStyles}">${attrs.submitLabel || 'Submit'}</button></div></form>`;
      }
    case 'input':
      return `<div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">${attrs.name || 'Field'
        }${attrs.required ? ' *' : ''}</label><input type="text" placeholder="${attrs.placeholder || ''
        }" ${attrs.required ? 'required' : ''} style="width: 100%; box-sizing: border-box; ${styles}" /></div>`;
    case 'textarea':
      return `<div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">${attrs.name || 'Field'
        }${attrs.required ? ' *' : ''}</label><textarea placeholder="${attrs.placeholder || ''
        }" ${attrs.required ? 'required' : ''} style="width: 100%; box-sizing: border-box; min-height: 80px; ${styles}"></textarea></div>`;
    case 'select': {
      const opts = (attrs.options as Array<{ label: string; value: string }>) || [];
      const optsHtml = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
      return `<div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">${attrs.name || 'Dropdown'
        }</label><select style="width: 100%; box-sizing: border-box; ${styles}">${optsHtml}</select></div>`;
    }
    case 'menu': {
      const links = (attrs.links as Array<{ label: string; href: string }>) || [];
      const linksHtml = links
        .map((l) => `<a href="${l.href || '#'}" style="color: inherit; text-decoration: none; padding: 0 12px;">${l.label}</a>`)
        .join('');
      return `<div style="display: flex; flex-wrap: wrap; justify-content: ${elem.style.textAlign === 'center'
          ? 'center'
          : elem.style.textAlign === 'right'
            ? 'flex-end'
            : 'flex-start'
        }; ${styles}">${linksHtml}</div>`;
    }
    case 'html':
      return attrs.htmlContent ? String(attrs.htmlContent) : '<!-- Raw HTML empty -->';
    case 'table': {
      const rowCount = Number(attrs.rowCount) || 2;
      const colCount = Number(attrs.colCount) || 2;
      const cellPadding = elem.style.cellPadding || '8px';
      const cellBorder = `${elem.style.borderWidth || '1px'} ${elem.style.borderStyle || 'solid'} ${elem.style.borderColor || '#334155'
        }`;
      let tableRows = '';
      for (let r = 0; r < rowCount; r++) {
        let cols = '';
        for (let c = 0; c < colCount; c++) {
          cols += `<td style="padding: ${cellPadding}; border: ${cellBorder};">Cell ${r + 1}, ${c + 1}</td>`;
        }
        tableRows += `<tr>${cols}</tr>`;
      }
      return `<table style="width: 100%; border-collapse: collapse; border: ${cellBorder}; ${styles}">${tableRows}</table>`;
    }
    case 'timer':
      return `<div style="text-align: center; ${styles}">
        <span style="font-size: 1.5em; font-weight: bold;">[Countdown Timer to ${attrs.targetDate || 'Future Target'}]</span>
      </div>`;
    case 'video':
      return `<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; ${styles}">
        <iframe src="${attrs.videoUrl || 'https://www.youtube.com/embed/dQw4w9WgXcQ'
        }" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen></iframe>
      </div>`;
    case 'social': {
      const links = (attrs.links as Array<{ provider: string; url: string; color?: string; backgroundColor?: string; iconType?: string; size?: string }>) || [];
      const linksHtml = links
        .map(
          (l) => {
            const linkColor = String(l.color || elem.style.iconColor || '#475569');
            const linkBackground = String(l.backgroundColor || elem.style.iconBackgroundColor || '#f8fafc');
            const linkSize = String(l.size || elem.style.iconSize || '32px');
            return (
              `<a href="${l.url || '#'
              }" style="display: inline-flex; align-items: center; justify-content: center; width: ${linkSize}; height: ${linkSize}; border-radius: ${(l.iconType || attrs.iconType) === 'square' ? '10px' : '9999px'}; background: ${linkBackground}; color: ${linkColor}; text-decoration: none;">${getSocialIconMarkup(l.provider, linkColor)}</a>`
            );
          }
        )
        .join('');
      return `<div style="text-align: ${elem.style.textAlign || 'center'}; display:flex; flex-wrap:wrap; justify-content:${elem.style.textAlign === 'center' ? 'center' : elem.style.textAlign === 'right' ? 'flex-end' : 'flex-start'}; gap:${elem.style.iconSpacing || '8px'}; ${styles}">${linksHtml}</div>`;
    }
    case 'carousel': {
      const slides = (attrs.images as Array<{ src: string; caption?: string }>) || [];
      const slidesHtml = slides
        .map(
          (s, idx) =>
            `<div style="display: ${idx === 0 ? 'block' : 'none'
            }; text-align: center;"><img src="${s.src}" style="max-width: 100%; height: auto; ${styles}" />${s.caption ? `<div style="font-size: 12px; margin-top: 4px;">${s.caption}</div>` : ''
            }</div>`
        )
        .join('');
      return `<div class="plexo-carousel" style="overflow: hidden;">${slidesHtml}</div>`;
    }
    case 'icon': {
      const iconName = attrs.iconName || 'star';
      const iconSize = elem.style.fontSize || '48px';
      const iconColor = elem.style.color || '#1e293b';
      const iconHref = attrs.href || '';
      const openInNewTab = !!attrs.openInNewTab;
      const align = elem.style.textAlign || 'center';
      const outerStyle = `text-align: ${align}; padding: ${elem.style.padding || '8px'}; margin: ${elem.style.margin || '0px'};`;
      
      const iconUrl = `https://cdn.jsdelivr.net/npm/lucide-static@0.415.0/icons/${iconName}.svg`;
      const sizePx = parseInt(iconSize) || 48;
      
      const imgStyle = `display: inline-block; vertical-align: middle; fill: ${iconColor}; color: ${iconColor}; width: ${sizePx}px; height: ${sizePx}px;`;
      const imgMarkup = `<img src="${iconUrl}" width="${sizePx}" height="${sizePx}" alt="${iconName}" style="${imgStyle}" />`;
      
      const nodeHtml = iconHref 
        ? `<a href="${iconHref}" target="${openInNewTab ? '_blank' : '_self'}" style="text-decoration: none;">${imgMarkup}</a>`
        : imgMarkup;
        
      return `<div style="${outerStyle}">${nodeHtml}</div>`;
    }
    default:
      return `<!-- Unsupported block ${elem.type} -->`;
  }
};

const compileRowToHTML = (row: RowJSON): string => {
  const rowStyle = getInlineStyles(row.style);
  const rowIdAttr = getOptionalAttr('id', row.htmlId);
  const rowClassAttr = getOptionalAttr('class', row.htmlClass);
  let html = `\n    <!-- ROW START: ${row.id} -->`;
  html += `\n    <div${rowIdAttr}${rowClassAttr} class="plexo-row" style="display: flex; flex-wrap: wrap; margin-left: -8px; margin-right: -8px; ${rowStyle}">`;

  for (const col of row.columns) {
    const colStyle = getInlineStyles(col.styles);
    const colIdAttr = getOptionalAttr('id', col.attrs?.htmlId);
    const colCustomClass = col.attrs?.htmlClass ? ` ${col.attrs.htmlClass}` : '';
    html += `\n      <!-- COLUMN START: ${col.id} -->`;
    html += `\n      <div${colIdAttr} class="plexo-col${colCustomClass}" style="box-sizing: border-box; padding-left: 8px; padding-right: 8px; width: ${col.width}; ${colStyle}">`;

    for (const elem of col.elements) {
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

    if (col.nestedRows && col.nestedRows.length > 0) {
      for (const nr of col.nestedRows) {
        html += compileRowToHTML(nr);
      }
    }

    html += `\n      </div>`;
  }

  html += `\n    </div>`;
  return html;
};

export const compileToHTML = (template: TemplateJSON): string => {
  const bodyStyle = getInlineStyles(template.body.style);
  const htmlTitle =
    typeof template.body.style?.htmlTitle === 'string' && template.body.style.htmlTitle.trim()
      ? template.body.style.htmlTitle.trim()
      : 'Plexo Rendered Page';
  const htmlIdAttr = getOptionalAttr('id', template.body.style?.htmlId);
  const htmlClassAttr = getOptionalAttr('class', template.body.style?.htmlClass);
  const customCss =
    typeof template.body.style?.customCss === 'string' && template.body.style.customCss.trim()
      ? template.body.style.customCss.trim()
      : '';
  const customJs =
    typeof template.body.style?.customJs === 'string' && template.body.style.customJs.trim()
      ? template.body.style.customJs.trim()
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

  for (const row of template.body.rows) {
    html += compileRowToHTML(row);
  }

  html += `\n  </div>
${customJs ? `  <script>\n${customJs}\n  </script>` : ''}
</body>
</html>`;

  return html;
};

// Plain Text Elements compiler
const compileElementToText = (elem: ElementJSON): string => {
  const attrs = elem.attributes || {};
  switch (elem.type) {
    case 'heading':
    case 'paragraph':
    case 'text':
      return attrs.text ? String(attrs.text) : '';
    case 'button':
      return `[ Button: ${attrs.text || 'Button'} -> ${attrs.href || '#'} ]`;
    case 'image':
      return `[ Image: ${attrs.alt || 'Unnamed Image'} (${attrs.src || ''}) ]`;
    case 'card':
      return `${attrs.title || 'Card Title'}\n${attrs.description || ''}`;
    case 'form_container':
      return `[ Form: ${attrs.formName || 'form'} (${attrs.actionUrl || ''}) ]`;
    case 'input':
    case 'textarea':
      return `${attrs.name || 'Field'}: __________`;
    case 'select': {
      const opts = (attrs.options as Array<{ label: string; value: string }>) || [];
      return `${attrs.name || 'Dropdown'}: [ ${opts.map((o) => o.label).join(' | ')} ]`;
    }
    case 'menu': {
      const links = (attrs.links as Array<{ label: string; href: string }>) || [];
      return `Menu: ${links.map((l) => l.label).join(' | ')}`;
    }
    case 'html':
      return '[ Raw HTML Block ]';
    case 'table': {
      const rowCount = Number(attrs.rowCount) || 2;
      const colCount = Number(attrs.colCount) || 2;
      return `[ Table of size ${rowCount}x${colCount} ]`;
    }
    case 'timer':
      return `[ Countdown Timer target: ${attrs.targetDate || 'Future Target'} ]`;
    case 'video':
      return `[ Video Link: ${attrs.videoUrl || ''} ]`;
    case 'social': {
      const links = (attrs.links as Array<{ provider: string; url: string }>) || [];
      return `Social Profiles: ${links.map((l) => `${l.provider.toUpperCase()} (${l.url || ''})`).join(', ')}`;
    }
    default:
      return '';
  }
};

export const compileToPlainText = (template: TemplateJSON): string => {
  const lines: string[] = [];

  const traverseRow = (row: RowJSON) => {
    for (const col of row.columns) {
      for (const elem of col.elements) {
        const text = compileElementToText(elem);
        if (text) lines.push(text);
      }
      if (col.nestedRows && col.nestedRows.length > 0) {
        for (const nr of col.nestedRows) {
          traverseRow(nr);
        }
      }
    }
  };

  for (const row of template.body.rows) {
    traverseRow(row);
  }

  return lines.join('\n\n');
};

/**
 * Detect if template uses Strata tokens or components
 */
export const detectStrataUsage = (template: TemplateJSON): boolean => {
  const detectInStyles = (styles: Record<string, any> = {}): boolean => {
    return Object.values(styles).some((val) => {
      if (typeof val === 'string' && val.includes('var(--strata-')) {
        return true;
      }
      if (typeof val === 'object') {
        return detectInStyles(val);
      }
      return false;
    });
  };

  const detectInRow = (row: RowJSON): boolean => {
    if (detectInStyles(row.style)) return true;
    for (const col of row.columns) {
      if (detectInStyles(col.styles)) return true;
      for (const elem of col.elements) {
        if (detectInStyles(elem.style)) return true;
        if (detectInStyles(elem.attributes)) return true;
      }
      if (col.nestedRows && col.nestedRows.length > 0) {
        for (const nr of col.nestedRows) {
          if (detectInRow(nr)) return true;
        }
      }
    }
    return false;
  };

  // Check body styles
  if (detectInStyles(template.body.style)) return true;

  // Check all rows and columns recursively
  for (const row of template.body.rows) {
    if (detectInRow(row)) return true;
  }

  return false;
};

/**
 * Inject Strata web component bundle and CSS variables into HTML
 * This ensures exported layouts using Strata tokens automatically style correctly
 */
export const injectStrataBundle = (html: string, projectId?: string): string => {
  if (!projectId) return html;

  // Generate Strata bundle injection code
  const stratuBundleScript = `
  <!-- Strata Design System Web Components Bundle -->
  <script defer src="https://cdn.strata.design/v1/strata-web-components.js"></script>
  <link rel="stylesheet" href="https://cdn.strata.design/v1/strata-tokens-${projectId}.css">
  <script>
    // Initialize Strata components when DOM is ready
    if (window.StrataWebComponents) {
      window.StrataWebComponents.init({
        projectId: '${projectId}',
        syncEnabled: true
      });
    }
  </script>`;

  // Inject before closing </head> tag
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${stratuBundleScript}\n</head>`);
  }

  return html;
};

/**
 * Export design with optional Strata bundle injection
 * Automatically detects if Strata is connected via localStorage
 */
export const compileToHTMLWithStrataAuto = (template: TemplateJSON): string => {
  let html = compileToHTML(template);

  // Check if Strata config is embedded in template
  const projectId = template.body.strataConfig?.projectId;
  if (projectId) {
    html = injectStrataBundle(html, projectId);
  }

  return html;
};
