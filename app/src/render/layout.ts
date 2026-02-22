export type RenderMode = 'preview' | 'new' | 'detail';

type RenderLayoutParams = {
  mode: RenderMode;
  templateId?: string;
  templateJson: any;
  dataJson?: Record<string, unknown>;
  externalRefsJson?: Record<string, unknown>;
  snapshotsJson?: Record<string, unknown>;
  editableKeys?: string[];
  readonlyKeys?: string[];
};

type LayoutNode = {
  type?: string;
  text?: string;
  title?: string;
  key?: string;
  width?: string | number;
  children?: LayoutNode[];
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: unknown) {
  return escapeHtml(value);
}

function normalizeLayoutNodes(templateJson: any): LayoutNode[] {
  const layout = templateJson?.layout;

  if (Array.isArray(layout)) {
    return layout as LayoutNode[];
  }

  if (layout && typeof layout === 'object' && Array.isArray(layout.sections)) {
    const nodes: LayoutNode[] = [];
    for (const section of layout.sections) {
      const title = typeof section?.title === 'string' ? section.title : undefined;
      const fields = Array.isArray(section?.fields)
        ? section.fields.filter((key: unknown): key is string => typeof key === 'string')
        : [];

      nodes.push({
        type: 'group',
        title,
        children: fields.map((key: string) => ({ type: 'field', key }))
      });
    }
    return nodes;
  }

  const fieldKeys = Object.keys(templateJson?.fields ?? {});
  return fieldKeys.map((key) => ({ type: 'field', key }));
}

function renderField(node: LayoutNode, params: RenderLayoutParams) {
  const fieldKey = typeof node.key === 'string' ? node.key : '';
  if (!fieldKey) return '';

  const field = (params.templateJson?.fields ?? {})[fieldKey] ?? {};
  const label = escapeHtml(field.label ?? fieldKey);
  const kind = String(field.kind ?? 'unknown');

  const dataValue = params.dataJson?.[fieldKey];
  const snapshotValue = params.snapshotsJson?.[fieldKey];
  const externalValue = params.externalRefsJson?.[fieldKey];
  const inEditable = (params.editableKeys ?? []).includes(fieldKey);
  const inReadonly = (params.readonlyKeys ?? []).includes(fieldKey);
  const isEditable = inEditable || (!inReadonly && kind === 'editable');

  if (params.mode === 'preview') {
    if (kind === 'lookup') {
      return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><select disabled><option>Lookup field</option></select></div>`;
    }

    if (field.multiline) {
      return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><textarea rows="3" disabled placeholder="Preview"></textarea></div>`;
    }

    return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><input type="text" disabled placeholder="Preview" /></div>`;
  }

  if (params.mode === 'new') {
    if (kind === 'lookup') {
      const templateId = params.templateId ?? '';
      const hxVals = JSON.stringify({ templateId, fieldKey });
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" hx-get="/api/lookup" hx-target="this" hx-swap="innerHTML" hx-include="#doc-form" hx-trigger="load, change from:#doc-form" hx-vals='${escapeAttr(hxVals)}'><option value="">Loading...</option></select></div>`;
    }

    if (kind === 'editable' && field.multiline) {
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><textarea id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" rows="4"></textarea></div>`;
    }

    if (kind === 'editable') {
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="text" /></div>`;
    }

    return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><input id="field-${escapeAttr(fieldKey)}" type="text" disabled value="(system field)" /></div>`;
  }

  if (kind === 'lookup') {
    const snapshot = escapeHtml(snapshotValue ?? '-');
    const hiddenValue = escapeAttr(externalValue ?? '');
    const debug = externalValue
      ? `<details class="muted"><summary>Debug</summary><div>ID: ${escapeHtml(externalValue)}</div></details>`
      : '';

    return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><div><strong>${snapshot}</strong></div><input type="hidden" name="lookup:${escapeAttr(fieldKey)}" value="${hiddenValue}" />${debug}</div>`;
  }

  if (kind === 'editable') {
    const roAttr = isEditable ? '' : ' readonly';
    if (field.multiline) {
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><textarea id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" rows="4"${roAttr}>${escapeHtml(dataValue ?? '')}</textarea></div>`;
    }
    return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(dataValue ?? '')}"${roAttr} /></div>`;
  }

  const readonlyValue = dataValue ?? snapshotValue ?? externalValue ?? '';
  return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><input id="field-${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(readonlyValue)}" readonly /></div>`;
}

function renderNode(node: LayoutNode, params: RenderLayoutParams): string {
  const type = typeof node?.type === 'string' ? node.type : '';

  if (type === 'h1') {
    return `<h1>${escapeHtml(node.text ?? '')}</h1>`;
  }

  if (type === 'h2') {
    return `<h2>${escapeHtml(node.text ?? '')}</h2>`;
  }

  if (type === 'text') {
    return `<p>${escapeHtml(node.text ?? '')}</p>`;
  }

  if (type === 'hint') {
    return `<p class="muted" style="font-size:0.9rem;">${escapeHtml(node.text ?? '')}</p>`;
  }

  if (type === 'divider') {
    return '<hr />';
  }

  if (type === 'field') {
    return renderField(node, params);
  }

  if (type === 'group') {
    const title = node.title ? `<h3>${escapeHtml(node.title)}</h3>` : '';
    const children = Array.isArray(node.children) ? node.children.map((child) => renderNode(child, params)).join('') : '';
    return `<div class="card">${title}${children}</div>`;
  }

  if (type === 'row') {
    const children = Array.isArray(node.children) ? node.children.map((child) => renderNode(child, params)).join('') : '';
    return `<div class="layout-row" style="display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap;">${children}</div>`;
  }

  if (type === 'col') {
    const width = node.width ? `flex:${escapeAttr(node.width)};` : 'flex:1;';
    const children = Array.isArray(node.children) ? node.children.map((child) => renderNode(child, params)).join('') : '';
    return `<div class="layout-col" style="${width} min-width:240px;">${children}</div>`;
  }

  if (process.env.NODE_ENV !== 'production') {
    return `<p class="muted" style="font-size:0.85rem;">Unsupported node type: ${escapeHtml(type || 'unknown')}</p>`;
  }

  return '';
}

export function renderLayout(params: RenderLayoutParams) {
  const nodes = normalizeLayoutNodes(params.templateJson);
  return nodes.map((node) => renderNode(node, params)).join('');
}
