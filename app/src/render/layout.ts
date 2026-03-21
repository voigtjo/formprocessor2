export type RenderMode = 'preview' | 'new' | 'detail';

type RenderLayoutParams = {
  mode: RenderMode;
  templateId?: string;
  documentId?: string;
  documentStatus?: string;
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
  kind?: string;
  width?: string | number;
  align?: string;
  targets?: string[];
  params?: Record<string, unknown>;
  confirm?: string;
  children?: LayoutNode[];
  size?: string;
};

type ResolvedFieldOption = {
  value: string;
  label: string;
  hint: string;
};

type JournalColumn = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  placeholder?: string;
  width?: string | number;
  options?: ResolvedFieldOption[];
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

function isCheckedValue(value: unknown) {
  if (value === true) return true;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
        }
      } catch {
        // Fall back to comma-separated parsing below.
      }
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function isEditableFieldKind(kind: string) {
  return kind === 'editable' || kind === 'date' || kind === 'checkbox' || kind === 'journal';
}

function resolveUiInput(field: any) {
  const input = field?.inputType ?? field?.control ?? field?.ui?.input ?? field?.kind;
  if (field?.multiline === true || input === 'textarea') return 'textarea';
  if (input === 'date' || input === 'checkbox' || input === 'radioGroup' || input === 'checkboxGroup' || input === 'journal') {
    return input;
  }
  return 'text';
}

function resolveJournalColumns(field: any): JournalColumn[] {
  const rawColumns = Array.isArray(field?.columns) ? field.columns : Array.isArray(field?.journal?.columns) ? field.journal.columns : [];
  return rawColumns
    .map((column: any) => {
      if (!column || typeof column !== 'object') return null;
      const key = typeof column.key === 'string' ? column.key.trim() : '';
      if (!key) return null;
      const typeRaw = typeof column.type === 'string' ? column.type.trim().toLowerCase() : 'text';
      const type: JournalColumn['type'] =
        typeRaw === 'number' || typeRaw === 'select' || typeRaw === 'checkbox' ? (typeRaw as JournalColumn['type']) : 'text';
      return {
        key,
        label: typeof column.label === 'string' && column.label.trim().length > 0 ? column.label : key,
        type,
        placeholder: typeof column.placeholder === 'string' ? column.placeholder : undefined,
        width: column.width,
        options: type === 'select' ? resolveFieldOptions(column) : undefined
      };
    })
    .filter((column): column is JournalColumn => !!column);
}

function normalizeJournalRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
  }
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
      }
    } catch {
      return [];
    }
  }
  return [];
}

function resolveFieldRows(field: any) {
  const raw = Number(field?.rows ?? field?.ui?.rows ?? (field?.multiline ? 4 : 3));
  if (!Number.isFinite(raw)) return field?.multiline ? 4 : 3;
  return Math.max(2, Math.min(12, Math.round(raw)));
}

function resolveFieldOptions(field: any) {
  const options = Array.isArray(field?.options) ? field.options : [];
  return options
    .map((option: any) => {
      if (!option || typeof option !== 'object') return null;
      const value = typeof option.value === 'string' ? option.value : String(option.value ?? '');
      const label = typeof option.label === 'string' ? option.label : value;
      const hint = typeof option.hint === 'string' ? option.hint : '';
      return { value, label, hint };
    })
    .filter((option): option is ResolvedFieldOption => !!option && option.value.length > 0);
}

function resolveFieldHelpText(field: any) {
  if (typeof field?.helpText === 'string' && field.helpText.trim().length > 0) return field.helpText.trim();
  if (typeof field?.hint === 'string' && field.hint.trim().length > 0) return field.hint.trim();
  if (typeof field?.description === 'string' && field.description.trim().length > 0) return field.description.trim();
  return '';
}

function resolveFieldPlaceholder(field: any) {
  if (typeof field?.placeholder === 'string') return field.placeholder;
  if (typeof field?.ui?.placeholder === 'string') return field.ui.placeholder;
  return '';
}

function resolveFieldDisplayValue(field: any, rawValue: unknown) {
  const uiInput = resolveUiInput(field);
  const options = resolveFieldOptions(field);
  const byValue = new Map(options.map((option) => [option.value, option.label]));

  if (uiInput === 'checkbox') {
    return isCheckedValue(rawValue) ? 'Yes' : 'No';
  }

  if (uiInput === 'radioGroup') {
    const normalized = String(rawValue ?? '').trim();
    return byValue.get(normalized) ?? normalized;
  }

  if (uiInput === 'checkboxGroup') {
    const selectedValues = normalizeStringArray(rawValue);
    const labels = selectedValues
      .map((value) => byValue.get(value) ?? value)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return labels.length > 0 ? labels.join(', ') : '';
  }

  if (uiInput === 'journal') {
    const rows = normalizeJournalRows(rawValue);
    return rows.length > 0 ? `${rows.length} rows` : '';
  }

  return rawValue;
}

