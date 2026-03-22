// Canonical V1 fixtures: fields + layout + fachliche actions only.
export function buildV1MinimalEvidenceTemplateJson() {
  return {
    fields: {
      evidence_type: {
        kind: 'editable',
        label: 'Evidence Type',
        control: 'radioGroup',
        options: [
          { value: 'photo', label: 'Photo evidence' },
          { value: 'checklist', label: 'Checklist proof' },
          { value: 'note', label: 'Written note' }
        ],
        helpText: 'Choose the format that best matches the collected proof.'
      },
      evidence_flags: {
        kind: 'editable',
        label: 'Evidence Flags',
        control: 'checkboxGroup',
        options: [
          { value: 'complete', label: 'Complete' },
          { value: 'signed', label: 'Signed off' },
          { value: 'exception', label: 'Has exception' }
        ]
      },
      note: {
        kind: 'editable',
        label: 'Note',
        multiline: true,
        rows: 5,
        placeholder: 'Summarize what was verified and what still needs attention.'
      },
      findings: {
        kind: 'journal',
        label: 'Findings',
        helpText: 'Capture concrete findings or follow-up actions as separate rows.',
        columns: [
          { key: 'finding', label: 'Finding', type: 'text', placeholder: 'Describe the finding' },
          { key: 'action', label: 'Action', type: 'text', placeholder: 'Next step or owner' },
          {
            key: 'severity',
            label: 'Severity',
            type: 'select',
            options: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]
          },
          { key: 'closed', label: 'Closed', type: 'checkbox' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Evidence Note' } }
          ]
        },
        {
          cells: [
            { width: 6, content: { type: 'field', fieldKey: 'evidence_type' } },
            { width: 1, content: { type: 'spacer', size: 'sm' } },
            { width: 5, align: 'right', content: { type: 'field', fieldKey: 'evidence_flags' } }
          ]
        },
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey: 'note' } }
          ]
        },
        {
          cells: [
            { width: 8, content: { type: 'journal', fieldKey: 'findings' } },
            {
              width: 4,
              content: {
                type: 'attachmentArea',
                title: 'Evidence Attachments',
                helpText: 'Upload photos or files that support this evidence note.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'evidence_type', label: 'Type' },
        { key: 'evidence_flags', label: 'Flags' },
        { key: 'note', label: 'Note' },
        { key: 'findings', label: 'Findings' }
      ]
    },
    actions: {}
  } satisfies Record<string, unknown>;
}

export function buildV1EvidenceProductCheckTemplateJson() {
  return {
    fields: {
      product_id: {
        kind: 'lookup',
        label: 'Product',
        apiRef: 'products.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      inspection_note: {
        kind: 'editable',
        label: 'Inspection Note',
        multiline: true,
        rows: 5,
        placeholder: 'Capture the observed condition, deviations, or follow-up.'
      },
      check_result: {
        kind: 'editable',
        label: 'Check Result',
        control: 'radioGroup',
        options: [
          { value: 'pass', label: 'Pass' },
          { value: 'hold', label: 'Hold' },
          { value: 'fail', label: 'Fail' }
        ]
      },
      issue_tags: {
        kind: 'editable',
        label: 'Issue Tags',
        control: 'checkboxGroup',
        options: [
          { value: 'labeling', label: 'Labeling' },
          { value: 'packaging', label: 'Packaging' },
          { value: 'quality', label: 'Quality' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Evidence Product Check' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'field', fieldKey: 'product_id' } },
            { width: 4, content: { type: 'field', fieldKey: 'check_result' } },
            { width: 3, align: 'right', content: { type: 'field', fieldKey: 'issue_tags' } }
          ]
        },
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey: 'inspection_note' } }
          ]
        },
        {
          cells: [
            {
              width: 12,
              content: {
                type: 'attachmentArea',
                title: 'Product Evidence',
                helpText: 'Keep product photos and supporting files together with this check.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'product_id', label: 'Product' },
        { key: 'check_result', label: 'Result' },
        { key: 'issue_tags', label: 'Issue Tags' },
        { key: 'inspection_note', label: 'Inspection Note' }
      ]
    },
    actions: {}
  } satisfies Record<string, unknown>;
}

