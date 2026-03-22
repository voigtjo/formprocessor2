(function () {
  function initBuilderTabs(card) {
    if (!(card instanceof HTMLElement)) return;
    var tabButtons = Array.prototype.slice.call(card.querySelectorAll('[data-builder-view-tab]'));
    var tabPanels = Array.prototype.slice.call(card.querySelectorAll('[data-builder-view-panel]'));
    if (!tabButtons.length || !tabPanels.length) return;

    function setActiveView(view) {
      tabButtons.forEach(function (button) {
        var isActive = button.getAttribute('data-builder-view-tab') === view;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      tabPanels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-builder-view-panel') !== view;
      });
    }

    tabButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        setActiveView(button.getAttribute('data-builder-view-tab') || 'builder');
      });
    });

    setActiveView('builder');
    return setActiveView;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeParseJson(text, fallback) {
    try {
      return JSON.parse(String(text ?? ''));
    } catch (_error) {
      return fallback;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var CONTROL_TYPES = ['field', 'markdown', 'button', 'journal', 'attachmentArea', 'spacer'];

  function iconForContentType(type) {
    if (type === 'field') return '▣';
    if (type === 'markdown') return '¶';
    if (type === 'button') return '◉';
    if (type === 'journal') return '≣';
    if (type === 'attachmentArea') return '📎';
    if (type === 'spacer') return '↔';
    return '•';
  }

  function labelForContentType(type) {
    if (type === 'markdown') return 'Text';
    if (type === 'attachmentArea') return 'Attachment';
    return String(type || '').charAt(0).toUpperCase() + String(type || '').slice(1);
  }

  function moveItem(items, fromIndex, toIndex) {
    if (!Array.isArray(items)) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return;
    var next = items.splice(fromIndex, 1)[0];
    items.splice(toIndex, 0, next);
  }

  function createDefaultField() {
    return {
      key: '',
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      helpText: '',
      rows: 4,
      apiRef: '',
      valueKey: 'id',
      labelKey: 'name',
      options: [],
      journalColumns: []
    };
  }

  function createDefaultOption() {
    return { value: '', label: '', hint: '' };
  }

  function createDefaultJournalColumn() {
    return { key: '', label: '', type: 'text', placeholder: '', options: [] };
  }

  function createDefaultAction() {
    return { key: '', type: 'composite', steps: [createDefaultActionStep()] };
  }

  function createDefaultActionStep() {
    return { type: 'message', value: '' };
  }

  function createDefaultCell(contentType) {
    var type = String(contentType || 'field');
    var cell = {
      id: 'cell-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
      width: 12,
      align: 'left',
      contentType: type,
      fieldKey: '',
      markdownStyle: 'text',
      text: '',
      action: '',
      label: '',
      spacerSize: 'md',
      attachmentTitle: 'Attachments',
      attachmentHelpText: 'Attachments and images are managed on the document workspace.'
    };
    if (type === 'markdown') {
      cell.markdownStyle = 'heading2';
      cell.text = 'Section title';
    } else if (type === 'button') {
      cell.label = 'Run action';
    } else if (type === 'attachmentArea') {
      cell.attachmentTitle = 'Attachment Area';
      cell.attachmentHelpText = 'Collect photos and supporting files here.';
    }
    return cell;
  }

  function createDefaultFormRow(contentType) {
    var rowId = 'row-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    var cell = createDefaultCell(contentType);
    cell.id = rowId + '-cell-1';
    return {
      id: rowId,
      key: '',
      height: 80,
      cells: [cell]
    };
  }

  function normalizeFieldType(field) {
    if (!field || typeof field !== 'object') return 'text';
    if (field.kind === 'lookup') return 'lookup';
    if (field.kind === 'journal') return 'journal';
    if (field.control === 'radioGroup') return 'radioGroup';
    if (field.control === 'checkboxGroup') return 'checkboxGroup';
    if (field.control === 'checkbox' || field.kind === 'checkbox') return 'checkbox';
    if (field.control === 'date' || field.kind === 'date') return 'date';
    if (field.multiline) return 'textarea';
    return 'text';
  }

  function modelFromField(key, field) {
    var normalizedType = normalizeFieldType(field);
    return {
      key: key,
      label: field.label || key,
      type: normalizedType,
      required: Boolean(field.required),
      placeholder: field.placeholder || '',
      helpText: field.helpText || field.hint || '',
      rows: Number(field.rows || 4),
      apiRef: field.apiRef || '',
      valueKey: field.valueKey || 'id',
      labelKey: field.labelKey || 'name',
      options: Array.isArray(field.options)
        ? field.options.map(function (option) {
            return {
              value: option && option.value != null ? String(option.value) : '',
              label: option && option.label != null ? String(option.label) : '',
              hint: option && option.hint != null ? String(option.hint) : ''
            };
          })
        : [],
      journalColumns: Array.isArray(field.columns)
        ? field.columns.map(function (column) {
            return {
              key: column && column.key != null ? String(column.key) : '',
              label: column && column.label != null ? String(column.label) : '',
              type: column && column.type != null ? String(column.type) : 'text',
              placeholder: column && column.placeholder != null ? String(column.placeholder) : '',
              options: Array.isArray(column && column.options)
                ? column.options.map(function (option) {
                    return {
                      value: option && option.value != null ? String(option.value) : '',
                      label: option && option.label != null ? String(option.label) : '',
                      hint: option && option.hint != null ? String(option.hint) : ''
                    };
                  })
                : []
            };
          })
        : []
    };
  }

  function modelFromAction(key, action) {
    if (!action || typeof action !== 'object') return createDefaultAction();
    if (action.type === 'composite') {
      return {
        key: key,
        type: 'composite',
        steps: Array.isArray(action.steps) ? action.steps.map(modelFromActionStep) : []
      };
    }
    if (action.type === 'callApi') {
      return {
        key: key,
        type: 'callApi',
        apiRef: action.apiRef || '',
        requestJson: JSON.stringify(action.request || {}, null, 2),
        to: action.to || ''
      };
    }
    if (action.type === 'message') return { key: key, type: 'message', value: action.value || '' };
    if (action.type === 'write') return { key: key, type: 'write', to: action.to || '', value: action.value || '' };
    if (action.type === 'setStatus') return { key: key, type: 'setStatus', to: action.to || '' };
    return {
      key: key,
      type: 'customJson',
      customJson: JSON.stringify(action, null, 2)
    };
  }

  function modelFromActionStep(step) {
    if (!step || typeof step !== 'object') return createDefaultActionStep();
    if (step.type === 'require') return { type: 'require', from: step.from || '', message: step.message || '' };
    if (step.type === 'requireField') return { type: 'requireField', key: step.key || '', message: step.message || '' };
    if (step.type === 'callApi') {
      return {
        type: 'callApi',
        apiRef: step.apiRef || '',
        requestJson: JSON.stringify(step.request || {}, null, 2),
        to: step.to || ''
      };
    }
    if (step.type === 'write') return { type: 'write', to: step.to || '', value: step.value || '' };
    if (step.type === 'message') return { type: 'message', value: step.value || '' };
    if (step.type === 'setStatus') return { type: 'setStatus', to: step.to || '' };
    return { type: 'customJson', customJson: JSON.stringify(step, null, 2) };
  }

  function modelFromLegacyLayoutNode(node, fields) {
    if (!node || typeof node !== 'object') return [];
    if (node.type === 'group') {
      var rows = [];
      if (String(node.title || '').trim()) {
        rows.push({ key: '', height: 80, cells: [{ id: 'legacy-' + Date.now(), width: 12, align: 'left', contentType: 'markdown', markdownStyle: 'heading2', text: String(node.title || '') }] });
      }
      var groupChildren = Array.isArray(node.children) ? node.children : [];
      groupChildren.forEach(function (child) {
        rows = rows.concat(modelFromLegacyLayoutNode(child, fields));
      });
      return rows;
    }
    if (node.type === 'row') {
      var rawChildren = Array.isArray(node.children) ? node.children : [];
      var cells = rawChildren.map(function (child) {
        var isCol = child && child.type === 'col';
        var candidate = isCol && Array.isArray(child.children) ? child.children[0] : child;
        if (!candidate || typeof candidate !== 'object') return null;
        var cell = createDefaultCell();
        cell.width = isCol ? child.width || 12 : 12;
        cell.align = isCol ? child.align || 'left' : 'left';
        if (candidate.type === 'field') {
          cell.contentType = (fields[candidate.key] && fields[candidate.key].kind === 'journal') ? 'journal' : 'field';
          cell.fieldKey = candidate.key || '';
        } else if (candidate.type === 'button') {
          cell.contentType = 'button';
          cell.action = candidate.action || '';
          cell.label = candidate.label || '';
        } else if (candidate.type === 'attachments') {
          cell.contentType = 'attachmentArea';
          cell.attachmentTitle = candidate.title || 'Attachments';
          cell.attachmentHelpText =
            candidate.text || 'Attachments and images are managed on the document workspace.';
        } else {
          cell.contentType = 'markdown';
          cell.markdownStyle = candidate.type === 'h1' ? 'heading1' : candidate.type === 'h2' ? 'heading2' : candidate.type === 'hint' ? 'hint' : 'text';
          cell.text = candidate.text || '';
        }
        return cell;
      }).filter(Boolean);
      return cells.length ? [{ key: '', height: 80, cells: cells }] : [];
    }
    var single = createDefaultCell();
    if (node.type === 'field') {
      single.contentType = (fields[node.key] && fields[node.key].kind === 'journal') ? 'journal' : 'field';
      single.fieldKey = node.key || '';
    } else if (node.type === 'button') {
      single.contentType = 'button';
      single.action = node.action || '';
      single.label = node.label || '';
    } else if (node.type === 'attachments') {
      single.contentType = 'attachmentArea';
      single.attachmentTitle = node.title || 'Attachments';
      single.attachmentHelpText =
        node.text || 'Attachments and images are managed on the document workspace.';
    } else if (node.type === 'divider') {
      single.contentType = 'markdown';
      single.markdownStyle = 'divider';
      single.text = '';
    } else {
      single.contentType = 'markdown';
      single.markdownStyle = node.type === 'h1' ? 'heading1' : node.type === 'h2' ? 'heading2' : node.type === 'hint' ? 'hint' : 'text';
      single.text = node.text || '';
    }
    return [{ key: '', height: 80, cells: [single] }];
  }

  function modelFromFormRow(row) {
    if (!row || typeof row !== 'object' || !Array.isArray(row.cells)) return createDefaultFormRow();
    return {
      id: typeof row.id === 'string' ? row.id : 'row-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
      key: typeof row.key === 'string' ? row.key : '',
      height: Math.max(48, Number(row.height || 80)),
      cells: row.cells.map(function (cell) {
        var next = createDefaultCell();
        next.id = typeof cell.id === 'string' ? cell.id : next.id;
        if (typeof cell.width === 'number' || typeof cell.width === 'string' || typeof cell.span === 'number' || typeof cell.span === 'string') next.width = cell.width != null ? cell.width : cell.span;
        if (typeof cell.align === 'string') next.align = cell.align;
        if (cell.align && typeof cell.align === 'object' && typeof cell.align.horizontal === 'string') next.align = cell.align.horizontal;
        var content = cell.content && typeof cell.content === 'object' ? cell.content : {};
        if (content.type === 'field' || content.type === 'journal') {
          next.contentType = content.type;
          next.fieldKey = content.fieldKey || '';
        } else if (content.type === 'attachmentArea' || content.type === 'attachments') {
          next.contentType = 'attachmentArea';
          next.attachmentTitle = content.title || 'Attachments';
          next.attachmentHelpText =
            content.helpText || 'Attachments and images are managed on the document workspace.';
        } else if (content.type === 'button') {
          next.contentType = 'button';
          next.action = content.action || '';
          next.label = content.label || '';
        } else if (content.type === 'spacer') {
          next.contentType = 'spacer';
          next.spacerSize = content.size || 'md';
        } else {
          next.contentType = 'markdown';
          next.markdownStyle = content.style || 'text';
          next.text = content.text || '';
        }
        return next;
      })
    };
  }

  function builderStateFromTemplate(template) {
    var fields = template && template.fields && typeof template.fields === 'object' ? template.fields : {};
    var actions = template && template.actions && typeof template.actions === 'object' ? template.actions : {};
    var documentTable = template && template.documentTable && typeof template.documentTable === 'object' ? template.documentTable : {};
    var formRows = Array.isArray(template && template.form && template.form.rows)
      ? template.form.rows.map(modelFromFormRow)
      : (Array.isArray(template && template.layout)
          ? template.layout.flatMap(function (node) { return modelFromLegacyLayoutNode(node, fields); })
          : []);

    return {
      fields: Object.keys(fields).map(function (key) { return modelFromField(key, fields[key]); }),
      formRows: formRows.length ? formRows : [createDefaultFormRow()],
      actions: Object.keys(actions).map(function (key) { return modelFromAction(key, actions[key]); }),
      documentTable: Array.isArray(documentTable.columns)
        ? documentTable.columns.map(function (column) {
            return {
              key: column && column.key != null ? String(column.key) : '',
              label: column && column.label != null ? String(column.label) : ''
            };
          })
        : []
    };
  }

  function optionRowsToJson(options) {
    return (options || [])
      .filter(function (option) {
        return String(option.value || '').trim() || String(option.label || '').trim();
      })
      .map(function (option) {
        var next = {
          value: String(option.value || '').trim(),
          label: String(option.label || '').trim()
        };
        if (String(option.hint || '').trim()) next.hint = String(option.hint || '').trim();
        return next;
      });
  }

  function journalColumnsToJson(columns, errors, fieldKey) {
    return (columns || [])
      .filter(function (column) {
        return String(column.key || '').trim() || String(column.label || '').trim();
      })
      .map(function (column, index) {
        var key = String(column.key || '').trim();
        if (!key) {
          errors.push('Journal field "' + fieldKey + '" has a column without key at position ' + (index + 1) + '.');
        }
        var next = {
          key: key,
          label: String(column.label || key).trim() || key,
          type: String(column.type || 'text')
        };
        if (String(column.placeholder || '').trim()) next.placeholder = String(column.placeholder || '').trim();
        if (next.type === 'select') {
          var options = optionRowsToJson(column.options || []);
          if (options.length === 0) errors.push('Journal select column "' + key + '" needs at least one option.');
          next.options = options;
        }
        return next;
      });
  }

  function fieldToJson(field, errors) {
    var key = String(field.key || '').trim();
    if (!key) errors.push('Every field needs a key.');
    var label = String(field.label || key).trim() || key;
    var helpText = String(field.helpText || '').trim();
    var placeholder = String(field.placeholder || '').trim();
    if (field.type === 'lookup') {
      if (!String(field.apiRef || '').trim()) errors.push('Lookup field "' + key + '" needs apiRef.');
      return {
        kind: 'lookup',
        label: label,
        apiRef: String(field.apiRef || '').trim(),
        valueKey: String(field.valueKey || 'id').trim() || 'id',
        labelKey: String(field.labelKey || 'name').trim() || 'name',
        required: Boolean(field.required)
      };
    }
    if (field.type === 'journal') {
      var columns = journalColumnsToJson(field.journalColumns || [], errors, key);
      if (columns.length === 0) errors.push('Journal field "' + key + '" needs at least one column.');
      var journalField = {
        kind: 'journal',
        label: label,
        columns: columns
      };
      if (helpText) journalField.helpText = helpText;
      return journalField;
    }
    if (field.type === 'radioGroup' || field.type === 'checkboxGroup') {
      var groupedOptions = optionRowsToJson(field.options || []);
      if (groupedOptions.length === 0) errors.push('Field "' + key + '" needs at least one option.');
      var groupedField = {
        kind: 'editable',
        label: label,
        control: field.type,
        options: groupedOptions
      };
      if (field.required) groupedField.required = true;
      if (helpText) groupedField.helpText = helpText;
      return groupedField;
    }
    if (field.type === 'checkbox') {
      var checkboxField = { kind: 'editable', label: label, control: 'checkbox' };
      if (helpText) checkboxField.helpText = helpText;
      return checkboxField;
    }
    if (field.type === 'date') {
      var dateField = { kind: 'editable', label: label, control: 'date' };
      if (field.required) dateField.required = true;
      if (helpText) dateField.helpText = helpText;
      return dateField;
    }
    var editableField = { kind: 'editable', label: label };
    if (field.required) editableField.required = true;
    if (placeholder) editableField.placeholder = placeholder;
    if (helpText) editableField.helpText = helpText;
    if (field.type === 'textarea') {
      editableField.multiline = true;
      editableField.rows = Math.max(2, Number(field.rows || 4));
    }
    return editableField;
  }

  function actionStepToJson(step, errors, actionKey) {
    if (step.type === 'require') {
      if (!String(step.from || '').trim()) errors.push('Action "' + actionKey + '" has a require step without from.');
      return { type: 'require', from: String(step.from || '').trim(), message: String(step.message || '').trim() };
    }
    if (step.type === 'requireField') {
      if (!String(step.key || '').trim()) errors.push('Action "' + actionKey + '" has a requireField step without key.');
      return { type: 'requireField', key: String(step.key || '').trim(), message: String(step.message || '').trim() };
    }
    if (step.type === 'callApi') {
      var requestJson = {};
      try {
        requestJson = String(step.requestJson || '').trim() ? JSON.parse(String(step.requestJson || '')) : {};
      } catch (_error) {
        errors.push('Action "' + actionKey + '" contains invalid JSON in a callApi step.');
      }
      if (!String(step.apiRef || '').trim()) errors.push('Action "' + actionKey + '" has a callApi step without apiRef.');
      var apiStep = { type: 'callApi', apiRef: String(step.apiRef || '').trim(), request: requestJson };
      if (String(step.to || '').trim()) apiStep.to = String(step.to || '').trim();
      return apiStep;
    }
    if (step.type === 'write') {
      if (!String(step.to || '').trim()) errors.push('Action "' + actionKey + '" has a write step without target.');
      return { type: 'write', to: String(step.to || '').trim(), value: String(step.value || '') };
    }
    if (step.type === 'message') return { type: 'message', value: String(step.value || '') };
    if (step.type === 'setStatus') return { type: 'setStatus', to: String(step.to || '').trim() };
    if (step.type === 'customJson') {
      try {
        return JSON.parse(String(step.customJson || '{}'));
      } catch (_error) {
        errors.push('Action "' + actionKey + '" contains invalid custom step JSON.');
        return { type: 'message', value: '' };
      }
    }
    return { type: 'message', value: '' };
  }

  function actionToJson(action, errors) {
    var key = String(action.key || '').trim();
    if (!key) errors.push('Every action needs a key.');
    if (action.type === 'composite') {
      return {
        type: 'composite',
        steps: (action.steps || []).map(function (step) {
          return actionStepToJson(step, errors, key);
        })
      };
    }
    if (action.type === 'callApi') {
      var requestJson = {};
      try {
        requestJson = String(action.requestJson || '').trim() ? JSON.parse(String(action.requestJson || '')) : {};
      } catch (_error) {
        errors.push('Action "' + key + '" contains invalid request JSON.');
      }
      var apiAction = { type: 'callApi', apiRef: String(action.apiRef || '').trim(), request: requestJson };
      if (!apiAction.apiRef) errors.push('Action "' + key + '" needs apiRef.');
      if (String(action.to || '').trim()) apiAction.to = String(action.to || '').trim();
      return apiAction;
    }
    if (action.type === 'message') return { type: 'message', value: String(action.value || '') };
    if (action.type === 'write') return { type: 'write', to: String(action.to || '').trim(), value: String(action.value || '') };
    if (action.type === 'setStatus') return { type: 'setStatus', to: String(action.to || '').trim() };
    if (action.type === 'customJson') {
      try {
        return JSON.parse(String(action.customJson || '{}'));
      } catch (_error) {
        errors.push('Action "' + key + '" contains invalid custom JSON.');
        return { type: 'message', value: '' };
      }
    }
    return { type: 'message', value: '' };
  }

  function rowToJson(row, errors, fieldDefinitions, actionKeys, rowIndex) {
    var cells = (row.cells || []).map(function (cell, cellIndex) {
      var widthRaw = typeof cell.width === 'number' ? cell.width : Number(String(cell.width || '').trim());
      var width = Number.isFinite(widthRaw) ? Math.max(1, Math.min(12, Math.round(widthRaw))) : String(cell.width || '').trim() || 12;
      var contentType = String(cell.contentType || 'field');
      var content;
      if (contentType === 'field') {
        var fieldKey = String(cell.fieldKey || '').trim();
        if (!fieldKey) errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' needs a field reference.');
        if (fieldKey && !fieldDefinitions[fieldKey]) {
          errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' references unknown field "' + fieldKey + '".');
        } else if (fieldKey && fieldDefinitions[fieldKey].kind === 'journal') {
          errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' references journal field "' + fieldKey + '" as a normal field cell. Use a journal cell instead.');
        }
        content = { type: 'field', fieldKey: fieldKey };
      } else if (contentType === 'journal') {
        var journalFieldKey = String(cell.fieldKey || '').trim();
        if (!journalFieldKey) errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' needs a journal field reference.');
        if (journalFieldKey && !fieldDefinitions[journalFieldKey]) {
          errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' references unknown journal field "' + journalFieldKey + '".');
        } else if (journalFieldKey && fieldDefinitions[journalFieldKey].kind !== 'journal') {
          errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' references non-journal field "' + journalFieldKey + '" as a journal cell.');
        }
        content = { type: 'journal', fieldKey: journalFieldKey };
      } else if (contentType === 'attachmentArea') {
        content = {
          type: 'attachmentArea',
          title: String(cell.attachmentTitle || 'Attachments').trim() || 'Attachments',
          helpText:
            String(cell.attachmentHelpText || 'Attachments and images are managed on the document workspace.').trim() ||
            'Attachments and images are managed on the document workspace.'
        };
      } else if (contentType === 'button') {
        var actionKey = String(cell.action || '').trim();
        if (!actionKey) errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' needs an action reference.');
        if (actionKey && actionKeys.indexOf(actionKey) === -1) errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' references unknown action "' + actionKey + '".');
        content = {
          type: 'button',
          action: actionKey,
          label: String(cell.label || actionKey).trim() || actionKey,
          key: actionKey,
          kind: 'ui'
        };
      } else if (contentType === 'spacer') {
        content = {
          type: 'spacer',
          size: String(cell.spacerSize || 'md').trim() || 'md'
        };
      } else {
        var markdownText = String(cell.text || '').trim();
        var markdownStyle = String(cell.markdownStyle || 'text').trim() || 'text';
        if (markdownStyle !== 'divider' && !markdownText) {
          errors.push('Row ' + (rowIndex + 1) + ', cell ' + (cellIndex + 1) + ' needs text for markdown content.');
        }
        content = {
          type: 'markdown',
          style: markdownStyle,
          text: markdownText
        };
      }
      var next = { id: cell.id || ('row-' + (rowIndex + 1) + '-cell-' + (cellIndex + 1)), width: width, content: content };
      if (String(cell.align || '').trim()) next.align = String(cell.align || '').trim();
      return next;
    });

    if (cells.length === 0) errors.push('Row ' + (rowIndex + 1) + ' needs at least one cell.');
    var result = { id: row.id || ('row-' + (rowIndex + 1)), cells: cells };
    var rowHeight = Math.max(48, Number(row.height || 80));
    if (Number.isFinite(rowHeight)) result.height = rowHeight;
    if (String(row.key || '').trim()) result.key = String(row.key || '').trim();
    return result;
  }

  function buildTemplateJsonFromState(state) {
    var errors = [];
    var fields = {};
    (state.fields || []).forEach(function (field) {
      var key = String(field.key || '').trim();
      if (!key) {
        errors.push('Every field needs a key.');
        return;
      }
      if (fields[key]) {
        errors.push('Field key "' + key + '" is duplicated.');
        return;
      }
      fields[key] = fieldToJson(field, errors);
    });

    var actions = {};
    (state.actions || []).forEach(function (action) {
      var key = String(action.key || '').trim();
      if (!key) {
        errors.push('Every action needs a key.');
        return;
      }
      if (['assign', 'submit', 'approve', 'reject', 'archive'].indexOf(key) !== -1) {
        errors.push('Action "' + key + '" is a workflow process action and does not belong in the V1 builder.');
        return;
      }
      if (actions[key]) {
        errors.push('Action key "' + key + '" is duplicated.');
        return;
      }
      actions[key] = actionToJson(action, errors);
    });

    var fieldKeys = Object.keys(fields);
    var actionKeys = Object.keys(actions);
    var formRows = (state.formRows || []).map(function (row, rowIndex) {
      return rowToJson(row, errors, fields, actionKeys, rowIndex);
    });

    var documentTableColumns = (state.documentTable || [])
      .filter(function (column) { return String(column.key || '').trim(); })
      .map(function (column) {
        return {
          key: String(column.key || '').trim(),
          label: String(column.label || '').trim() || String(column.key || '').trim()
        };
      });

    if (fieldKeys.length === 0) errors.push('At least one field is required.');
    if (formRows.length === 0) errors.push('At least one row is required.');

    var templateJson = {
      fields: fields,
      form: {
        rows: formRows
      }
    };
    if (actionKeys.length > 0) templateJson.actions = actions;
    if (documentTableColumns.length > 0) templateJson.documentTable = { columns: documentTableColumns };
    return { templateJson: templateJson, errors: errors };
  }

  function renderOptionTable(options, pathPrefix, readonly) {
    var rows = (options || []).map(function (option, optionIndex) {
      return '' +
        '<tr>' +
        '<td><input type="text" data-builder-bind="' + pathPrefix + '.options.' + optionIndex + '.value" value="' + escapeHtml(option.value) + '" ' + (readonly ? 'disabled' : '') + ' /></td>' +
        '<td><input type="text" data-builder-bind="' + pathPrefix + '.options.' + optionIndex + '.label" value="' + escapeHtml(option.label) + '" ' + (readonly ? 'disabled' : '') + ' /></td>' +
        '<td><input type="text" data-builder-bind="' + pathPrefix + '.options.' + optionIndex + '.hint" value="' + escapeHtml(option.hint) + '" ' + (readonly ? 'disabled' : '') + ' /></td>' +
        '<td>' + (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-option="' + pathPrefix + '.' + optionIndex + '">Remove</button>') + '</td>' +
        '</tr>';
    }).join('');
    return '' +
      '<table class="builder-table">' +
      '<thead><tr><th>Value</th><th>Label</th><th>Hint</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4" class="muted">No options yet.</td></tr>') + '</tbody>' +
      '</table>' +
      (readonly ? '' : '<div class="actions"><button class="btn btn-secondary" type="button" data-builder-add-option="' + pathPrefix + '">Add option</button></div>');
  }

  function renderJournalColumns(columns, fieldIndex, readonly) {
    var rows = (columns || []).map(function (column, columnIndex) {
      var optionEditor = column.type === 'select'
        ? '<div class="builder-inline-block">' + renderOptionTable(column.options || [], 'fields.' + fieldIndex + '.journalColumns.' + columnIndex, readonly) + '</div>'
        : '';
      return '' +
        '<article class="builder-subcard">' +
        '<div class="builder-grid builder-grid-4">' +
        '<label><span>Column key</span><input type="text" data-builder-bind="fields.' + fieldIndex + '.journalColumns.' + columnIndex + '.key" value="' + escapeHtml(column.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Label</span><input type="text" data-builder-bind="fields.' + fieldIndex + '.journalColumns.' + columnIndex + '.label" value="' + escapeHtml(column.label) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Type</span><select data-builder-bind="fields.' + fieldIndex + '.journalColumns.' + columnIndex + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['text', 'number', 'select', 'checkbox'].map(function (type) {
            return '<option value="' + type + '" ' + (column.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
        '<label><span>Placeholder</span><input type="text" data-builder-bind="fields.' + fieldIndex + '.journalColumns.' + columnIndex + '.placeholder" value="' + escapeHtml(column.placeholder) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '</div>' + optionEditor +
        (readonly ? '' : '<div class="actions"><button class="btn btn-danger" type="button" data-builder-remove-journal-column="' + fieldIndex + '.' + columnIndex + '">Remove column</button></div>') +
        '</article>';
    }).join('');
    return rows + (readonly ? '' : '<div class="actions"><button class="btn btn-secondary" type="button" data-builder-add-journal-column="' + fieldIndex + '">Add journal column</button></div>');
  }

  function renderFieldCard(field, index, readonly) {
    var supportsOptions = field.type === 'radioGroup' || field.type === 'checkboxGroup';
    var supportsLookup = field.type === 'lookup';
    var supportsTextarea = field.type === 'textarea';
    var supportsJournal = field.type === 'journal';
    return '' +
      '<article class="builder-card">' +
      '<div class="builder-panel-header">' +
      '<h5>Field ' + (index + 1) + '</h5>' +
      (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-field="' + index + '">Delete field</button>') +
      '</div>' +
      '<div class="builder-grid builder-grid-4">' +
        '<label><span>Key</span><input type="text" data-builder-bind="fields.' + index + '.key" value="' + escapeHtml(field.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Label</span><input type="text" data-builder-bind="fields.' + index + '.label" value="' + escapeHtml(field.label) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Type</span><select data-builder-bind="fields.' + index + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['text', 'textarea', 'lookup', 'radioGroup', 'checkboxGroup', 'journal', 'checkbox', 'date'].map(function (type) {
            return '<option value="' + type + '" ' + (field.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
        '<label><span>Required</span><select data-builder-bind="fields.' + index + '.required" ' + (readonly ? 'disabled' : '') + '>' +
          '<option value="false" ' + (!field.required ? 'selected' : '') + '>no</option>' +
          '<option value="true" ' + (field.required ? 'selected' : '') + '>yes</option>' +
        '</select></label>' +
      '</div>' +
      '<div class="builder-grid builder-grid-3">' +
        '<label><span>Placeholder</span><input type="text" data-builder-bind="fields.' + index + '.placeholder" value="' + escapeHtml(field.placeholder) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Help text</span><input type="text" data-builder-bind="fields.' + index + '.helpText" value="' + escapeHtml(field.helpText) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        (supportsTextarea ? '<label><span>Rows</span><input type="number" min="2" data-builder-bind="fields.' + index + '.rows" value="' + escapeHtml(field.rows) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' : '<div></div>') +
      '</div>' +
      (supportsLookup
        ? '<div class="builder-grid builder-grid-3">' +
            '<label><span>apiRef</span><input type="text" data-builder-bind="fields.' + index + '.apiRef" value="' + escapeHtml(field.apiRef) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
            '<label><span>valueKey</span><input type="text" data-builder-bind="fields.' + index + '.valueKey" value="' + escapeHtml(field.valueKey) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
            '<label><span>labelKey</span><input type="text" data-builder-bind="fields.' + index + '.labelKey" value="' + escapeHtml(field.labelKey) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
          '</div>'
        : '') +
      (supportsOptions ? renderOptionTable(field.options || [], 'fields.' + index, readonly) : '') +
      (supportsJournal ? '<div class="builder-inline-block"><h6>Journal columns</h6>' + renderJournalColumns(field.journalColumns || [], index, readonly) + '</div>' : '') +
      '</article>';
  }

  function renderDocumentTableEditor(columns, readonly) {
    var rows = (columns || []).map(function (column, index) {
      return '' +
        '<tr>' +
        '<td><input type="text" data-builder-bind="documentTable.' + index + '.key" value="' + escapeHtml(column.key) + '" ' + (readonly ? 'disabled' : '') + ' /></td>' +
        '<td><input type="text" data-builder-bind="documentTable.' + index + '.label" value="' + escapeHtml(column.label) + '" ' + (readonly ? 'disabled' : '') + ' /></td>' +
        '<td>' + (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-doc-column="' + index + '">Remove</button>') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="builder-table"><thead><tr><th>Field key</th><th>Label</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="muted">No document table columns configured.</td></tr>') +
      '</tbody></table>';
  }

  function resolvePreviewColumnWidthStyle(width) {
    var asNumber = typeof width === 'number' ? width : Number(String(width || '').trim());
    if (!Number.isFinite(asNumber)) return 'grid-column:span 12;--col-span:12;--col-basis:100%;';
    var clamped = Math.max(1, Math.min(12, Math.round(asNumber)));
    return 'grid-column:span ' + clamped + ';--col-span:' + clamped + ';--col-basis:' + ((clamped / 12) * 100) + '%;';
  }

  function renderPreviewOptions(options, inputType) {
    return (options || []).map(function (option, index) {
      var id = 'preview-option-' + inputType + '-' + index + '-' + escapeHtml(option.value);
      return '<label class="choice-option" for="' + id + '">' +
        '<input id="' + id + '" type="' + (inputType === 'radio' ? 'radio' : 'checkbox') + '" ' + (inputType === 'radio' ? 'name="preview-choice"' : '') + ' disabled />' +
        '<span class="choice-label">' + escapeHtml(option.label || option.value || 'Option') + '</span>' +
        (option.hint ? '<span class="choice-hint muted">' + escapeHtml(option.hint) + '</span>' : '') +
      '</label>';
    }).join('');
  }

  function renderPreviewFieldCell(field) {
    if (!field) {
      return '<div class="card"><p class="muted">Select a valid field for this cell.</p></div>';
    }
    var label = escapeHtml(field.label || field.key || 'Field');
    var helpText = String(field.helpText || '').trim()
      ? '<div class="field-help muted">' + escapeHtml(field.helpText) + '</div>'
      : '';
    if (field.type === 'textarea') {
      return '<div class="row form-field"><label>' + label + '</label><textarea rows="' + escapeHtml(field.rows || 4) + '" placeholder="' + escapeHtml(field.placeholder || '') + '" disabled></textarea>' + helpText + '</div>';
    }
    if (field.type === 'lookup') {
      return '<div class="row form-field"><label>' + label + '</label><select disabled><option>' + escapeHtml(field.labelKey || 'Select item') + '</option></select>' + helpText + '</div>';
    }
    if (field.type === 'radioGroup') {
      return '<div class="row form-field"><label>' + label + '</label><div class="choice-group" role="radiogroup">' + renderPreviewOptions(field.options || [], 'radio') + '</div>' + helpText + '</div>';
    }
    if (field.type === 'checkboxGroup') {
      return '<div class="row form-field"><label>' + label + '</label><div class="choice-group" role="group">' + renderPreviewOptions(field.options || [], 'checkbox') + '</div>' + helpText + '</div>';
    }
    if (field.type === 'checkbox') {
      return '<div class="row form-field"><label>' + label + '</label><label class="choice-option"><input type="checkbox" disabled /><span class="choice-label">Checked value</span></label>' + helpText + '</div>';
    }
    if (field.type === 'date') {
      return '<div class="row form-field"><label>' + label + '</label><input type="date" disabled />' + helpText + '</div>';
    }
    return '<div class="row form-field"><label>' + label + '</label><input type="text" placeholder="' + escapeHtml(field.placeholder || '') + '" disabled />' + helpText + '</div>';
  }

  function renderPreviewJournalCell(field) {
    if (!field) {
      return '<div class="card"><p class="muted">Select a valid journal field for this cell.</p></div>';
    }
    var header = (field.journalColumns || []).map(function (column) {
      return '<th>' + escapeHtml(column.label || column.key || 'Column') + '</th>';
    }).join('');
    if (!header) {
      header = '<th>Journal column</th>';
    }
    return '<div class="row form-field">' +
      '<label>' + escapeHtml(field.label || field.key || 'Journal') + '</label>' +
      '<div class="journal-wrapper"><table class="journal-table"><thead><tr>' + header + '</tr></thead><tbody><tr><td colspan="' + Math.max(1, (field.journalColumns || []).length) + '" class="muted">Rows are captured on the document.</td></tr></tbody></table></div>' +
      (String(field.helpText || '').trim() ? '<div class="field-help muted">' + escapeHtml(field.helpText) + '</div>' : '') +
    '</div>';
  }

  function renderPreviewCell(cell, state) {
    var field = (state.fields || []).find(function (item) { return item.key === cell.fieldKey; });
    if (cell.contentType === 'field') {
      return renderPreviewFieldCell(field);
    }
    if (cell.contentType === 'journal') {
      return renderPreviewJournalCell(field);
    }
    if (cell.contentType === 'button') {
      return '<button class="btn btn-secondary" type="button" disabled>' + escapeHtml(cell.label || cell.action || 'Action') + '</button>';
    }
    if (cell.contentType === 'spacer') {
      var size = String(cell.spacerSize || 'md');
      var height = size === 'sm' ? '0.75rem' : size === 'lg' ? '2rem' : '1.25rem';
      return '<div class="form-spacer" style="min-height:' + escapeHtml(height) + ';"></div>';
    }
    if (cell.contentType === 'attachmentArea') {
      return '<div class="card"><h3 class="card-title">' + escapeHtml(cell.attachmentTitle || 'Attachments') + '</h3><p class="muted">' + escapeHtml(cell.attachmentHelpText || 'Attachments and images are managed on the document workspace.') + '</p></div>';
    }
    var markdownStyle = String(cell.markdownStyle || 'text');
    if (markdownStyle === 'heading1') return '<h1>' + escapeHtml(cell.text || '') + '</h1>';
    if (markdownStyle === 'heading2') return '<h2>' + escapeHtml(cell.text || '') + '</h2>';
    if (markdownStyle === 'hint') return '<p class="muted">' + escapeHtml(cell.text || '') + '</p>';
    if (markdownStyle === 'divider') return '<hr />';
    return '<p>' + escapeHtml(cell.text || '') + '</p>';
  }

  function renderPreviewFromState(state) {
    var rows = (state.formRows || []).map(function (row) {
      var cells = (row.cells || []).map(function (cell) {
        var alignClass = cell.align ? ' col-align-' + escapeHtml(cell.align) : '';
      return '<div class="col' + alignClass + '" style="' + resolvePreviewColumnWidthStyle(cell.width) + '">' +
          renderPreviewCell(cell, state) +
        '</div>';
      }).join('');
      return '<div class="row" style="min-height:' + escapeHtml(Math.max(48, Number(row.height || 80))) + 'px">' + cells + '</div>';
    }).join('');
    return rows || '<div class="card"><p class="muted">Add rows and cells to see a preview.</p></div>';
  }

  function renderCellMiniPreview(cell, state) {
    return '<div class="builder-canvas-cell-preview builder-canvas-cell-preview--' + escapeHtml(cell.contentType) + '">' + renderPreviewCell(cell, state) + '</div>';
  }

  function getSelectedRowIndex(selection) {
    if (!selection) return -1;
    if (selection.kind === 'row') return Number(selection.rowIndex);
    if (selection.kind === 'cell') return Number(selection.rowIndex);
    return -1;
  }

  function gcd(a, b) {
    var left = Math.abs(Number(a || 0));
    var right = Math.abs(Number(b || 0));
    while (right) {
      var next = left % right;
      left = right;
      right = next;
    }
    return left || 1;
  }

  function summarizeRowDistribution(row) {
    var spans = (row && row.cells ? row.cells : []).map(function (cell) {
      return Math.max(1, Number(cell.width || 1));
    });
    if (!spans.length) return '1';
    var divisor = spans.reduce(function (current, value) {
      return gcd(current, value);
    }, spans[0]);
    return spans.map(function (value) {
      return String(Math.max(1, Math.round(value / divisor)));
    }).join(':');
  }

  function renderFieldLibrarySummary(fields, selection) {
    if (!fields.length) return '<p class="muted">No fields yet.</p>';
    return '<div class="builder-library-chip-list">' + fields.map(function (field, index) {
      var isSelected = selection && selection.kind === 'field' && selection.fieldIndex === index;
      return '<button class="builder-library-chip' + (isSelected ? ' is-selected' : '') + '" type="button" data-builder-select-field="' + index + '">' +
        '<div class="builder-library-chip-type">' + escapeHtml(field.type || 'field') + '</div>' +
        '<strong>' + escapeHtml(field.label || field.key || 'Unnamed field') + '</strong>' +
        '<div class="muted"><code>' + escapeHtml(field.key || '') + '</code></div>' +
      '</button>';
    }).join('') + '</div>';
  }

  function renderActionLibrarySummary(actions) {
    if (!actions.length) return '<p class="muted">No form actions yet.</p>';
    return '<div class="builder-library-chip-list">' + actions.map(function (action) {
      return '<article class="builder-library-chip">' +
        '<div class="builder-library-chip-type">' + escapeHtml(action.type || 'action') + '</div>' +
        '<strong>' + escapeHtml(action.key || 'Unnamed action') + '</strong>' +
      '</article>';
    }).join('') + '</div>';
  }

  function renderFieldEditor(field, index, readonly) {
    var supportsOptions = field.type === 'radioGroup' || field.type === 'checkboxGroup';
    var supportsLookup = field.type === 'lookup';
    var supportsTextarea = field.type === 'textarea';
    var supportsJournal = field.type === 'journal';
    return '' +
      '<div class="builder-property-stack">' +
      '<div class="builder-panel-header"><div><h5>Field</h5><p class="muted">' + escapeHtml(field.label || field.key || 'Unnamed field') + '</p></div>' +
      (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-field="' + index + '">Delete field</button>') +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' +
        '<label><span>Key</span><input type="text" data-builder-bind="fields.' + index + '.key" value="' + escapeHtml(field.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Label</span><input type="text" data-builder-bind="fields.' + index + '.label" value="' + escapeHtml(field.label) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' +
        '<label><span>Type</span><select data-builder-bind="fields.' + index + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['text', 'textarea', 'lookup', 'radioGroup', 'checkboxGroup', 'journal', 'checkbox', 'date'].map(function (type) {
            return '<option value="' + type + '" ' + (field.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
        '<label><span>Required</span><select data-builder-bind="fields.' + index + '.required" ' + (readonly ? 'disabled' : '') + '>' +
          '<option value="false" ' + (!field.required ? 'selected' : '') + '>no</option>' +
          '<option value="true" ' + (field.required ? 'selected' : '') + '>yes</option>' +
        '</select></label>' +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' +
        '<label><span>Placeholder</span><input type="text" data-builder-bind="fields.' + index + '.placeholder" value="' + escapeHtml(field.placeholder) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Help text</span><input type="text" data-builder-bind="fields.' + index + '.helpText" value="' + escapeHtml(field.helpText) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>' +
      (supportsTextarea ? '<div class="builder-grid builder-grid-2"><label><span>Rows</span><input type="number" min="2" data-builder-bind="fields.' + index + '.rows" value="' + escapeHtml(field.rows) + '" ' + (readonly ? 'disabled' : '') + ' /></label></div>' : '') +
      (supportsLookup
        ? '<div class="builder-grid builder-grid-3">' +
            '<label><span>apiRef</span><input type="text" data-builder-bind="fields.' + index + '.apiRef" value="' + escapeHtml(field.apiRef) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
            '<label><span>valueKey</span><input type="text" data-builder-bind="fields.' + index + '.valueKey" value="' + escapeHtml(field.valueKey) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
            '<label><span>labelKey</span><input type="text" data-builder-bind="fields.' + index + '.labelKey" value="' + escapeHtml(field.labelKey) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
          '</div>'
        : '') +
      (supportsOptions ? renderOptionTable(field.options || [], 'fields.' + index, readonly) : '') +
      (supportsJournal ? '<div class="builder-inline-block"><h6>Journal columns</h6>' + renderJournalColumns(field.journalColumns || [], index, readonly) + '</div>' : '') +
      '</div>';
  }

  function renderRowProperties(row, rowIndex, readonly) {
    return '' +
      '<div class="builder-property-stack">' +
      '<div class="builder-panel-header"><div><h5>Row ' + (rowIndex + 1) + '</h5><p class="muted">This sidebar handles row metadata. Use the row configuration bar above the canvas for cells, distribution, height and row actions.</p></div></div>' +
      '<div class="builder-grid builder-grid-1">' +
        '<label><span>Row key (optional)</span><input type="text" data-builder-bind="formRows.' + rowIndex + '.key" value="' + escapeHtml(row.key || '') + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Stored height</span><input type="number" min="48" max="240" data-builder-bind="formRows.' + rowIndex + '.height" value="' + escapeHtml(row.height || 80) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>' +
      '</div>';
  }

  function renderCellProperties(cell, rowIndex, cellIndex, state, readonly) {
    var prefix = 'formRows.' + rowIndex + '.cells.' + cellIndex;
    var fieldOptions = state.fields.filter(function (field) { return field.type !== 'journal'; }).map(function (field) {
      return '<option value="' + escapeHtml(field.key) + '" ' + (field.key === cell.fieldKey ? 'selected' : '') + '>' + escapeHtml(field.label || field.key || '(unnamed field)') + ' [' + escapeHtml(field.key || '') + ']</option>';
    }).join('');
    var journalFieldOptions = state.fields.filter(function (field) { return field.type === 'journal'; }).map(function (field) {
      return '<option value="' + escapeHtml(field.key) + '" ' + (field.key === cell.fieldKey ? 'selected' : '') + '>' + escapeHtml(field.label || field.key || '(unnamed journal)') + ' [' + escapeHtml(field.key || '') + ']</option>';
    }).join('');
    var actionOptions = state.actions.map(function (action) {
      return '<option value="' + escapeHtml(action.key) + '" ' + (action.key === cell.action ? 'selected' : '') + '>' + escapeHtml(action.key || '(unnamed action)') + '</option>';
    }).join('');
    var contentFields = '';
    if (cell.contentType === 'field') {
      contentFields = '<label><span>Field reference</span><select data-builder-bind="' + prefix + '.fieldKey" ' + (readonly ? 'disabled' : '') + '><option value="">Select field…</option>' + fieldOptions + '</select></label>';
    } else if (cell.contentType === 'journal') {
      contentFields =
        '<label><span>Journal field</span><select data-builder-bind="' + prefix + '.fieldKey" ' + (readonly ? 'disabled' : '') + '><option value="">Select journal field…</option>' + journalFieldOptions + '</select></label>' +
        '<div class="muted">Journal cells place one journal field directly into the form flow.</div>';
    } else if (cell.contentType === 'attachmentArea') {
      contentFields =
        '<label><span>Section title</span><input type="text" data-builder-bind="' + prefix + '.attachmentTitle" value="' + escapeHtml(cell.attachmentTitle || '') + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Help text</span><input type="text" data-builder-bind="' + prefix + '.attachmentHelpText" value="' + escapeHtml(cell.attachmentHelpText || '') + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    } else if (cell.contentType === 'button') {
      contentFields =
        '<label><span>Action reference</span><select data-builder-bind="' + prefix + '.action" ' + (readonly ? 'disabled' : '') + '><option value="">Select action…</option>' + actionOptions + '</select></label>' +
        '<label><span>Button label</span><input type="text" data-builder-bind="' + prefix + '.label" value="' + escapeHtml(cell.label || '') + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    } else if (cell.contentType === 'spacer') {
      contentFields =
        '<label><span>Spacer size</span><select data-builder-bind="' + prefix + '.spacerSize" ' + (readonly ? 'disabled' : '') + '>' +
          ['sm', 'md', 'lg'].map(function (size) {
            return '<option value="' + size + '" ' + (cell.spacerSize === size ? 'selected' : '') + '>' + size + '</option>';
          }).join('') +
        '</select></label>';
    } else {
      contentFields =
        '<label><span>Text style</span><select data-builder-bind="' + prefix + '.markdownStyle" ' + (readonly ? 'disabled' : '') + '>' +
          [['heading1', 'Heading 1'], ['heading2', 'Heading 2'], ['text', 'Text'], ['hint', 'Hint'], ['divider', 'Divider']].map(function (item) {
            return '<option value="' + item[0] + '" ' + (cell.markdownStyle === item[0] ? 'selected' : '') + '>' + item[1] + '</option>';
          }).join('') +
        '</select></label>' +
        '<label><span>Text</span><textarea rows="4" data-builder-bind="' + prefix + '.text" ' + (readonly ? 'disabled' : '') + '>' + escapeHtml(cell.text || '') + '</textarea></label>';
    }
    return '' +
      '<div class="builder-property-stack">' +
      '<div class="builder-panel-header"><div><h5>Cell ' + (cellIndex + 1) + '</h5></div></div>' +
      renderCellMiniPreview(cell, state) +
      (readonly ? '' : '<div class="builder-action-row builder-action-row--left">' +
        '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-move-cell-left="' + rowIndex + '.' + cellIndex + '" aria-label="Move cell left" title="Move cell left">←</button>' +
        '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-move-cell-right="' + rowIndex + '.' + cellIndex + '" aria-label="Move cell right" title="Move cell right">→</button>' +
        '<button class="builder-icon-button builder-row-action-button builder-row-action-button--danger" type="button" data-builder-remove-cell="' + rowIndex + '.' + cellIndex + '" aria-label="Delete cell" title="Delete cell">🗑</button>' +
      '</div>') +
      '<div class="builder-grid builder-grid-3">' +
        '<label><span>Width</span><input type="number" min="1" max="12" data-builder-bind="' + prefix + '.width" value="' + escapeHtml(cell.width) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Align</span><select data-builder-bind="' + prefix + '.align" ' + (readonly ? 'disabled' : '') + '>' +
          ['left', 'center', 'right'].map(function (align) {
            return '<option value="' + align + '" ' + (cell.align === align ? 'selected' : '') + '>' + align + '</option>';
          }).join('') +
        '</select></label>' +
        '<label><span>Content</span><select data-builder-bind="' + prefix + '.contentType" ' + (readonly ? 'disabled' : '') + '>' +
          ['field', 'markdown', 'button', 'spacer', 'journal', 'attachmentArea'].map(function (type) {
            return '<option value="' + type + '" ' + (cell.contentType === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' + contentFields + '</div>' +
      '</div>';
  }

  function renderToolRail(state, selection, readonly) {
    var activeRowIndex = getSelectedRowIndex(selection);
    var selectedCell = selection && selection.kind === 'cell'
      ? 'Cell ' + (selection.cellIndex + 1) + ' in row ' + (selection.rowIndex + 1)
      : '';
    var selectedRow = activeRowIndex >= 0 ? 'Row ' + (activeRowIndex + 1) : '';
    var selectedLabel = selectedCell || selectedRow || 'No selection';
    return '' +
      '<div class="builder-tool-group">' +
        '<div class="builder-tool-context" title="' + escapeHtml(selectedLabel) + '">' +
          '<div class="summary-label">Target</div>' +
          '<strong>' + escapeHtml(selection ? selectedLabel : '—') + '</strong>' +
        '</div>' +
        '<div class="builder-tool-list">' +
          (readonly ? '' : CONTROL_TYPES.map(function (type) {
            return '<button class="builder-tool-button builder-icon-button" type="button" data-builder-apply-content="' + type + '" aria-label="' + escapeHtml(labelForContentType(type)) + '" title="' + escapeHtml(labelForContentType(type)) + '">' + iconForContentType(type) + '</button>';
          }).join('') +
          '<button class="builder-tool-button builder-icon-button builder-tool-button--accent" type="button" data-builder-add-row aria-label="Add row" title="Add row">＋</button>') +
        '</div>' +
      '</div>';
  }

  function renderRowConfigurationBar(state, selection, readonly) {
    var rowIndex = getSelectedRowIndex(selection);
    if (rowIndex < 0 || !state.formRows[rowIndex]) {
      return '' +
        '<div class="builder-row-toolbar-empty">' +
          '<div><strong>Row Configuration</strong><p class="muted">Select a row or any cell on the canvas. This toolbar will then control the active row.</p></div>' +
          (readonly ? '' : '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-add-row aria-label="Add row" title="Add row">＋</button>') +
        '</div>';
    }
    var row = state.formRows[rowIndex];
    return '' +
      '<div class="builder-row-toolbar-grid">' +
        '<div class="builder-row-toolbar-title">' +
          '<div class="builder-eyebrow">Row Configuration</div>' +
          '<strong>Row ' + (rowIndex + 1) + '</strong>' +
        '</div>' +
        '<label><span># Cells</span><input type="number" min="1" max="6" data-builder-row-cells value="' + escapeHtml((row.cells || []).length) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Distribution</span><input type="text" data-builder-row-distribution value="' + escapeHtml(summarizeRowDistribution(row)) + '" placeholder="1:2:1" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Height</span><input type="number" min="48" max="240" step="8" data-builder-row-height value="' + escapeHtml(row.height || 80) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        (readonly ? '' : (
          '<div class="builder-row-toolbar-actions">' +
            '<button class="btn btn-secondary" type="button" data-builder-apply-row-config="' + rowIndex + '">Apply</button>' +
            '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-add-row-after="' + rowIndex + '" aria-label="Add row" title="Add row">＋</button>' +
            '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-move-row-up="' + rowIndex + '" aria-label="Move row up" title="Move row up">↑</button>' +
            '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-move-row-down="' + rowIndex + '" aria-label="Move row down" title="Move row down">↓</button>' +
            '<button class="builder-icon-button builder-row-action-button builder-row-action-button--danger" type="button" data-builder-remove-row="' + rowIndex + '" aria-label="Delete row" title="Delete row">🗑</button>' +
          '</div>'
        )) +
      '</div>';
  }

  function ensureSelection(state, selection) {
    if (selection && selection.kind === 'cell') {
      if (state.formRows[selection.rowIndex] && state.formRows[selection.rowIndex].cells[selection.cellIndex]) return selection;
    }
    if (selection && selection.kind === 'row') {
      if (state.formRows[selection.rowIndex]) return selection;
    }
    if (selection && selection.kind === 'field') {
      var existingFieldIndex = typeof selection.fieldIndex === 'number' ? selection.fieldIndex : -1;
      if (existingFieldIndex >= 0 && state.fields[existingFieldIndex]) return selection;
    }
    return null;
  }

  function renderPropertiesPanel(state, selection, readonly) {
    if (!selection) {
      return '<div class="muted-card"><p class="muted">Select a row, cell or field to edit its properties.</p></div>';
    }
    if (selection.kind === 'field') {
      var fieldIndex = typeof selection.fieldIndex === 'number' ? selection.fieldIndex : -1;
      if (fieldIndex >= 0) return renderFieldEditor(state.fields[fieldIndex], fieldIndex, readonly);
    }
    if (selection.kind === 'row' && state.formRows[selection.rowIndex]) {
      return renderRowProperties(state.formRows[selection.rowIndex], selection.rowIndex, readonly);
    }
    if (selection.kind === 'cell' && state.formRows[selection.rowIndex] && state.formRows[selection.rowIndex].cells[selection.cellIndex]) {
      return renderCellProperties(state.formRows[selection.rowIndex].cells[selection.cellIndex], selection.rowIndex, selection.cellIndex, state, readonly);
    }
    return '<div class="muted-card"><p class="muted">Selected element is no longer available.</p></div>';
  }

  function renderFormCell(rowIndex, cell, cellIndex, state, readonly, selected) {
    return '' +
      '<article class="builder-subcard builder-cell-card builder-cell-card--' + escapeHtml(cell.contentType) + (selected ? ' is-selected' : '') + '">' +
      '<div class="builder-canvas-select" role="button" tabindex="0" data-builder-select-cell="' + rowIndex + '.' + cellIndex + '">' +
          '<div class="builder-cell-badge-row">' +
          '<span class="builder-cell-badge">Cell ' + (cellIndex + 1) + '</span>' +
          '<span class="builder-cell-meta">' + escapeHtml(cell.contentType) + ' · ' + escapeHtml(cell.width) + '/12 · ' + escapeHtml(cell.align) + '</span>' +
        '</div>' +
        renderCellMiniPreview(cell, state) +
      '</div>' +
      '</article>';
  }

  function renderFormRow(row, rowIndex, state, readonly, selection) {
    var selectedRowIndex = getSelectedRowIndex(selection);
    var isRowSelected = selectedRowIndex === rowIndex;
    return '' +
      '<article class="builder-card builder-row-card' + (isRowSelected ? ' is-selected' : '') + '">' +
      '<div class="builder-panel-header">' +
      '<div><h5>Row ' + (rowIndex + 1) + '</h5></div>' +
      '<div class="builder-action-row">' +
        '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-select-row="' + rowIndex + '" aria-label="Edit row" title="Edit row">✎</button>' +
        (readonly ? '' : '<button class="builder-icon-button builder-row-action-button" type="button" data-builder-open-add-cell-dialog="' + rowIndex + '" aria-label="Add cell" title="Add cell">＋</button>') +
      '</div>' +
      '</div>' +
      '<div class="builder-canvas-row" style="min-height:' + escapeHtml(Math.max(48, Number(row.height || 80))) + 'px">' + (row.cells || []).map(function (cell, cellIndex) {
        var isCellSelected = selection && selection.kind === 'cell' && selection.rowIndex === rowIndex && selection.cellIndex === cellIndex;
        return '<div class="builder-canvas-col builder-canvas-col--' + escapeHtml(cell.contentType) + '" style="' + resolvePreviewColumnWidthStyle(cell.width) + '">' +
          renderFormCell(rowIndex, cell, cellIndex, state, readonly, isCellSelected) +
        '</div>';
      }).join('') + '</div>' +
      '</article>';
  }

  function renderStepEditor(step, actionIndex, stepIndex, readonly) {
    var prefix = 'actions.' + actionIndex + '.steps.' + stepIndex;
    var body = '';
    if (step.type === 'require') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>from</span><input type="text" data-builder-bind="' + prefix + '.from" value="' + escapeHtml(step.from) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Message</span><input type="text" data-builder-bind="' + prefix + '.message" value="' + escapeHtml(step.message) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>';
    } else if (step.type === 'requireField') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>Field key</span><input type="text" data-builder-bind="' + prefix + '.key" value="' + escapeHtml(step.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Message</span><input type="text" data-builder-bind="' + prefix + '.message" value="' + escapeHtml(step.message) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>';
    } else if (step.type === 'callApi') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>apiRef</span><input type="text" data-builder-bind="' + prefix + '.apiRef" value="' + escapeHtml(step.apiRef) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(step.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>' +
      '<label><span>Request JSON</span><textarea rows="6" data-builder-bind="' + prefix + '.requestJson" ' + (readonly ? 'disabled' : '') + '>' + escapeHtml(step.requestJson || '{}') + '</textarea></label>';
    } else if (step.type === 'write') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(step.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>value</span><input type="text" data-builder-bind="' + prefix + '.value" value="' + escapeHtml(step.value) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>';
    } else if (step.type === 'setStatus') {
      body = '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(step.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    } else if (step.type === 'customJson') {
      body = '<label><span>Custom JSON</span><textarea rows="6" data-builder-bind="' + prefix + '.customJson" ' + (readonly ? 'disabled' : '') + '>' + escapeHtml(step.customJson || '{}') + '</textarea></label>';
    } else {
      body = '<label><span>Message</span><input type="text" data-builder-bind="' + prefix + '.value" value="' + escapeHtml(step.value) + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    }

    return '' +
      '<article class="builder-subcard">' +
      '<div class="builder-panel-header">' +
        '<h6>Step ' + (stepIndex + 1) + '</h6>' +
        (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-step="' + actionIndex + '.' + stepIndex + '">Remove step</button>') +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' +
        '<label><span>Type</span><select data-builder-bind="' + prefix + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['message', 'require', 'requireField', 'callApi', 'write', 'setStatus', 'customJson'].map(function (type) {
            return '<option value="' + type + '" ' + (step.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' + body +
      '</article>';
  }

  function renderActionCard(action, index, readonly) {
    var prefix = 'actions.' + index;
    var body = '';
    if (action.type === 'composite') {
      body = (action.steps || []).map(function (step, stepIndex) {
        return renderStepEditor(step, index, stepIndex, readonly);
      }).join('') + (readonly ? '' : '<div class="actions"><button class="btn btn-secondary" type="button" data-builder-add-step="' + index + '">Add step</button></div>');
    } else if (action.type === 'callApi') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>apiRef</span><input type="text" data-builder-bind="' + prefix + '.apiRef" value="' + escapeHtml(action.apiRef) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(action.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>' +
      '<label><span>Request JSON</span><textarea rows="6" data-builder-bind="' + prefix + '.requestJson" ' + (readonly ? 'disabled' : '') + '>' + escapeHtml(action.requestJson || '{}') + '</textarea></label>';
    } else if (action.type === 'write') {
      body = '<div class="builder-grid builder-grid-2">' +
        '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(action.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>value</span><input type="text" data-builder-bind="' + prefix + '.value" value="' + escapeHtml(action.value) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
      '</div>';
    } else if (action.type === 'setStatus') {
      body = '<label><span>to</span><input type="text" data-builder-bind="' + prefix + '.to" value="' + escapeHtml(action.to) + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    } else if (action.type === 'customJson') {
      body = '<label><span>Custom JSON</span><textarea rows="8" data-builder-bind="' + prefix + '.customJson" ' + (readonly ? 'disabled' : '') + '>' + escapeHtml(action.customJson || '{}') + '</textarea></label>';
    } else {
      body = '<label><span>Message</span><input type="text" data-builder-bind="' + prefix + '.value" value="' + escapeHtml(action.value) + '" ' + (readonly ? 'disabled' : '') + ' /></label>';
    }

    return '' +
      '<article class="builder-card">' +
      '<div class="builder-panel-header">' +
        '<h5>Action ' + (index + 1) + '</h5>' +
        (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-action="' + index + '">Delete action</button>') +
      '</div>' +
      '<div class="builder-grid builder-grid-2">' +
        '<label><span>Key</span><input type="text" data-builder-bind="' + prefix + '.key" value="' + escapeHtml(action.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
        '<label><span>Type</span><select data-builder-bind="' + prefix + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['composite', 'callApi', 'message', 'write', 'setStatus', 'customJson'].map(function (type) {
            return '<option value="' + type + '" ' + (action.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' + body +
      '</article>';
  }

  function setAtPath(target, path, rawValue) {
    var segments = String(path || '').split('.');
    var cursor = target;
    for (var index = 0; index < segments.length - 1; index += 1) {
      var segment = segments[index];
      if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return;
      cursor = cursor[segment];
    }
    var leaf = segments[segments.length - 1];
    if (leaf === 'required') {
      cursor[leaf] = rawValue === 'true';
    } else if (leaf === 'rows' || leaf === 'width' || leaf === 'span' || leaf === 'height') {
      cursor[leaf] = Number(rawValue || 0);
    } else {
      cursor[leaf] = rawValue;
    }
  }

  function applyDefaultContentType(cell, contentType) {
    var defaults = createDefaultCell(contentType);
    cell.contentType = defaults.contentType;
    cell.fieldKey = defaults.fieldKey;
    cell.markdownStyle = defaults.markdownStyle;
    cell.text = defaults.text;
    cell.action = defaults.action;
    cell.label = defaults.label;
    cell.spacerSize = defaults.spacerSize;
    cell.attachmentTitle = defaults.attachmentTitle;
    cell.attachmentHelpText = defaults.attachmentHelpText;
  }

  function resolveSpanDistribution(cellCount, distributionText) {
    var count = Math.max(1, Math.min(6, Number(cellCount || 1)));
    var raw = String(distributionText || '')
      .split(':')
      .map(function (part) { return Number(String(part || '').trim()); })
      .filter(function (value) { return Number.isFinite(value) && value > 0; });

    while (raw.length < count) raw.push(1);
    raw = raw.slice(0, count);
    if (!raw.length) raw = new Array(count).fill(1);

    var total = raw.reduce(function (sum, value) { return sum + value; }, 0);
    var spans = raw.map(function (value) {
      return Math.max(1, Math.round((value / total) * 12));
    });
    var currentTotal = spans.reduce(function (sum, value) { return sum + value; }, 0);
    while (currentTotal < 12) {
      var minIndex = spans.indexOf(Math.min.apply(Math, spans));
      spans[minIndex] += 1;
      currentTotal += 1;
    }
    while (currentTotal > 12) {
      var maxIndex = spans.indexOf(Math.max.apply(Math, spans));
      if (spans[maxIndex] <= 1) break;
      spans[maxIndex] -= 1;
      currentTotal -= 1;
    }
    return spans;
  }

  function applyRowConfiguration(state, rowIndex, cellCount, distributionText, height) {
    if (!state.formRows[rowIndex]) return;
    var row = state.formRows[rowIndex];
    var count = Math.max(1, Math.min(6, Number(cellCount || (row.cells || []).length || 1)));
    var spans = resolveSpanDistribution(count, distributionText);
    var nextCells = [];
    for (var index = 0; index < count; index += 1) {
      var existing = row.cells[index] ? clone(row.cells[index]) : createDefaultCell();
      existing.width = spans[index] || 12;
      nextCells.push(existing);
    }
    row.cells = nextCells;
    row.height = Math.max(48, Math.min(240, Number(height || row.height || 80)));
  }

  function renderBuilder(root, state, textarea, readonly, currentSelection) {
    var fieldsContainer = root.querySelector('[data-builder-fields]');
    var formRowsContainer = root.querySelector('[data-builder-form-rows]');
    var actionsContainer = root.querySelector('[data-builder-actions]');
    var validation = root.querySelector('[data-builder-validation]');
    var documentTableContainer = root.querySelector('[data-builder-document-table]');
    var toolsContainer = root.querySelector('[data-builder-tools]');
    var rowConfigContainer = root.querySelector('[data-builder-row-config]');
    var propertiesContainer = root.closest('.template-builder-card').querySelector('[data-builder-properties]');
    var previewContainer = root.closest('.template-builder-card').querySelector('[data-builder-preview]');
    var templateNameTarget = root.closest('.template-builder-card').querySelector('[data-builder-template-name]');
    var templateKeyTarget = root.closest('.template-builder-card').querySelector('[data-builder-template-key]');
    var workflowRefTarget = root.closest('.template-builder-card').querySelector('[data-builder-workflow-ref]');
    var stage = root.querySelector('.builder-stage');
    var propertiesStage = root.querySelector('.builder-properties-stage');
    var form = root.closest('form');
    var templateNameInput = form ? form.querySelector('#name') : null;
    var templateKeyInput = form ? form.querySelector('#key') : null;
    var workflowRefInput = form ? form.querySelector('#workflow_ref') : null;

    var output = buildTemplateJsonFromState(state);
    textarea.value = JSON.stringify(output.templateJson, null, 2);

    formRowsContainer.innerHTML = state.formRows.length
      ? state.formRows.map(function (row, index) { return renderFormRow(row, index, state, readonly, currentSelection); }).join('')
      : '<p class="muted">No rows yet.</p>';
    fieldsContainer.innerHTML = state.fields.length
      ? '<div class="builder-library-summary">' + renderFieldLibrarySummary(state.fields, currentSelection) + '</div>'
      : '<p class="muted">No fields yet.</p>';
    if (toolsContainer) toolsContainer.innerHTML = renderToolRail(state, currentSelection, readonly);
    if (rowConfigContainer) rowConfigContainer.innerHTML = renderRowConfigurationBar(state, currentSelection, readonly);
    actionsContainer.innerHTML = state.actions.length
      ? '<div class="builder-library-summary">' + renderActionLibrarySummary(state.actions) + '</div>' + state.actions.map(function (action, index) { return renderActionCard(action, index, readonly); }).join('')
      : '<p class="muted">No form actions yet.</p>';
    documentTableContainer.innerHTML = renderDocumentTableEditor(state.documentTable, readonly);
    if (propertiesContainer) propertiesContainer.innerHTML = renderPropertiesPanel(state, currentSelection, readonly);
    if (previewContainer) previewContainer.innerHTML = renderPreviewFromState(state);
    var showProperties = Boolean(currentSelection && (currentSelection.kind === 'row' || currentSelection.kind === 'cell' || currentSelection.kind === 'field'));
    if (stage) stage.classList.toggle('has-properties', showProperties);
    if (propertiesStage) propertiesStage.hidden = !showProperties;
    if (templateNameTarget) templateNameTarget.textContent = templateNameInput && templateNameInput.value.trim() ? templateNameInput.value.trim() : 'Untitled Template';
    if (templateKeyTarget) templateKeyTarget.textContent = templateKeyInput && templateKeyInput.value.trim() ? templateKeyInput.value.trim() : 'template-key';
    if (workflowRefTarget) workflowRefTarget.textContent = workflowRefInput && workflowRefInput.value.trim() ? workflowRefInput.value.trim() : '—';
    validation.innerHTML = output.errors.length === 0
      ? '<div class="success-card"><strong>Valid:</strong> Builder output matches the row/cell V1 form model and is ready to save.</div>'
      : '<div class="error-card"><strong>Builder issues:</strong><ul>' + output.errors.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul></div>';
  }

  function mountBuilder(root) {
    var readonly = root.getAttribute('data-readonly') === 'true';
    var textareaId = root.getAttribute('data-template-json-source');
    var textarea = document.getElementById(textareaId);
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    var card = root.closest('.template-builder-card');
    var setActiveView = initBuilderTabs(card);

    var initialTemplate = safeParseJson(textarea.value, { fields: {}, form: { rows: [createDefaultFormRow()] }, actions: {}, documentTable: { columns: [] } });
    var state = builderStateFromTemplate(initialTemplate);
    var currentSelection = null;
    var cellPickerDialog = root.querySelector('[data-builder-cell-picker]');
    var pendingCellInsertRowIndex = -1;

    function closeCellPicker() {
      pendingCellInsertRowIndex = -1;
      if (cellPickerDialog && typeof cellPickerDialog.close === 'function' && cellPickerDialog.open) {
        cellPickerDialog.close();
      }
    }

    function rerender() {
      currentSelection = ensureSelection(state, currentSelection);
      renderBuilder(root, state, textarea, readonly, currentSelection);
    }

    root.addEventListener('input', function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      var path = target.getAttribute('data-builder-bind');
      if (!path) return;
      setAtPath(state, path, target.value);
      if (path.indexOf('fields.') === 0 && path.endsWith('.type')) {
        var fieldIndex = Number(path.split('.')[1]);
        if (state.fields[fieldIndex]) {
          state.fields[fieldIndex].options = Array.isArray(state.fields[fieldIndex].options) ? state.fields[fieldIndex].options : [];
          state.fields[fieldIndex].journalColumns = Array.isArray(state.fields[fieldIndex].journalColumns) ? state.fields[fieldIndex].journalColumns : [];
        }
      }
      if (path.indexOf('formRows.') === 0 && path.endsWith('.contentType')) {
        var pathSegments = path.split('.');
        var rowIndex = Number(pathSegments[1]);
        var cellIndex = Number(pathSegments[3]);
        if (state.formRows[rowIndex] && state.formRows[rowIndex].cells[cellIndex]) {
          var cell = state.formRows[rowIndex].cells[cellIndex];
          if (cell.contentType === 'field') {
            cell.fieldKey = cell.fieldKey || '';
          } else if (cell.contentType === 'journal') {
            cell.fieldKey = cell.fieldKey || '';
          } else if (cell.contentType === 'attachmentArea') {
            cell.attachmentTitle = cell.attachmentTitle || 'Attachments';
            cell.attachmentHelpText = cell.attachmentHelpText || 'Attachments and images are managed on the document workspace.';
          } else if (cell.contentType === 'button') {
            cell.action = cell.action || '';
            cell.label = cell.label || '';
          } else if (cell.contentType === 'spacer') {
            cell.spacerSize = cell.spacerSize || 'md';
          } else {
            cell.markdownStyle = cell.markdownStyle || 'text';
            cell.text = cell.text || '';
          }
        }
      }
      if (path.indexOf('actions.') === 0 && path.endsWith('.type')) {
        var actionPath = path.split('.');
        var actionIndex = Number(actionPath[1]);
        if (actionPath.length === 3) {
          if (state.actions[actionIndex] && state.actions[actionIndex].type === 'composite' && !Array.isArray(state.actions[actionIndex].steps)) {
            state.actions[actionIndex].steps = [createDefaultActionStep()];
          }
        }
      }
      rerender();
    });

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (readonly) return;
      var actionTarget = target.closest(
        '[data-builder-add-field],' +
        '[data-builder-apply-content],' +
        '[data-builder-remove-field],' +
        '[data-builder-select-field],' +
        '[data-builder-add-option],' +
        '[data-builder-remove-option],' +
        '[data-builder-add-journal-column],' +
        '[data-builder-remove-journal-column],' +
        '[data-builder-add-row],' +
        '[data-builder-add-row-after],' +
        '[data-builder-apply-row-config],' +
        '[data-builder-add-row-content],' +
        '[data-builder-select-row],' +
        '[data-builder-select-cell],' +
        '[data-builder-remove-row],' +
        '[data-builder-move-row-up],' +
        '[data-builder-move-row-down],' +
        '[data-builder-add-cell],' +
        '[data-builder-add-cell-content],' +
        '[data-builder-open-add-cell-dialog],' +
        '[data-builder-picker-type],' +
        '[data-builder-close-cell-picker],' +
        '[data-builder-clear-selection],' +
        '[data-builder-remove-cell],' +
        '[data-builder-move-cell-left],' +
        '[data-builder-move-cell-right],' +
        '[data-builder-add-doc-column],' +
        '[data-builder-remove-doc-column],' +
        '[data-builder-add-action],' +
        '[data-builder-remove-action],' +
        '[data-builder-add-step],' +
        '[data-builder-remove-step]'
      );
      if (!(actionTarget instanceof HTMLElement)) return;
      target = actionTarget;

      if (target.matches('[data-builder-add-field]')) {
        state.fields.push(createDefaultField());
        currentSelection = { kind: 'field', fieldIndex: state.fields.length - 1 };
        rerender();
      } else if (target.matches('[data-builder-apply-content]')) {
        var contentType = String(target.getAttribute('data-builder-apply-content') || 'field');
        if (currentSelection && currentSelection.kind === 'cell' && state.formRows[currentSelection.rowIndex] && state.formRows[currentSelection.rowIndex].cells[currentSelection.cellIndex]) {
          applyDefaultContentType(state.formRows[currentSelection.rowIndex].cells[currentSelection.cellIndex], contentType);
        } else {
          var activeRowIndex = getSelectedRowIndex(currentSelection);
          if (activeRowIndex >= 0 && state.formRows[activeRowIndex]) {
            state.formRows[activeRowIndex].cells.push(createDefaultCell(contentType));
            currentSelection = { kind: 'cell', rowIndex: activeRowIndex, cellIndex: state.formRows[activeRowIndex].cells.length - 1 };
          } else {
            state.formRows.push(createDefaultFormRow(contentType));
            currentSelection = { kind: 'cell', rowIndex: state.formRows.length - 1, cellIndex: 0 };
          }
        }
        rerender();
      } else if (target.matches('[data-builder-remove-field]')) {
        state.fields.splice(Number(target.getAttribute('data-builder-remove-field')), 1);
        rerender();
      } else if (target.matches('[data-builder-select-field]')) {
        currentSelection = { kind: 'field', fieldIndex: Number(target.getAttribute('data-builder-select-field')) };
        rerender();
      } else if (target.matches('[data-builder-add-option]')) {
        var fieldIndex = Number(String(target.getAttribute('data-builder-add-option') || '').split('.')[1]);
        if (state.fields[fieldIndex]) state.fields[fieldIndex].options.push(createDefaultOption());
        rerender();
      } else if (target.matches('[data-builder-remove-option]')) {
        var optionPath = String(target.getAttribute('data-builder-remove-option') || '').split('.');
        var removeFieldIndex = Number(optionPath[1]);
        var removeOptionIndex = Number(optionPath[2]);
        if (state.fields[removeFieldIndex]) state.fields[removeFieldIndex].options.splice(removeOptionIndex, 1);
        rerender();
      } else if (target.matches('[data-builder-add-journal-column]')) {
        var journalFieldIndex = Number(target.getAttribute('data-builder-add-journal-column'));
        if (state.fields[journalFieldIndex]) state.fields[journalFieldIndex].journalColumns.push(createDefaultJournalColumn());
        rerender();
      } else if (target.matches('[data-builder-remove-journal-column]')) {
        var columnPath = String(target.getAttribute('data-builder-remove-journal-column') || '').split('.');
        var removeJournalFieldIndex = Number(columnPath[0]);
        var removeColumnIndex = Number(columnPath[1]);
        if (state.fields[removeJournalFieldIndex]) state.fields[removeJournalFieldIndex].journalColumns.splice(removeColumnIndex, 1);
        rerender();
      } else if (target.matches('[data-builder-add-row]')) {
        state.formRows.push(createDefaultFormRow());
        currentSelection = { kind: 'cell', rowIndex: state.formRows.length - 1, cellIndex: 0 };
        rerender();
      } else if (target.matches('[data-builder-add-row-after]')) {
        var insertAfterIndex = Number(target.getAttribute('data-builder-add-row-after'));
        state.formRows.splice(insertAfterIndex + 1, 0, createDefaultFormRow());
        currentSelection = { kind: 'cell', rowIndex: insertAfterIndex + 1, cellIndex: 0 };
        rerender();
      } else if (target.matches('[data-builder-apply-row-config]')) {
        var targetRowIndex = Number(target.getAttribute('data-builder-apply-row-config'));
        var rowConfig = root.querySelector('[data-builder-row-config]');
        if (rowConfig) {
          var countInput = rowConfig.querySelector('[data-builder-row-cells]');
          var distributionInput = rowConfig.querySelector('[data-builder-row-distribution]');
          var heightInput = rowConfig.querySelector('[data-builder-row-height]');
          applyRowConfiguration(
            state,
            targetRowIndex,
            countInput && 'value' in countInput ? countInput.value : '',
            distributionInput && 'value' in distributionInput ? distributionInput.value : '',
            heightInput && 'value' in heightInput ? heightInput.value : ''
          );
          currentSelection = { kind: 'row', rowIndex: targetRowIndex };
        }
        rerender();
      } else if (target.matches('[data-builder-add-row-content]')) {
        state.formRows.push(createDefaultFormRow(target.getAttribute('data-builder-add-row-content') || 'field'));
        currentSelection = { kind: 'cell', rowIndex: state.formRows.length - 1, cellIndex: 0 };
        rerender();
      } else if (target.matches('[data-builder-select-row]')) {
        currentSelection = { kind: 'row', rowIndex: Number(target.getAttribute('data-builder-select-row')) };
        rerender();
      } else if (target.matches('[data-builder-select-cell]')) {
        var selectedCellPath = String(target.getAttribute('data-builder-select-cell') || '').split('.');
        currentSelection = { kind: 'cell', rowIndex: Number(selectedCellPath[0]), cellIndex: Number(selectedCellPath[1]) };
        rerender();
      } else if (target.matches('[data-builder-remove-row]')) {
        state.formRows.splice(Number(target.getAttribute('data-builder-remove-row')), 1);
        rerender();
      } else if (target.matches('[data-builder-move-row-up]')) {
        var moveRowUpIndex = Number(target.getAttribute('data-builder-move-row-up'));
        moveItem(state.formRows, moveRowUpIndex, moveRowUpIndex - 1);
        rerender();
      } else if (target.matches('[data-builder-move-row-down]')) {
        var moveRowDownIndex = Number(target.getAttribute('data-builder-move-row-down'));
        moveItem(state.formRows, moveRowDownIndex, moveRowDownIndex + 1);
        rerender();
      } else if (target.matches('[data-builder-add-cell]')) {
        var addCellRowIndex = Number(target.getAttribute('data-builder-add-cell'));
        if (state.formRows[addCellRowIndex]) state.formRows[addCellRowIndex].cells.push(createDefaultCell());
        currentSelection = { kind: 'cell', rowIndex: addCellRowIndex, cellIndex: state.formRows[addCellRowIndex].cells.length - 1 };
        rerender();
      } else if (target.matches('[data-builder-add-cell-content]')) {
        var addCellContentPath = String(target.getAttribute('data-builder-add-cell-content') || '').split('.');
        var addTypedCellRowIndex = Number(addCellContentPath[0]);
        var addTypedCellType = addCellContentPath[1] || 'field';
        if (state.formRows[addTypedCellRowIndex]) state.formRows[addTypedCellRowIndex].cells.push(createDefaultCell(addTypedCellType));
        currentSelection = { kind: 'cell', rowIndex: addTypedCellRowIndex, cellIndex: state.formRows[addTypedCellRowIndex].cells.length - 1 };
        rerender();
      } else if (target.matches('[data-builder-open-add-cell-dialog]')) {
        pendingCellInsertRowIndex = Number(target.getAttribute('data-builder-open-add-cell-dialog'));
        if (cellPickerDialog && typeof cellPickerDialog.showModal === 'function') cellPickerDialog.showModal();
      } else if (target.matches('[data-builder-picker-type]')) {
        var pickedType = String(target.getAttribute('data-builder-picker-type') || 'field');
        if (pendingCellInsertRowIndex >= 0 && state.formRows[pendingCellInsertRowIndex]) {
          state.formRows[pendingCellInsertRowIndex].cells.push(createDefaultCell(pickedType));
          currentSelection = { kind: 'cell', rowIndex: pendingCellInsertRowIndex, cellIndex: state.formRows[pendingCellInsertRowIndex].cells.length - 1 };
        }
        closeCellPicker();
        rerender();
      } else if (target.matches('[data-builder-close-cell-picker]')) {
        closeCellPicker();
      } else if (target.matches('[data-builder-clear-selection]')) {
        currentSelection = null;
        rerender();
      } else if (target.matches('[data-builder-remove-cell]')) {
        var removeCellPath = String(target.getAttribute('data-builder-remove-cell') || '').split('.');
        var removeCellRowIndex = Number(removeCellPath[0]);
        var removeCellIndex = Number(removeCellPath[1]);
        if (state.formRows[removeCellRowIndex]) state.formRows[removeCellRowIndex].cells.splice(removeCellIndex, 1);
        rerender();
      } else if (target.matches('[data-builder-move-cell-left]')) {
        var leftPath = String(target.getAttribute('data-builder-move-cell-left') || '').split('.');
        var leftRowIndex = Number(leftPath[0]);
        var leftCellIndex = Number(leftPath[1]);
        if (state.formRows[leftRowIndex]) moveItem(state.formRows[leftRowIndex].cells, leftCellIndex, leftCellIndex - 1);
        rerender();
      } else if (target.matches('[data-builder-move-cell-right]')) {
        var rightPath = String(target.getAttribute('data-builder-move-cell-right') || '').split('.');
        var rightRowIndex = Number(rightPath[0]);
        var rightCellIndex = Number(rightPath[1]);
        if (state.formRows[rightRowIndex]) moveItem(state.formRows[rightRowIndex].cells, rightCellIndex, rightCellIndex + 1);
        rerender();
      } else if (target.matches('[data-builder-add-doc-column]')) {
        state.documentTable.push({ key: '', label: '' });
        rerender();
      } else if (target.matches('[data-builder-remove-doc-column]')) {
        state.documentTable.splice(Number(target.getAttribute('data-builder-remove-doc-column')), 1);
        rerender();
      } else if (target.matches('[data-builder-add-action]')) {
        state.actions.push(createDefaultAction());
        rerender();
      } else if (target.matches('[data-builder-remove-action]')) {
        state.actions.splice(Number(target.getAttribute('data-builder-remove-action')), 1);
        rerender();
      } else if (target.matches('[data-builder-add-step]')) {
        var actionIndex = Number(target.getAttribute('data-builder-add-step'));
        if (state.actions[actionIndex]) state.actions[actionIndex].steps.push(createDefaultActionStep());
        rerender();
      } else if (target.matches('[data-builder-remove-step]')) {
        var stepPath = String(target.getAttribute('data-builder-remove-step') || '').split('.');
        var targetActionIndex = Number(stepPath[0]);
        var targetStepIndex = Number(stepPath[1]);
        if (state.actions[targetActionIndex]) state.actions[targetActionIndex].steps.splice(targetStepIndex, 1);
        rerender();
      }
    });

    if (cellPickerDialog instanceof HTMLDialogElement) {
      cellPickerDialog.addEventListener('click', function (event) {
        if (event.target === cellPickerDialog) closeCellPicker();
      });
      cellPickerDialog.addEventListener('cancel', function () {
        pendingCellInsertRowIndex = -1;
      });
    }

    var form = root.closest('form');
    if (form) {
      form.addEventListener('input', function (event) {
        var target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
        if (target.id === 'name' || target.id === 'key' || target.id === 'workflow_ref') rerender();
      });
    }

    var reloadButton = root.closest('.template-builder-card').querySelector('[data-builder-reload-from-json]');
    if (reloadButton) {
      reloadButton.addEventListener('click', function () {
        var parsed = safeParseJson(textarea.value, null);
        if (!parsed) {
          alert('template_json is not valid JSON.');
          return;
        }
        state = builderStateFromTemplate(parsed);
        rerender();
        setActiveView('builder');
      });
    }

    if (typeof setActiveView === 'function') setActiveView('builder');
    rerender();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.template-builder-card').forEach(function (card) {
      initBuilderTabs(card);
    });
    document.querySelectorAll('[data-template-builder]').forEach(function (root) {
      mountBuilder(root);
    });
  });
})();