function resolveAlignClass(align: unknown, scope: 'row' | 'col' | 'field') {
  const normalized = typeof align === 'string' ? align.trim().toLowerCase() : '';
  if (normalized === 'left' || normalized === 'center' || normalized === 'right') {
    return `${scope}-align-${normalized}`;
  }
  return '';
}

function resolveColumnWidthStyle(width: unknown) {
  if (typeof width === 'number' && Number.isFinite(width)) {
    const clamped = Math.max(1, Math.min(12, Math.round(width)));
    const percentage = (clamped / 12) * 100;
    return `--col-span:${clamped};--col-basis:${percentage}%;`;
  }

  if (typeof width !== 'string') return '';
  const normalized = width.trim().toLowerCase();
  if (!normalized) return '';

  const ratioMap: Record<string, number> = {
    full: 100,
    half: 50,
    '1/2': 50,
    third: 33.3333,
    '1/3': 33.3333,
    '2/3': 66.6667,
    quarter: 25,
    '1/4': 25,
    '3/4': 75
  };

  if (ratioMap[normalized]) {
    const percentage = ratioMap[normalized];
    const span = Math.max(1, Math.min(12, Math.round((percentage / 100) * 12)));
    return `--col-span:${span};--col-basis:${percentage}%;`;
  }

  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber) && normalized !== '') {
    const clamped = Math.max(1, Math.min(12, Math.round(asNumber)));
    const percentage = (clamped / 12) * 100;
    return `--col-span:${clamped};--col-basis:${percentage}%;`;
  }

  if (normalized.endsWith('%')) {
    return `--col-basis:${escapeAttr(normalized)};`;
  }

  return '';
}

function renderFieldHelp(field: any) {
  const helpText = resolveFieldHelpText(field);
  return helpText ? `<div class="field-help muted">${escapeHtml(helpText)}</div>` : '';
}

function wrapFieldContent(fieldKey: string, label: string, innerHtml: string, field: any, node: LayoutNode) {
  const alignClass = resolveAlignClass(node.align ?? field?.align ?? field?.ui?.align, 'field');
  const classes = ['row', 'form-field'];
  if (alignClass) classes.push(alignClass);
  const uiInput = resolveUiInput(field);
  const isChoiceGroup = uiInput === 'radioGroup' || uiInput === 'checkboxGroup';
  const labelAttr = isChoiceGroup ? '' : ` for="field-${escapeAttr(fieldKey)}"`;
  return `<div class="${classes.join(' ')}"><label${labelAttr}>${label}</label>${innerHtml}${renderFieldHelp(field)}</div>`;
}

function renderOptionHint(hint: string) {
  return hint ? `<span class="choice-hint muted">${escapeHtml(hint)}</span>` : '';
}

function renderRadioGroup(fieldKey: string, field: any, value: unknown, isEditable: boolean) {
  const options = resolveFieldOptions(field);
  const selected = String(value ?? '').trim();
  const disabledAttr = isEditable ? '' : ' disabled';
  return `<div class="choice-group" role="radiogroup">${options
    .map((option: ResolvedFieldOption, index: number) => {
      const checked = option.value === selected ? ' checked' : '';
      const id = `field-${escapeAttr(fieldKey)}-${index}`;
      return `<label class="choice-option" for="${id}"><input id="${id}" type="radio" name="data:${escapeAttr(fieldKey)}" value="${escapeAttr(option.value)}"${checked}${disabledAttr} /><span class="choice-label">${escapeHtml(option.label)}</span>${renderOptionHint(option.hint)}</label>`;
    })
    .join('')}</div>`;
}

function renderCheckboxGroup(fieldKey: string, field: any, value: unknown, isEditable: boolean) {
  const options = resolveFieldOptions(field);
  const selected = new Set(normalizeStringArray(value));
  const disabledAttr = isEditable ? '' : ' disabled';
  return `<div class="choice-group" role="group">${options
    .map((option: ResolvedFieldOption, index: number) => {
      const checked = selected.has(option.value) ? ' checked' : '';
      const id = `field-${escapeAttr(fieldKey)}-${index}`;
      return `<label class="choice-option" for="${id}"><input id="${id}" type="checkbox" name="data:${escapeAttr(fieldKey)}" value="${escapeAttr(option.value)}"${checked}${disabledAttr} /><span class="choice-label">${escapeHtml(option.label)}</span>${renderOptionHint(option.hint)}</label>`;
    })
    .join('')}</div>`;
}

