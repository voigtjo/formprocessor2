(function () {
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

  function createDefaultLayoutNode() {
    return { type: 'field', key: '' };
  }

  function createDefaultRowColumn() {
    return { width: 6, align: 'left', childType: 'field', key: '', action: '', label: '', text: '' };
  }

  function createDefaultAction() {
    return { key: '', type: 'composite', steps: [createDefaultActionStep()] };
  }

  function createDefaultActionStep() {
    return { type: 'message', value: '' };
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

  function modelFromLayoutNode(node) {
    if (!node || typeof node !== 'object') return createDefaultLayoutNode();
    if (node.type === 'row') {
      return {
        type: 'row',
        columns: Array.isArray(node.children)
          ? node.children.map(function (child) {
              var firstChild = Array.isArray(child.children) ? child.children[0] : null;
              return {
                width: child.width || 6,
                align: child.align || 'left',
                childType: firstChild && firstChild.type ? firstChild.type : 'field',
                key: firstChild && firstChild.key ? firstChild.key : '',
                action: firstChild && firstChild.action ? firstChild.action : '',
                label: firstChild && firstChild.label ? firstChild.label : '',
                text: firstChild && firstChild.text ? firstChild.text : ''
              };
            })
          : [createDefaultRowColumn()]
      };
    }
    return {
      type: node.type || 'field',
      key: node.key || '',
      action: node.action || '',
      label: node.label || '',
      text: node.text || ''
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
    if (action.type === 'message') {
      return { key: key, type: 'message', value: action.value || '' };
    }
    if (action.type === 'write') {
      return { key: key, type: 'write', to: action.to || '', value: action.value || '' };
    }
    if (action.type === 'setStatus') {
      return { key: key, type: 'setStatus', to: action.to || '' };
    }
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

  function builderStateFromTemplate(template) {
    var fields = template && template.fields && typeof template.fields === 'object' ? template.fields : {};
    var actions = template && template.actions && typeof template.actions === 'object' ? template.actions : {};
    var documentTable = template && template.documentTable && typeof template.documentTable === 'object' ? template.documentTable : {};
    return {
      fields: Object.keys(fields).map(function (key) {
        return modelFromField(key, fields[key]);
      }),
      layout: Array.isArray(template && template.layout) ? template.layout.map(modelFromLayoutNode) : [],
      actions: Object.keys(actions).map(function (key) {
        return modelFromAction(key, actions[key]);
      }),
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

  function layoutNodeToJson(node, errors) {
    if (node.type === 'h1' || node.type === 'text') {
      return {
        type: node.type,
        text: String(node.text || '').trim()
      };
    }
    if (node.type === 'field') {
      var fieldKey = String(node.key || '').trim();
      if (!fieldKey) errors.push('Layout field node is missing a field key.');
      return { type: 'field', key: fieldKey };
    }
    if (node.type === 'button') {
      var actionKey = String(node.action || '').trim();
      if (!actionKey) errors.push('Layout button node is missing an action key.');
      var buttonNode = {
        type: 'button',
        key: String(node.key || actionKey || 'button').trim(),
        action: actionKey,
        kind: 'ui'
      };
      if (String(node.label || '').trim()) buttonNode.label = String(node.label || '').trim();
      return buttonNode;
    }
    if (node.type === 'row') {
      return {
        type: 'row',
        children: (node.columns || []).map(function (column) {
          var childType = String(column.childType || 'field');
          var child;
          if (childType === 'field') {
            var key = String(column.key || '').trim();
            if (!key) errors.push('Layout row column field is missing a field key.');
            child = { type: 'field', key: key };
          } else if (childType === 'button') {
            var action = String(column.action || '').trim();
            if (!action) errors.push('Layout row button is missing an action key.');
            child = {
              type: 'button',
              key: String(column.key || action || 'button').trim(),
              action: action,
              kind: 'ui'
            };
            if (String(column.label || '').trim()) child.label = String(column.label || '').trim();
          } else {
            child = {
              type: 'text',
              text: String(column.text || '').trim()
            };
          }
          return {
            type: 'col',
            width: column.width || 6,
            align: column.align || 'left',
            children: [child]
          };
        })
      };
    }
    return { type: 'text', text: '' };
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
      var apiStep = {
        type: 'callApi',
        apiRef: String(step.apiRef || '').trim(),
        request: requestJson
      };
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
      var apiAction = {
        type: 'callApi',
        apiRef: String(action.apiRef || '').trim(),
        request: requestJson
      };
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

    var layout = (state.layout || []).map(function (node) {
      return layoutNodeToJson(node, errors);
    });

    var documentTableColumns = (state.documentTable || [])
      .filter(function (column) {
        return String(column.key || '').trim();
      })
      .map(function (column) {
        return {
          key: String(column.key || '').trim(),
          label: String(column.label || '').trim() || String(column.key || '').trim()
        };
      });

    if (Object.keys(fields).length === 0) errors.push('At least one field is required.');
    if (layout.length === 0) errors.push('At least one layout node is required.');

    var templateJson = {
      fields: fields,
      layout: layout
    };
    if (Object.keys(actions).length > 0) templateJson.actions = actions;
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
        '</div>' +
        optionEditor +
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
        (supportsTextarea
          ? '<label><span>Rows</span><input type="number" min="2" data-builder-bind="fields.' + index + '.rows" value="' + escapeHtml(field.rows) + '" ' + (readonly ? 'disabled' : '') + ' /></label>'
          : '<div></div>') +
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

  function renderLayoutNode(node, index, readonly) {
    if (node.type === 'row') {
      var columns = (node.columns || []).map(function (column, columnIndex) {
        return '' +
          '<article class="builder-subcard">' +
          '<div class="builder-grid builder-grid-4">' +
            '<label><span>Width</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.width" value="' + escapeHtml(column.width) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
            '<label><span>Align</span><select data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.align" ' + (readonly ? 'disabled' : '') + '>' +
              ['left', 'center', 'right'].map(function (align) {
                return '<option value="' + align + '" ' + (column.align === align ? 'selected' : '') + '>' + align + '</option>';
              }).join('') +
            '</select></label>' +
            '<label><span>Content</span><select data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.childType" ' + (readonly ? 'disabled' : '') + '>' +
              ['field', 'button', 'text'].map(function (type) {
                return '<option value="' + type + '" ' + (column.childType === type ? 'selected' : '') + '>' + type + '</option>';
              }).join('') +
            '</select></label>' +
            '<div></div>' +
          '</div>' +
          (column.childType === 'field'
            ? '<label><span>Field key</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.key" value="' + escapeHtml(column.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>'
            : column.childType === 'button'
              ? '<div class="builder-grid builder-grid-3">' +
                  '<label><span>Action key</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.action" value="' + escapeHtml(column.action) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
                  '<label><span>Button label</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.label" value="' + escapeHtml(column.label) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
                  '<label><span>Node key</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.key" value="' + escapeHtml(column.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
                '</div>'
              : '<label><span>Text</span><input type="text" data-builder-bind="layout.' + index + '.columns.' + columnIndex + '.text" value="' + escapeHtml(column.text) + '" ' + (readonly ? 'disabled' : '') + ' /></label>') +
          (readonly ? '' : '<div class="actions"><button class="btn btn-danger" type="button" data-builder-remove-layout-column="' + index + '.' + columnIndex + '">Remove column</button></div>') +
          '</article>';
      }).join('');

      return '' +
        '<article class="builder-card">' +
        '<div class="builder-panel-header"><h5>Layout block ' + (index + 1) + ': row</h5>' +
        (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-layout="' + index + '">Delete block</button>') +
        '</div>' +
        columns +
        (readonly ? '' : '<div class="actions"><button class="btn btn-secondary" type="button" data-builder-add-layout-column="' + index + '">Add column</button></div>') +
        '</article>';
    }

    return '' +
      '<article class="builder-card">' +
      '<div class="builder-panel-header"><h5>Layout block ' + (index + 1) + '</h5>' +
      (readonly ? '' : '<button class="btn btn-danger" type="button" data-builder-remove-layout="' + index + '">Delete block</button>') +
      '</div>' +
      '<div class="builder-grid builder-grid-3">' +
        '<label><span>Type</span><select data-builder-bind="layout.' + index + '.type" ' + (readonly ? 'disabled' : '') + '>' +
          ['h1', 'text', 'field', 'button', 'row'].map(function (type) {
            return '<option value="' + type + '" ' + (node.type === type ? 'selected' : '') + '>' + type + '</option>';
          }).join('') +
        '</select></label>' +
        (node.type === 'field'
          ? '<label><span>Field key</span><input type="text" data-builder-bind="layout.' + index + '.key" value="' + escapeHtml(node.key) + '" ' + (readonly ? 'disabled' : '') + ' /></label><div></div>'
          : node.type === 'button'
            ? '<label><span>Action key</span><input type="text" data-builder-bind="layout.' + index + '.action" value="' + escapeHtml(node.action) + '" ' + (readonly ? 'disabled' : '') + ' /></label>' +
              '<label><span>Button label</span><input type="text" data-builder-bind="layout.' + index + '.label" value="' + escapeHtml(node.label) + '" ' + (readonly ? 'disabled' : '') + ' /></label>'
            : node.type === 'row'
              ? '<div class="muted">Switch saved. Row columns appear after re-render.</div><div></div>'
              : '<label class="builder-grid-span-2"><span>Text</span><input type="text" data-builder-bind="layout.' + index + '.text" value="' + escapeHtml(node.text) + '" ' + (readonly ? 'disabled' : '') + ' /></label>') +
      '</div>' +
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
      '</div>' +
      body +
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
      '</div>' +
      body +
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
    } else if (leaf === 'rows') {
      cursor[leaf] = Number(rawValue || 4);
    } else {
      cursor[leaf] = rawValue;
    }
  }

  function renderBuilder(root, state, textarea, readonly) {
    var fieldsContainer = root.querySelector('[data-builder-fields]');
    var layoutContainer = root.querySelector('[data-builder-layout]');
    var actionsContainer = root.querySelector('[data-builder-actions]');
    var validation = root.querySelector('[data-builder-validation]');
    var documentTableContainer = root.querySelector('[data-builder-document-table]');

    var output = buildTemplateJsonFromState(state);
    textarea.value = JSON.stringify(output.templateJson, null, 2);

    root.querySelector('[data-builder-count="fields"]').textContent = String(state.fields.length);
    root.querySelector('[data-builder-count="layout"]').textContent = String(state.layout.length);
    root.querySelector('[data-builder-count="actions"]').textContent = String(state.actions.length);
    root.querySelector('[data-builder-count="documentTable"]').textContent = String(state.documentTable.length);

    fieldsContainer.innerHTML = state.fields.length
      ? state.fields.map(function (field, index) { return renderFieldCard(field, index, readonly); }).join('')
      : '<p class="muted">No fields yet.</p>';
    layoutContainer.innerHTML = state.layout.length
      ? state.layout.map(function (node, index) { return renderLayoutNode(node, index, readonly); }).join('')
      : '<p class="muted">No layout blocks yet.</p>';
    actionsContainer.innerHTML = state.actions.length
      ? state.actions.map(function (action, index) { return renderActionCard(action, index, readonly); }).join('')
      : '<p class="muted">No form actions yet.</p>';
    documentTableContainer.innerHTML = renderDocumentTableEditor(state.documentTable, readonly);
    validation.innerHTML = output.errors.length === 0
      ? '<div class="success-card"><strong>Valid:</strong> Builder output matches the V1 core shape and is ready to save.</div>'
      : '<div class="error-card"><strong>Builder issues:</strong><ul>' + output.errors.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul></div>';
  }

  function mountBuilder(root) {
    var readonly = root.getAttribute('data-readonly') === 'true';
    var textareaId = root.getAttribute('data-template-json-source');
    var textarea = document.getElementById(textareaId);
    if (!(textarea instanceof HTMLTextAreaElement)) return;

    var initialTemplate = safeParseJson(textarea.value, { fields: {}, layout: [], actions: {}, documentTable: { columns: [] } });
    var state = builderStateFromTemplate(initialTemplate);

    function rerender() {
      renderBuilder(root, state, textarea, readonly);
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
          state.fields[fieldIndex].journalColumns = Array.isArray(state.fields[fieldIndex].journalColumns)
            ? state.fields[fieldIndex].journalColumns
            : [];
        }
      }
      if (path.indexOf('layout.') === 0 && path.endsWith('.type')) {
        var layoutIndex = Number(path.split('.')[1]);
        if (state.layout[layoutIndex] && state.layout[layoutIndex].type === 'row' && !Array.isArray(state.layout[layoutIndex].columns)) {
          state.layout[layoutIndex].columns = [createDefaultRowColumn()];
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
        if (actionPath.length === 5) {
          var stepIndex = Number(actionPath[3]);
          if (state.actions[actionIndex] && state.actions[actionIndex].steps && !state.actions[actionIndex].steps[stepIndex]) {
            state.actions[actionIndex].steps[stepIndex] = createDefaultActionStep();
          }
        }
      }
      rerender();
    });

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (readonly) return;

      if (target.matches('[data-builder-add-field]')) {
        state.fields.push(createDefaultField());
        rerender();
      } else if (target.matches('[data-builder-remove-field]')) {
        state.fields.splice(Number(target.getAttribute('data-builder-remove-field')), 1);
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
      } else if (target.matches('[data-builder-add-doc-column]')) {
        state.documentTable.push({ key: '', label: '' });
        rerender();
      } else if (target.matches('[data-builder-remove-doc-column]')) {
        state.documentTable.splice(Number(target.getAttribute('data-builder-remove-doc-column')), 1);
        rerender();
      } else if (target.matches('[data-builder-add-layout]')) {
        state.layout.push(createDefaultLayoutNode());
        rerender();
      } else if (target.matches('[data-builder-remove-layout]')) {
        state.layout.splice(Number(target.getAttribute('data-builder-remove-layout')), 1);
        rerender();
      } else if (target.matches('[data-builder-add-layout-column]')) {
        var layoutIndex = Number(target.getAttribute('data-builder-add-layout-column'));
        if (state.layout[layoutIndex] && Array.isArray(state.layout[layoutIndex].columns)) {
          state.layout[layoutIndex].columns.push(createDefaultRowColumn());
        }
        rerender();
      } else if (target.matches('[data-builder-remove-layout-column]')) {
        var layoutColumnPath = String(target.getAttribute('data-builder-remove-layout-column') || '').split('.');
        var targetLayoutIndex = Number(layoutColumnPath[0]);
        var targetColumnIndex = Number(layoutColumnPath[1]);
        if (state.layout[targetLayoutIndex] && Array.isArray(state.layout[targetLayoutIndex].columns)) {
          state.layout[targetLayoutIndex].columns.splice(targetColumnIndex, 1);
        }
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
      });
    }

    rerender();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-template-builder]').forEach(function (root) {
      mountBuilder(root);
    });
  });
})();
