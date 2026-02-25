export type RenderMode = 'preview' | 'new' | 'detail';

type RenderLayoutParams = {
  mode: RenderMode;
  templateId?: string;
  documentId?: string;
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
  hideIfEmpty?: boolean;
  label?: string;
  action?: string;
  variant?: string;
  width?: string | number;
  targets?: string[];
  params?: Record<string, unknown>;
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

function isEmptyDisplayValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

function hasDisplayValueForField(fieldKey: string, params: RenderLayoutParams) {
  const field = (params.templateJson?.fields ?? {})[fieldKey] ?? {};
  const kind = String(field.kind ?? 'unknown');
  const dataValue = params.dataJson?.[fieldKey];
  const snapshotValue = params.snapshotsJson?.[fieldKey];
  const externalValue = params.externalRefsJson?.[fieldKey];

  if (kind === 'lookup') {
    return !isEmptyDisplayValue(snapshotValue) || !isEmptyDisplayValue(externalValue);
  }

  if (kind === 'system' || kind === 'workflow') {
    return !isEmptyDisplayValue(dataValue) || !isEmptyDisplayValue(snapshotValue) || !isEmptyDisplayValue(externalValue);
  }

  return !isEmptyDisplayValue(dataValue);
}

function hasAnyNonEmptyFieldInNode(node: LayoutNode, params: RenderLayoutParams): boolean {
  const type = typeof node?.type === 'string' ? node.type : '';
  if (type === 'field') {
    const fieldKey = typeof node.key === 'string' ? node.key : '';
    if (!fieldKey) return false;
    return hasDisplayValueForField(fieldKey, params);
  }

  const children = Array.isArray(node.children) ? node.children : [];
  return children.some((child) => hasAnyNonEmptyFieldInNode(child, params));
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
  const isSystemLike = kind === 'system' || kind === 'workflow';

  if (params.mode === 'preview') {
    if (isSystemLike) {
      return `<div class="row"><label>${label}</label><div class="muted">${escapeHtml(dataValue ?? snapshotValue ?? externalValue ?? '—')}</div></div>`;
    }

    if (kind === 'lookup') {
      return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><select disabled><option>Lookup field</option></select></div>`;
    }

    if (field.multiline) {
      return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><textarea rows="3" disabled placeholder="Preview"></textarea></div>`;
    }

    return `<div class="row"><label>${label} (<code>${escapeHtml(kind)}</code>)</label><input type="text" disabled placeholder="Preview" /></div>`;
  }

  if (params.mode === 'new') {
    if (isSystemLike) {
      const display = dataValue ?? snapshotValue ?? externalValue;
      if (isEmptyDisplayValue(display)) {
        return '';
      }
      return `<div class="row"><label>${label}</label><div>${escapeHtml(display)}</div></div>`;
    }

    if (kind === 'lookup') {
      const templateId = params.templateId ?? '';
      const hxVals = JSON.stringify({ templateId, fieldKey });
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" hx-get="/api/lookup" hx-target="this" hx-swap="innerHTML" hx-include="#doc-form" hx-trigger="load, change from:#doc-form, reloadLookup" hx-vals='${escapeAttr(hxVals)}'><option value="">Loading...</option></select></div>`;
    }

    if (kind === 'editable' && field.multiline) {
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><textarea id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" rows="4"></textarea></div>`;
    }

    if (kind === 'editable') {
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="text" /></div>`;
    }

    return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label}</label><input id="field-${escapeAttr(fieldKey)}" type="text" disabled value="" /></div>`;
  }

  if (kind === 'lookup') {
    if (isEditable) {
      const templateId = params.templateId ?? '';
      const hxVals = JSON.stringify({ templateId, fieldKey });
      const selectedLabel = escapeHtml(snapshotValue ?? 'Loading...');
      return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" hx-get="/api/lookup" hx-target="this" hx-swap="innerHTML" hx-include="closest form" hx-trigger="load, change from:closest form, reloadLookup" hx-vals='${escapeAttr(hxVals)}'><option value="${escapeAttr(externalValue ?? '')}">${selectedLabel}</option></select></div>`;
    }

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

  if (isSystemLike) {
    const display = dataValue ?? snapshotValue ?? externalValue;
    return `<div class="row"><label>${label}</label><div>${escapeHtml(isEmptyDisplayValue(display) ? '—' : display)}</div></div>`;
  }

  const readonlyValue = dataValue ?? snapshotValue ?? externalValue ?? '';
  return `<div class="row"><label for="field-${escapeAttr(fieldKey)}">${label} (<code>${escapeHtml(kind)}</code>)</label><input id="field-${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(readonlyValue)}" readonly /></div>`;
}

function resolveControlKeyFromAction(templateJson: any, action: string) {
  const controls = (templateJson?.controls ?? {}) as Record<string, { action?: string }>;
  if (controls[action]) return action;

  for (const [controlKey, config] of Object.entries(controls)) {
    if (config?.action === action) {
      return controlKey;
    }
  }

  return action;
}

function findLookupTargetsInActionDef(actionDef: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.fieldKey === 'string') {
      found.add(record.fieldKey);
    }
    if (Array.isArray(record.targets)) {
      for (const target of record.targets) {
        if (typeof target === 'string') found.add(target);
      }
    }

    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };

  visit(actionDef);
  return Array.from(found);
}

function inferLookupTargets(node: LayoutNode, params: RenderLayoutParams): string[] {
  const fields = (params.templateJson?.fields ?? {}) as Record<string, { kind?: string }>;
  const lookupKeys = Object.keys(fields).filter((key) => fields[key]?.kind === 'lookup');
  const available = new Set(lookupKeys);
  const targets = new Set<string>();

  if (Array.isArray(node.targets)) {
    for (const key of node.targets) {
      if (typeof key === 'string' && available.has(key)) targets.add(key);
    }
  }

  const action = typeof node.action === 'string' ? node.action : '';
  if (action && available.has(action)) {
    targets.add(action);
  }

  if (node.params && typeof node.params.fieldKey === 'string' && available.has(node.params.fieldKey)) {
    targets.add(node.params.fieldKey);
  }
  if (node.params && Array.isArray(node.params.targets)) {
    for (const key of node.params.targets) {
      if (typeof key === 'string' && available.has(key)) targets.add(key);
    }
  }

  if (action) {
    const actionDef = (params.templateJson?.actions ?? {})[action];
    for (const key of findLookupTargetsInActionDef(actionDef)) {
      if (available.has(key)) targets.add(key);
    }
  }

  if (targets.size === 0 && action) {
    const lowered = action.toLowerCase();
    for (const key of lookupKeys) {
      const normalizedKey = key.toLowerCase().replace(/_id$/, '');
      if (lowered.includes(normalizedKey)) {
        targets.add(key);
      }
    }
  }

  return Array.from(targets);
}

function renderButton(node: LayoutNode, params: RenderLayoutParams) {
  const label = escapeHtml(node.label ?? node.key ?? node.action ?? 'Button');
  const action = typeof node.action === 'string' ? node.action : undefined;
  const variantClass = node.variant ? ` btn-${escapeAttr(node.variant)}` : '';

  if (!action) {
    return `<button type="button" class="layout-btn${variantClass}" disabled>${label}</button>`;
  }

  if (params.mode === 'detail' && params.documentId) {
    const controlKey = resolveControlKeyFromAction(params.templateJson, action);
    const endpoint = `/documents/${encodeURIComponent(params.documentId)}/action/${encodeURIComponent(controlKey)}`;
    return `<button type="button" class="layout-btn${variantClass}" hx-post="${escapeAttr(endpoint)}" hx-include="closest form" hx-swap="none">${label}</button>`;
  }

  if (params.mode === 'new') {
    const targetKeys = inferLookupTargets(node, params);
    if (targetKeys.length > 0) {
      const script = targetKeys
        .map((key) => `htmx.trigger('#field-${key}', 'reloadLookup')`)
        .join('; ');
      return `<button type="button" class="layout-btn${variantClass}" hx-on:click="${escapeAttr(script)}">${label}</button>`;
    }
  }

  if (params.mode === 'detail') {
    const targetKeys = inferLookupTargets(node, params);
    if (targetKeys.length > 0) {
      const script = targetKeys
        .map((key) => `htmx.trigger('#field-${key}', 'reloadLookup')`)
        .join('; ');
      return `<button type="button" class="layout-btn${variantClass}" hx-on:click="${escapeAttr(script)}">${label}</button>`;
    }
  }

  return `<button type="button" class="layout-btn${variantClass}" disabled>${label}</button>`;
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
    const hideIfEmpty = node.hideIfEmpty === true || String(node.title ?? '').trim().toLowerCase() === 'erp';
    if (hideIfEmpty) {
      const childrenForCheck = Array.isArray(node.children) ? node.children : [];
      const hasValues = childrenForCheck.some((child) => hasAnyNonEmptyFieldInNode(child, params));
      if (!hasValues) {
        return '';
      }
    }

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

  if (type === 'button') {
    return renderButton(node, params);
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
