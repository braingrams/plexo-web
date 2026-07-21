import type { ColumnJSON, ElementJSON, RowJSON, TemplateJSON } from '@charisol/plexo-sdk';

export type CompileTarget = 'landing_page' | 'email';

const EMAIL_STRIPPED_ATTR_KEYS = new Set([
  'selectable',
  'draggable',
  'duplicatable',
  'deletable',
  'hideable',
  'locked',
]);

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const styleObjectToInline = (style: Record<string, unknown> = {}): string =>
  Object.entries(style)
    .filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')
    .map(([key, val]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}:${String(val)};`)
    .join('');

const mergeClassNames = (...values: Array<unknown>): string =>
  values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');

const getAttrs = (element: ElementJSON, target: CompileTarget): Record<string, any> => {
  const attrs: Record<string, any> = { ...(element.attributes || {}) };
  if (target === 'email') {
    for (const key of EMAIL_STRIPPED_ATTR_KEYS) {
      delete attrs[key];
    }
  }
  return attrs;
};

const renderInputLike = (element: ElementJSON, target: CompileTarget): string => {
  const attrs = getAttrs(element, target);
  const style = styleObjectToInline(element.style || {});
  const inputClass = mergeClassNames(attrs.htmlClassNames, attrs.htmlClass, attrs.validationClass, attrs.validationClassName);
  const name = escapeHtml(attrs.name || attrs.fieldName || 'field');
  const placeholder = escapeHtml(attrs.placeholder || '');
  const required = attrs.required ? ' required' : '';

  if (target === 'email') {
    return `<mj-table><tr><td style="padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;color:#64748b;${style}">${placeholder || name}</td></tr></mj-table>`;
  }

  const type = escapeHtml(attrs.inputType || (element.type === 'input' ? attrs.type || 'text' : element.type));
  const id = attrs.htmlId ? ` id="${escapeHtml(attrs.htmlId)}"` : '';
  const cls = inputClass ? ` class="${escapeHtml(inputClass)}"` : '';

  if (element.type === 'textarea') {
    return `<textarea${id}${cls} name="${name}" placeholder="${placeholder}" style="${style}"${required}>${escapeHtml(attrs.value || '')}</textarea>`;
  }

  if (element.type === 'select') {
    const options = (attrs.options as Array<{ label: string; value: string }> | undefined) || [];
    const renderedOptions = options
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    return `<select${id}${cls} name="${name}" style="${style}"${required}>${renderedOptions}</select>`;
  }

  return `<input${id}${cls} type="${type}" name="${name}" placeholder="${placeholder}" value="${escapeHtml(attrs.value || '')}" style="${style}"${required} />`;
};

const renderFormContainer = (element: ElementJSON, target: CompileTarget): string => {
  const attrs = getAttrs(element, target);
  const style = styleObjectToInline(element.style || {});
  const formClass = mergeClassNames(attrs.htmlClassNames, attrs.htmlClass);
  const formId = attrs.htmlId ? ` id="${escapeHtml(attrs.htmlId)}"` : '';
  const classPart = formClass ? ` class="${escapeHtml(formClass)}"` : '';
  const action = escapeHtml(attrs.actionUrl || attrs.action || '#');
  const method = escapeHtml(attrs.method || 'POST');
  const fields = (attrs.fields as Array<Record<string, any>> | undefined) || [];
  const submitLabel = escapeHtml(attrs.submitLabel || 'Submit');

  if (target === 'email') {
    const rows = fields
      .map((field) => {
        const label = escapeHtml(field.label || field.name || 'Field');
        const placeholder = escapeHtml(field.placeholder || '');
        return `<tr><td style="padding:8px 0;font-family:Arial,sans-serif;color:#334155;"><strong>${label}</strong><br/><span style="display:inline-block;margin-top:4px;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;color:#64748b;">${placeholder || '&nbsp;'}</span></td></tr>`;
      })
      .join('');
    const ctaHref = escapeHtml(attrs.href || attrs.submitHref || '#');
    return `<mj-table><tr><td style="${style}"><table role="presentation" width="100%">${rows}<tr><td style="padding-top:12px;"><a href="${ctaHref}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;">${submitLabel}</a></td></tr></table></td></tr></mj-table>`;
  }

  const childBlocks = fields
    .map((field) => {
      const pseudoElement: ElementJSON = {
        id: `${element.id}-${String(field.name || field.label || 'field')}`,
        type: (field.kind === 'textarea' || field.kind === 'select' ? field.kind : 'input') as ElementJSON['type'],
        style: {
          ...(element.style || {}),
          ...(field.style || {}),
        },
        attributes: field,
      };
      return renderInputLike(pseudoElement, 'landing_page');
    })
    .join('');

  return `<form${formId}${classPart} action="${action}" method="${method}" style="${style}">${childBlocks}<button type="submit">${submitLabel}</button></form>`;
};

const renderElement = (element: ElementJSON, target: CompileTarget): string => {
  const attrs = getAttrs(element, target);
  const style = styleObjectToInline(element.style || {});
  const id = attrs.htmlId ? ` id="${escapeHtml(attrs.htmlId)}"` : '';
  const classNames = mergeClassNames(
    attrs.htmlClassNames,
    attrs.htmlClass,
    target === 'landing_page' && attrs.hideOnMobile ? 'hidden md:block' : ''
  );
  const classPart = classNames ? ` class="${escapeHtml(classNames)}"` : '';
  const customCss = typeof attrs.customCss === 'string' && attrs.customCss.trim() ? attrs.customCss.trim() : '';
  const customCssBlock = customCss && target === 'landing_page' ? `<style>${customCss}</style>` : '';

  if (element.type === 'form_container') {
    return `${customCssBlock}${renderFormContainer(element, target)}`;
  }

  if (element.type === 'input' || element.type === 'select' || element.type === 'textarea') {
    return `${customCssBlock}${renderInputLike(element, target)}`;
  }

  if (target === 'email') {
    if (element.type === 'button') {
      const href = escapeHtml(attrs.href || '#');
      const text = escapeHtml(attrs.text || 'Button');
      return `<mj-button href="${href}" css-class="${attrs.hideOnDesktop ? 'desktop-hide' : ''}" padding="0" inner-padding="10px 16px">${text}</mj-button>`;
    }
    if (element.type === 'image') {
      return `<mj-image src="${escapeHtml(attrs.src || '')}" alt="${escapeHtml(attrs.alt || '')}" />`;
    }
    return `<mj-text${id}${classPart} css-class="${attrs.hideOnDesktop ? 'desktop-hide' : ''}">${escapeHtml(attrs.text || attrs.htmlContent || '')}</mj-text>`;
  }

  switch (element.type) {
    case 'heading':
      return `${customCssBlock}<h2${id}${classPart} style="${style}">${escapeHtml(attrs.text || 'Heading')}</h2>`;
    case 'paragraph':
    case 'text':
      return `${customCssBlock}<p${id}${classPart} style="${style}">${escapeHtml(attrs.text || '')}</p>`;
    case 'button':
      return `${customCssBlock}<a${id}${classPart} href="${escapeHtml(attrs.href || '#')}" style="${style}">${escapeHtml(attrs.text || 'Button')}</a>`;
    case 'image':
      return `${customCssBlock}<img${id}${classPart} src="${escapeHtml(attrs.src || '')}" alt="${escapeHtml(attrs.alt || '')}" style="${style}" />`;
    case 'html':
      return `${customCssBlock}<div${id}${classPart} style="${style}">${String(attrs.htmlContent || '')}</div>`;
    default:
      return `${customCssBlock}<div${id}${classPart} style="${style}">${escapeHtml(attrs.text || '')}</div>`;
  }
};

const renderColumn = (column: ColumnJSON, target: CompileTarget): string => {
  if (target === 'email') {
    const elements = column.elements.map((element) => renderElement(element, target)).join('');
    return `<mj-column width="${escapeHtml(column.width || '100%')}">${elements}</mj-column>`;
  }

  const style = styleObjectToInline(column.styles || {});
  const elements = column.elements.map((element) => renderElement(element, target)).join('');
  return `<div style="width:${escapeHtml(column.width || '100%')};${style}">${elements}</div>`;
};

const renderRow = (row: RowJSON, target: CompileTarget): string => {
  if (target === 'email') {
    const cssClass = row.style?.hideOnDesktop ? 'desktop-hide' : '';
    const columns = row.columns.map((column) => renderColumn(column, target)).join('');
    return `<mj-section css-class="${cssClass}">${columns}</mj-section>`;
  }

  const style = styleObjectToInline(row.style || {});
  const columns = row.columns.map((column) => renderColumn(column, target)).join('');
  return `<section style="display:flex;flex-wrap:wrap;${style}">${columns}</section>`;
};

export const parseJsonToTargetFormat = (json: TemplateJSON, target: CompileTarget): string => {
  const rows = (json.body?.rows || []).map((row) => renderRow(row, target)).join('');
  const bodyStyle = styleObjectToInline(json.body?.style || {});

  if (target === 'email') {
    return `<mjml><mj-head><mj-style>.desktop-hide { display:none !important; max-height:0; overflow:hidden; }</mj-style></mj-head><mj-body><mj-section><mj-column><mj-wrapper css-class="email-root" padding="0"><mj-text css-class="preheader" padding="0" font-size="1px" color="#ffffff">&nbsp;</mj-text></mj-wrapper></mj-column></mj-section>${rows}</mj-body></mjml>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="${bodyStyle}"><main>${rows}</main></body></html>`;
};