export function buildV1ProductionBatchTemplateJson() {
  return {
    fields: {
      product_id: {
        kind: 'lookup',
        label: 'Product',
        apiRef: 'products.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      batch_number: {
        kind: 'editable',
        label: 'Batch Number'
      },
      batch_priority: {
        kind: 'editable',
        label: 'Priority',
        control: 'radioGroup',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'rush', label: 'Rush' }
        ]
      },
      inspection_steps: {
        kind: 'journal',
        label: 'Inspection Steps',
        columns: [
          { key: 'step', label: 'Step', type: 'text', placeholder: 'Inspection step' },
          { key: 'measured_value', label: 'Measured Value', type: 'number', placeholder: '0' },
          {
            key: 'result',
            label: 'Result',
            type: 'select',
            options: [
              { value: 'ok', label: 'OK' },
              { value: 'hold', label: 'Hold' },
              { value: 'fail', label: 'Fail' }
            ]
          },
          { key: 'confirmed', label: 'Confirmed', type: 'checkbox' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Production Batch' } }
          ]
        },
        {
          cells: [
            { width: 7, content: { type: 'field', fieldKey: 'product_id' } },
            { width: 5, align: 'right', content: { type: 'field', fieldKey: 'batch_priority' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'button', action: 'create_batch', label: 'Create Batch', key: 'create_batch', kind: 'ui' } },
            { width: 1, content: { type: 'spacer', size: 'sm' } },
            { width: 6, content: { type: 'field', fieldKey: 'batch_number' } }
          ]
        },
        {
          cells: [
            { width: 8, content: { type: 'journal', fieldKey: 'inspection_steps' } },
            {
              width: 4,
              content: {
                type: 'attachmentArea',
                title: 'Batch Attachments',
                helpText: 'Store certificates, photos and production evidence here.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'product_id', label: 'Product' },
        { key: 'batch_number', label: 'Batch Number' },
        { key: 'inspection_steps', label: 'Inspection Steps' }
      ]
    },
    actions: {
      create_batch: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.product_id', message: 'Select a product first.' },
          {
            type: 'callApi',
            apiRef: 'batches.create',
            request: { product_id: '{{external.product_id}}' },
            to: 'vars.batchResponse'
          },
          { type: 'write', to: 'data.batch_number', value: '{{vars.batchResponse.batch_number}}' },
          { type: 'write', to: 'external.batch_id', value: '{{vars.batchResponse.id}}' },
          { type: 'write', to: 'snapshot.batch_number', value: '{{vars.batchResponse.batch_number}}' },
          { type: 'message', value: 'Batch created: {{vars.batchResponse.batch_number}}' }
        ]
      }
    }
  } satisfies Record<string, unknown>;
}

export function buildV1LookupTemplateJson(fieldKey = 'customer_id', apiRef = 'customers.listValid', label = 'Customer') {
  return {
    fields: {
      [fieldKey]: {
        kind: 'lookup',
        label,
        operationRef: apiRef,
        apiRef,
        valueKey: 'id',
        labelKey: 'name'
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey } }
          ]
        }
      ]
    },
    documentTable: {
      columns: [{ key: fieldKey, label }]
    },
    actions: {}
  } satisfies Record<string, unknown>;
}

export function buildV1CustomerOrderTemplateJson() {
  return {
    fields: {
      customer_id: {
        kind: 'lookup',
        label: 'Customer',
        operationRef: 'customers.listValid',
        apiRef: 'customers.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      customer_order_number: {
        kind: 'editable',
        label: 'Customer Order Number'
      },
      fulfillment_flags: {
        kind: 'editable',
        label: 'Fulfillment Flags',
        control: 'checkboxGroup',
        options: [
          { value: 'expedite', label: 'Expedite' },
          { value: 'gift', label: 'Gift wrap' },
          { value: 'quality_hold', label: 'Quality hold' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Customer Order Test' } }
          ]
        },
        {
          cells: [
            { width: 7, content: { type: 'field', fieldKey: 'customer_id' } },
            { width: 5, align: 'center', content: { type: 'field', fieldKey: 'fulfillment_flags' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'button', action: 'create_customer_order', label: 'Create Customer Order', key: 'create_customer_order', kind: 'ui' } },
            { width: 1, content: { type: 'spacer', size: 'sm' } },
            { width: 6, content: { type: 'field', fieldKey: 'customer_order_number' } }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'customer_id', label: 'Customer' },
        { key: 'fulfillment_flags', label: 'Flags' },
        { key: 'customer_order_number', label: 'Customer Order Number' }
      ]
    },
    actions: {
      create_customer_order: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.customer_id', message: 'Select a customer first.' },
          {
            type: 'callApi',
            operationRef: 'customerOrders.create',
            apiRef: 'customerOrders.create',
            request: { customer_id: '{{external.customer_id}}' },
            to: 'vars.customerOrderResponse'
          },
          { type: 'write', to: 'data.customer_order_number', value: '{{vars.customerOrderResponse.order_number}}' },
          { type: 'write', to: 'external.customer_order_id', value: '{{vars.customerOrderResponse.id}}' },
          { type: 'write', to: 'snapshot.customer_order_number', value: '{{vars.customerOrderResponse.order_number}}' },
          { type: 'message', value: 'Customer order created: {{vars.customerOrderResponse.order_number}}' }
        ]
      }
    }
  } satisfies Record<string, unknown>;
}

// Explicit legacy bridge fixture: kept only for compatibility-path tests.
export function buildLegacyBridgeTemplateJson() {
  return {
    fields: {},
    layout: [],
    fieldAccess: {
      Assigned: { editable: [] }
    },
    workflow: {
      initial: 'Assigned',
      states: {
        Assigned: { editable: [], readonly: [], buttons: ['start'] },
        Started: { editable: [], readonly: [], buttons: ['submit'] },
        Submitted: { editable: [], readonly: [], buttons: ['approve'] }
      }
    },
    controls: {
      start: { label: 'Start', action: 'startAction' },
      submit: { label: 'Submit', action: 'submitAction' },
      approve: { label: 'Approve', action: 'approveAction' }
    },
    actions: {
      startAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Started' }] },
      submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Submitted' }] },
      approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] }
    }
  } satisfies Record<string, unknown>;
}
