// Canonical V1 fixtures: fields + layout + fachliche actions only.
export function buildV1MinimalEvidenceTemplateJson() {
  return {
    fields: {
      note: {
        kind: 'editable',
        label: 'Note'
      }
    },
    layout: [
      { type: 'h1', text: 'Evidence Note' },
      { type: 'field', key: 'note' }
    ],
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
        multiline: true
      }
    },
    layout: [
      { type: 'h1', text: 'Evidence Product Check' },
      { type: 'field', key: 'product_id' },
      { type: 'field', key: 'inspection_note' }
    ],
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
      }
    },
    layout: [
      { type: 'h1', text: 'Production Batch' },
      { type: 'field', key: 'product_id' },
      { type: 'button', key: 'create_batch', action: 'create_batch', kind: 'ui', label: 'Create Batch' },
      { type: 'field', key: 'batch_number' }
    ],
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
        apiRef,
        valueKey: 'id',
        labelKey: 'name'
      }
    },
    layout: [{ type: 'field', key: fieldKey }],
    actions: {}
  } satisfies Record<string, unknown>;
}

export function buildV1CustomerOrderTemplateJson() {
  return {
    fields: {
      customer_id: {
        kind: 'lookup',
        label: 'Customer',
        apiRef: 'customers.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      customer_order_number: {
        kind: 'editable',
        label: 'Customer Order Number'
      }
    },
    layout: [
      { type: 'h1', text: 'Customer Order Test' },
      { type: 'field', key: 'customer_id' },
      { type: 'button', key: 'create_customer_order', action: 'create_customer_order', kind: 'ui', label: 'Create Customer Order' },
      { type: 'field', key: 'customer_order_number' }
    ],
    actions: {
      create_customer_order: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.customer_id', message: 'Select a customer first.' },
          {
            type: 'callApi',
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