function renderJournalReadonly(fieldKey: string, field: any, value: unknown) {
  const columns = resolveJournalColumns(field);
  const rows = normalizeJournalRows(value);
  if (columns.length === 0) {
    return `<div class="muted">No journal columns configured.</div>`;
  }
  if (rows.length === 0) {
    return `<div class="muted">No rows recorded.</div>`;
  }

  const tableHead = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const tableRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const cellValue = row[column.key];
          if (column.type === 'checkbox') {
            return `<td>${escapeHtml(isCheckedValue(cellValue) ? 'Yes' : 'No')}</td>`;
          }
          if (column.type === 'select' && Array.isArray(column.options)) {
            const option = column.options.find((item) => item.value === String(cellValue ?? ''));
            return `<td>${escapeHtml(option?.label ?? cellValue ?? '—')}</td>`;
          }
          return `<td>${escapeHtml(cellValue ?? '—')}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="journal-wrapper"><table class="journal-table"><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
}

function renderJournalEditable(fieldKey: string, field: any, value: unknown, mode: RenderMode) {
  const columns = resolveJournalColumns(field);
  const rows = normalizeJournalRows(value);
  const inputValue = escapeAttr(JSON.stringify(rows));
  const config = escapeAttr(JSON.stringify({ columns, fieldKey, mode }));
  const emptyMessage = escapeHtml(typeof field?.emptyText === 'string' ? field.emptyText : 'No rows yet.');
  return `<div class="journal-control" id="journal-${escapeAttr(fieldKey)}" data-journal-config="${config}" data-journal-empty="${emptyMessage}">
    <input id="field-${escapeAttr(fieldKey)}" type="hidden" name="data:${escapeAttr(fieldKey)}" value="${inputValue}" />
    <div class="journal-wrapper">
      <table class="journal-table">
        <thead></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="actions journal-actions">
      <button type="button" class="btn btn-secondary" data-journal-add>Add row</button>
    </div>
  </div>
  <script>
    (function () {
      var root = document.getElementById('journal-${escapeAttr(fieldKey)}');
      if (!root || root.dataset.bound === '1') return;
      root.dataset.bound = '1';
      var config = JSON.parse(root.getAttribute('data-journal-config') || '{}');
      var hidden = root.querySelector('input[type="hidden"]');
      var table = root.querySelector('table');
      var thead = table && table.querySelector('thead');
      var tbody = table && table.querySelector('tbody');
      var addButton = root.querySelector('[data-journal-add]');
      if (!hidden || !table || !thead || !tbody || !addButton) return;

      function safeRows() {
        try {
          var parsed = JSON.parse(hidden.value || '[]');
          return Array.isArray(parsed) ? parsed.filter(function (row) { return row && typeof row === 'object' && !Array.isArray(row); }) : [];
        } catch (_error) {
          return [];
        }
      }

      function writeRows(rows) {
        hidden.value = JSON.stringify(rows);
      }

      function defaultValueFor(column) {
        return column.type === 'checkbox' ? false : '';
      }

      function render() {
        var columns = Array.isArray(config.columns) ? config.columns : [];
        var rows = safeRows();
        thead.innerHTML = '';
        tbody.innerHTML = '';

        var headRow = document.createElement('tr');
        columns.forEach(function (column) {
          var th = document.createElement('th');
          th.textContent = column.label || column.key;
          headRow.appendChild(th);
        });
        var actionHead = document.createElement('th');
        actionHead.textContent = 'Actions';
        headRow.appendChild(actionHead);
        thead.appendChild(headRow);

        if (rows.length === 0) {
          var emptyRow = document.createElement('tr');
          var emptyCell = document.createElement('td');
          emptyCell.colSpan = columns.length + 1;
          emptyCell.className = 'muted';
          emptyCell.textContent = root.getAttribute('data-journal-empty') || 'No rows yet.';
          emptyRow.appendChild(emptyCell);
          tbody.appendChild(emptyRow);
          return;
        }

        rows.forEach(function (row, rowIndex) {
          var tr = document.createElement('tr');
          columns.forEach(function (column) {
            var td = document.createElement('td');
            var currentValue = row[column.key];
            var input;
            if (column.type === 'checkbox') {
              input = document.createElement('input');
              input.type = 'checkbox';
              input.checked = currentValue === true || String(currentValue || '').toLowerCase() === 'true' || String(currentValue || '') === '1';
              input.addEventListener('change', function () {
                var nextRows = safeRows();
                nextRows[rowIndex][column.key] = input.checked;
                writeRows(nextRows);
              });
            } else if (column.type === 'select') {
              input = document.createElement('select');
              var options = Array.isArray(column.options) ? column.options : [];
              options.forEach(function (option) {
                var optionNode = document.createElement('option');
                optionNode.value = option.value;
                optionNode.textContent = option.label;
                if (String(currentValue || '') === option.value) optionNode.selected = true;
                input.appendChild(optionNode);
              });
              input.addEventListener('change', function () {
                var nextRows = safeRows();
                nextRows[rowIndex][column.key] = input.value;
                writeRows(nextRows);
              });
            } else {
              input = document.createElement('input');
              input.type = column.type === 'number' ? 'number' : 'text';
              input.value = currentValue == null ? '' : String(currentValue);
              if (column.placeholder) input.placeholder = column.placeholder;
              input.addEventListener('input', function () {
                var nextRows = safeRows();
                nextRows[rowIndex][column.key] = input.value;
                writeRows(nextRows);
              });
            }
            td.appendChild(input);
            tr.appendChild(td);
          });

          var actionTd = document.createElement('td');
          var removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'btn btn-secondary';
          removeButton.textContent = 'Remove';
          removeButton.addEventListener('click', function () {
            var nextRows = safeRows();
            nextRows.splice(rowIndex, 1);
            writeRows(nextRows);
            render();
          });
          actionTd.appendChild(removeButton);
          tr.appendChild(actionTd);
          tbody.appendChild(tr);
        });
      }

      addButton.addEventListener('click', function () {
        var columns = Array.isArray(config.columns) ? config.columns : [];
        var nextRows = safeRows();
        var nextRow = {};
        columns.forEach(function (column) {
          nextRow[column.key] = defaultValueFor(column);
        });
        nextRows.push(nextRow);
        writeRows(nextRows);
        render();
      });

      render();
    })();
  </script>`;
}

function normalizeLayoutNodes(templateJson: any): LayoutNode[] {
  const normalizeCellAlign = (value: unknown) => {
    if (typeof value === 'string' && ['left', 'center', 'right'].includes(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const horizontal = (value as Record<string, unknown>).horizontal;
      if (typeof horizontal === 'string' && ['left', 'center', 'right'].includes(horizontal)) return horizontal;
    }
    return undefined;
  };
  const formRows = Array.isArray(templateJson?.form?.rows) ? templateJson.form.rows : null;
  if (formRows) {
    return formRows
      .map((row: any) => {
        if (!row || typeof row !== 'object' || !Array.isArray(row.cells)) return null;
        const children = row.cells
          .map((cell: any) => {
            if (!cell || typeof cell !== 'object' || !cell.content || typeof cell.content !== 'object') return null;
            const content = cell.content as Record<string, unknown>;
            const contentType = typeof content.type === 'string' ? content.type : '';
            let child: LayoutNode | null = null;

            if ((contentType === 'field' || contentType === 'journal') && typeof content.fieldKey === 'string') {
              child = { type: 'field', key: content.fieldKey };
            } else if (contentType === 'markdown') {
              const style = typeof content.style === 'string' ? content.style : 'text';
              child = {
                type:
                  style === 'heading1' ? 'h1' :
                  style === 'heading2' ? 'h2' :
                  style === 'hint' ? 'hint' :
                  style === 'divider' ? 'divider' : 'text',
                text: typeof content.text === 'string' ? content.text : ''
              };
            } else if (contentType === 'button' && typeof content.action === 'string') {
              child = {
                type: 'button',
                key: typeof content.key === 'string' && content.key.trim().length > 0 ? content.key : content.action,
                action: content.action,
                label: typeof content.label === 'string' ? content.label : undefined,
                kind: typeof content.kind === 'string' ? content.kind : undefined
              };
            } else if (contentType === 'spacer') {
              child = {
                type: 'spacer',
                size: typeof content.size === 'string' ? content.size : 'md'
              };
            } else if (contentType === 'attachmentArea' || contentType === 'attachments') {
              child = {
                type: 'attachments',
                title: typeof content.title === 'string' ? content.title : 'Attachments',
                text:
                  typeof content.helpText === 'string'
                    ? content.helpText
                    : 'Attachments and images are managed on the document workspace.'
              };
            }

            if (!child) return null;
            return {
              type: 'col',
              width: (cell as any).width ?? (cell as any).span,
              align: normalizeCellAlign(cell.align),
              children: [child]
            } satisfies LayoutNode;
          })
          .filter((item): item is LayoutNode => !!item);

        if (children.length === 0) return null;
        return {
          type: 'row',
          children
        } satisfies LayoutNode;
      })
      .filter((row): row is LayoutNode => !!row);
  }

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
  const uiInput = resolveUiInput(field);
  const isStatusWorkflowField = kind === 'workflow' && fieldKey === 'status';
  const dataValue = params.dataJson?.[fieldKey];
  const snapshotValue = params.snapshotsJson?.[fieldKey];
  const externalValue = params.externalRefsJson?.[fieldKey];

  if (kind === 'lookup') {
    return !isEmptyDisplayValue(snapshotValue) || !isEmptyDisplayValue(externalValue);
  }

  if (kind === 'system' || kind === 'workflow') {
    if (isStatusWorkflowField) {
      return !isEmptyDisplayValue(params.documentStatus);
    }
    return !isEmptyDisplayValue(dataValue) || !isEmptyDisplayValue(snapshotValue) || !isEmptyDisplayValue(externalValue);
  }

  if (uiInput === 'journal') {
    return normalizeJournalRows(dataValue).length > 0;
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
  const uiInput = resolveUiInput(field);
  const isWorkflow = kind === 'workflow';
  const isStatusWorkflowField = isWorkflow && fieldKey === 'status';
  const placeholder = resolveFieldPlaceholder(field);
  const placeholderAttr = placeholder ? ` placeholder="${escapeAttr(placeholder)}"` : '';
  const textareaRows = resolveFieldRows(field);

  if (params.mode === 'detail' && isStatusWorkflowField) {
    return '';
  }

  const dataValue = params.dataJson?.[fieldKey];
  const snapshotValue = params.snapshotsJson?.[fieldKey];
  const externalValue = params.externalRefsJson?.[fieldKey];
  const inEditable = (params.editableKeys ?? []).includes(fieldKey);
  const inReadonly = (params.readonlyKeys ?? []).includes(fieldKey);
  const isEditable = !isWorkflow && (inEditable || (!inReadonly && isEditableFieldKind(kind)));
  const isSystemLike = kind === 'system' || isWorkflow;
  const workflowDisplay = isStatusWorkflowField ? params.documentStatus : dataValue ?? snapshotValue ?? externalValue;
  const systemLikeDisplay = isWorkflow ? workflowDisplay : dataValue ?? snapshotValue ?? externalValue;
  const displayValue = resolveFieldDisplayValue(field, dataValue ?? snapshotValue ?? externalValue);

  if (params.mode === 'preview') {
    if (isSystemLike) {
      if (isWorkflow) {
        const value = isEmptyDisplayValue(workflowDisplay) ? '—' : workflowDisplay;
        return `<div class="row form-field"><label>${label}</label><div><span class="badge badge-status">${escapeHtml(value)}</span></div></div>`;
      }
      return `<div class="row form-field"><label>${label}</label><div class="muted">${escapeHtml(systemLikeDisplay ?? '—')}</div></div>`;
    }

    if (kind === 'lookup') {
      return wrapFieldContent(fieldKey, label, `<select disabled><option>Lookup field</option></select>`, field, node);
    }

    if (uiInput === 'radioGroup') {
      return wrapFieldContent(fieldKey, label, renderRadioGroup(fieldKey, field, dataValue, false), field, node);
    }

    if (uiInput === 'checkboxGroup') {
      return wrapFieldContent(fieldKey, label, renderCheckboxGroup(fieldKey, field, dataValue, false), field, node);
    }

    if (uiInput === 'journal') {
      return wrapFieldContent(fieldKey, label, renderJournalReadonly(fieldKey, field, dataValue), field, node);
    }

    if (uiInput === 'textarea') {
      return wrapFieldContent(fieldKey, label, `<textarea rows="${textareaRows}" disabled placeholder="Preview"></textarea>`, field, node);
    }

    return wrapFieldContent(fieldKey, label, `<input type="${uiInput === 'date' ? 'date' : uiInput === 'checkbox' ? 'checkbox' : 'text'}" disabled${uiInput === 'checkbox' ? ' value="1"' : placeholderAttr} />`, field, node);
  }

  if (params.mode === 'new') {
    if (isSystemLike) {
      if (isWorkflow) {
        const value = isEmptyDisplayValue(workflowDisplay) ? '—' : workflowDisplay;
        return `<div class="row form-field"><label>${label}</label><div><span class="badge badge-status">${escapeHtml(value)}</span></div></div>`;
      }
      if (isEmptyDisplayValue(systemLikeDisplay)) {
        return '';
      }
      return `<div class="row form-field"><label>${label}</label><div>${escapeHtml(systemLikeDisplay)}</div></div>`;
    }

    if (kind === 'lookup') {
      const templateId = params.templateId ?? '';
      const hxVals = JSON.stringify({ templateId, fieldKey });
      if (isEditable) {
        return wrapFieldContent(fieldKey, label, `<select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" hx-get="/api/lookup" hx-target="this" hx-swap="innerHTML" hx-include="#doc-form" hx-trigger="load, change from:#doc-form, reloadLookup" hx-vals='${escapeAttr(hxVals)}'><option value="">Loading...</option></select>`, field, node);
      }
      return wrapFieldContent(fieldKey, label, `<select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" disabled><option value="">—</option></select>`, field, node);
    }

    if (isEditableFieldKind(kind) && uiInput === 'radioGroup') {
      return wrapFieldContent(fieldKey, label, renderRadioGroup(fieldKey, field, dataValue, isEditable), field, node);
    }

    if (isEditableFieldKind(kind) && uiInput === 'checkboxGroup') {
      return wrapFieldContent(fieldKey, label, renderCheckboxGroup(fieldKey, field, dataValue, isEditable), field, node);
    }

    if (isEditableFieldKind(kind) && uiInput === 'journal') {
      return wrapFieldContent(
        fieldKey,
        label,
        isEditable ? renderJournalEditable(fieldKey, field, dataValue, params.mode) : renderJournalReadonly(fieldKey, field, dataValue),
        field,
        node
      );
    }

    if (isEditableFieldKind(kind) && uiInput === 'textarea') {
      const disabledAttr = isEditable ? '' : ' disabled';
      return wrapFieldContent(fieldKey, label, `<textarea id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" rows="${textareaRows}"${disabledAttr}${placeholderAttr}>${escapeHtml(dataValue ?? '')}</textarea>`, field, node);
    }

    if (isEditableFieldKind(kind)) {
      if (uiInput === 'date') {
        const disabledAttr = isEditable ? '' : ' disabled';
        return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="date" value="${escapeAttr(dataValue ?? '')}"${disabledAttr}${placeholderAttr} />`, field, node);
      }
      if (uiInput === 'checkbox') {
        const checked = isCheckedValue(dataValue) ? ' checked' : '';
        const disabledAttr = isEditable ? '' : ' disabled';
        return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="checkbox" value="1"${checked}${disabledAttr} />`, field, node);
      }
      const disabledAttr = isEditable ? '' : ' disabled';
      return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(dataValue ?? '')}"${disabledAttr}${placeholderAttr} />`, field, node);
    }

    return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" type="text" disabled value=""${placeholderAttr} />`, field, node);
  }

  if (kind === 'lookup') {
    if (isEditable) {
      const templateId = params.templateId ?? '';
      const hxVals = JSON.stringify({ templateId, fieldKey });
      const selectedLabel = escapeHtml(snapshotValue ?? 'Loading...');
      return wrapFieldContent(fieldKey, label, `<select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" hx-get="/api/lookup" hx-target="this" hx-swap="innerHTML" hx-include="closest form" hx-trigger="load, change from:closest form, reloadLookup" hx-vals='${escapeAttr(hxVals)}'><option value="${escapeAttr(externalValue ?? '')}">${selectedLabel}</option></select>`, field, node);
    }

    const optionValue = externalValue ?? '';
    const optionLabel = snapshotValue ?? externalValue ?? '-';
    return wrapFieldContent(fieldKey, label, `<select id="field-${escapeAttr(fieldKey)}" name="lookup:${escapeAttr(fieldKey)}" disabled><option value="${escapeAttr(optionValue)}" selected>${escapeHtml(optionLabel)}</option></select>`, field, node);
  }

  if (isEditableFieldKind(kind)) {
    const disabledAttr = isEditable ? '' : ' disabled';
    if (uiInput === 'radioGroup') {
      return wrapFieldContent(fieldKey, label, renderRadioGroup(fieldKey, field, dataValue, isEditable), field, node);
    }
    if (uiInput === 'checkboxGroup') {
      return wrapFieldContent(fieldKey, label, renderCheckboxGroup(fieldKey, field, dataValue, isEditable), field, node);
    }
    if (uiInput === 'journal') {
      return wrapFieldContent(
        fieldKey,
        label,
        isEditable ? renderJournalEditable(fieldKey, field, dataValue, params.mode) : renderJournalReadonly(fieldKey, field, dataValue),
        field,
        node
      );
    }
    if (uiInput === 'textarea') {
      return wrapFieldContent(fieldKey, label, `<textarea id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" rows="${textareaRows}"${disabledAttr}${placeholderAttr}>${escapeHtml(dataValue ?? '')}</textarea>`, field, node);
    }
    if (uiInput === 'date') {
      return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="date" value="${escapeAttr(dataValue ?? '')}"${disabledAttr}${placeholderAttr} />`, field, node);
    }
    if (uiInput === 'checkbox') {
      const checked = isCheckedValue(dataValue) ? ' checked' : '';
      return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="checkbox" value="1"${checked}${disabledAttr} />`, field, node);
    }
    return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" name="data:${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(dataValue ?? '')}"${disabledAttr}${placeholderAttr} />`, field, node);
  }

  if (isSystemLike) {
    if (isWorkflow) {
      const value = isEmptyDisplayValue(workflowDisplay) ? '—' : workflowDisplay;
      return `<div class="row form-field"><label>${label}</label><div><span class="badge badge-status">${escapeHtml(value)}</span></div></div>`;
    }
    return `<div class="row form-field"><label>${label}</label><div>${escapeHtml(isEmptyDisplayValue(systemLikeDisplay) ? '—' : systemLikeDisplay)}</div></div>`;
  }

  const readonlyValue = displayValue ?? '';
  return wrapFieldContent(fieldKey, label, `<input id="field-${escapeAttr(fieldKey)}" type="text" value="${escapeAttr(readonlyValue)}" readonly />`, field, node);
}

function resolveControlKeyFromAction(templateJson: any, action: string) {
  // V1 primary model: layout buttons reference action keys directly.
  // Legacy bridge: older templates may still map button keys through controls[action].
  const controls = (templateJson?.controls ?? {}) as Record<string, { action?: string }>;
  if (controls[action]) return action;

  for (const [controlKey, config] of Object.entries(controls)) {
    if (config?.action === action) {
      return controlKey;
    }
  }

  return action;
}

function resolveActionDefinitionFromNode(templateJson: any, nodeAction: string) {
  const actions = (templateJson?.actions ?? {}) as Record<string, unknown>;
  const controls = (templateJson?.controls ?? {}) as Record<string, { action?: string }>;

  // V1 primary model: use actions[nodeAction] directly.
  if (actions[nodeAction]) {
    return actions[nodeAction];
  }

  // Legacy bridge: resolve via controls only when direct action lookup is absent.
  const directControl = controls[nodeAction];
  if (directControl?.action && actions[directControl.action]) {
    return actions[directControl.action];
  }

  for (const controlConfig of Object.values(controls)) {
    if (controlConfig?.action === nodeAction && actions[nodeAction]) {
      return actions[nodeAction];
    }
  }

  return undefined;
}

function renderDisabledNewModeActionButton(label: string, variantClass: string) {
  return `<div><button type="button" class="btn${variantClass}" disabled>${label}</button><div class="muted">Available after document creation</div></div>`;
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
  const variantClass = ' btn-secondary';
  const kind = node.kind === 'process' ? 'process' : 'ui';
  const confirmAttr = typeof node.confirm === 'string' && node.confirm.trim().length > 0
    ? ` hx-confirm="${escapeAttr(node.confirm)}"`
    : '';

  if (!action) {
    return `<button type="button" class="btn${variantClass}" disabled>${label}</button>`;
  }

  const hasDocumentBoundAction = resolveActionDefinitionFromNode(params.templateJson, action) !== undefined;
  const isArchivedDocument = String(params.documentStatus ?? '')
    .trim()
    .toLowerCase() === 'archived';

  if (params.mode === 'detail' && isArchivedDocument) {
    if (hasDocumentBoundAction) {
      return `<div><button type="button" class="btn${variantClass}" disabled>${label}</button><div class="muted">Archived document (read-only)</div></div>`;
    }
  }

  if (params.mode === 'detail' && params.documentId) {
    const controlKey = resolveControlKeyFromAction(params.templateJson, action);
    const actionUrl = `/documents/${encodeURIComponent(params.documentId)}/action/${encodeURIComponent(controlKey)}`;
    if (kind === 'process') {
      return `<button type="submit" class="btn${variantClass}" form="document-form" formaction="${escapeAttr(actionUrl)}" formmethod="post" data-fp-action-key="${escapeAttr(controlKey)}" data-fp-action-kind="${escapeAttr(kind)}"${confirmAttr}>${label}</button>`;
    }
    const endpoint = `${actionUrl}?source=ui`;
    return `<button type="button" class="btn${variantClass}" hx-post="${escapeAttr(endpoint)}" hx-include="closest form" hx-swap="none" hx-on::after-request="if(event.detail.successful) window.location.reload()" data-fp-action-key="${escapeAttr(controlKey)}" data-fp-action-kind="${escapeAttr(kind)}"${confirmAttr}>${label}</button>`;
  }

  if (params.mode === 'new') {
    if (hasDocumentBoundAction) {
      return renderDisabledNewModeActionButton(label, variantClass);
    }
    const targetKeys = inferLookupTargets(node, params);
    if (targetKeys.length > 0) {
      const script = targetKeys
        .map((key) => `htmx.trigger('#field-${key}', 'reloadLookup')`)
        .join('; ');
      return `<button type="button" class="btn${variantClass}" hx-on:click="${escapeAttr(script)}">${label}</button>`;
    }
  }

  if (params.mode === 'detail') {
    const targetKeys = inferLookupTargets(node, params);
    if (targetKeys.length > 0) {
      const script = targetKeys
        .map((key) => `htmx.trigger('#field-${key}', 'reloadLookup')`)
        .join('; ');
      return `<button type="button" class="btn${variantClass}" hx-on:click="${escapeAttr(script)}">${label}</button>`;
    }
  }

  return `<button type="button" class="btn${variantClass}" disabled>${label}</button>`;
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
    return `<p class="row"><span class="col">${escapeHtml(node.text ?? '')}</span></p>`;
  }

  if (type === 'hint') {
    return `<p class="muted">${escapeHtml(node.text ?? '')}</p>`;
  }

  if (type === 'divider') {
    return '<hr />';
  }

  if (type === 'spacer') {
    const size = typeof node.size === 'string' ? node.size : 'md';
    const height = size === 'sm' ? '0.75rem' : size === 'lg' ? '2rem' : '1.25rem';
    return `<div class="form-spacer" style="min-height:${escapeAttr(height)};"></div>`;
  }

  if (type === 'attachments') {
    const title = typeof node.title === 'string' && node.title.trim().length > 0 ? node.title : 'Attachments';
    const text =
      typeof node.text === 'string' && node.text.trim().length > 0
        ? node.text
        : 'Attachments and images are managed in the document workspace.';
    return `<div class="card"><h3 class="card-title">${escapeHtml(title)}</h3><p class="muted">${escapeHtml(text)}</p></div>`;
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

    const title = node.title ? `<h3 class="card-title">${escapeHtml(node.title)}</h3>` : '';
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => renderNode(child, params))
          .filter((html) => html.trim().length > 0)
          .join('')
      : '';
    if (!children) return '';
    return `<div class="card">${title}${children}</div>`;
  }

  if (type === 'row') {
    const alignClass = resolveAlignClass(node.align, 'row');
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => renderNode(child, params))
          .filter((html) => html.trim().length > 0)
          .join('')
      : '';
    if (!children) return '';
    const classes = ['row'];
    if (alignClass) classes.push(alignClass);
    return `<div class="${classes.join(' ')}">${children}</div>`;
  }

  if (type === 'col') {
    const alignClass = resolveAlignClass(node.align, 'col');
    const widthStyleValue = resolveColumnWidthStyle(node.width);
    const widthStyle = widthStyleValue ? ` style="${widthStyleValue}"` : '';
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => renderNode(child, params))
          .filter((html) => html.trim().length > 0)
          .join('')
      : '';
    if (!children) return '';
    const classes = ['col'];
    if (alignClass) classes.push(alignClass);
    return `<div class="${classes.join(' ')}"${widthStyle}>${children}</div>`;
  }

  if (type === 'button') {
    return renderButton(node, params);
  }

  if (process.env.NODE_ENV !== 'production') {
    return '';
  }

  return '';
}

export function renderLayout(params: RenderLayoutParams) {
  const nodes = normalizeLayoutNodes(params.templateJson);
  return nodes.map((node) => renderNode(node, params)).join('');
}
