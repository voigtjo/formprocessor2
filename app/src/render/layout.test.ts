import { describe, expect, it } from 'vitest';
import { renderLayout } from './layout.js';

describe('layout renderer v2', () => {
  it('renders group/row/field structure', () => {
    const html = renderLayout({
      mode: 'new',
      templateId: 'tpl-1',
      templateJson: {
        fields: {
          customer_id: { kind: 'lookup', label: 'Customer' },
          comment: { kind: 'editable', label: 'Comment', multiline: true }
        },
        layout: [
          {
            type: 'group',
            title: 'Main',
            children: [
              {
                type: 'row',
                children: [
                  { type: 'field', key: 'customer_id' },
                  { type: 'col', children: [{ type: 'field', key: 'comment' }] }
                ]
              }
            ]
          }
        ]
      }
    });

    expect(html).toContain('<div class="card">');
    expect(html).toContain('<div class="row">');
    expect(html).toContain('name="lookup:customer_id"');
    expect(html).toContain('name="data:comment"');
  });

  it('renders detail button node as hx-post action trigger', () => {
    const html = renderLayout({
      mode: 'detail',
      documentId: 'doc-1',
      templateJson: {
        fields: {},
        controls: {
          submit: { action: 'submit_case' }
        },
        layout: [{ type: 'button', key: 'submit', label: 'Submit', action: 'submit' }]
      }
    });

    expect(html).toContain('hx-post="/documents/doc-1/action/submit?source=ui"');
    expect(html).toContain('hx-on::after-request="if(event.detail.successful) window.location.reload()"');
    expect(html).toContain('btn btn-secondary');
    expect(html).toContain('type="button"');
    expect(html).toContain('>Submit<');
  });

  it('renders process-kind detail button as form submit without source=ui', () => {
    const html = renderLayout({
      mode: 'detail',
      documentId: 'doc-1',
      templateJson: {
        fields: {},
        controls: {
          create_batch: { action: 'create_batch' }
        },
        layout: [{ type: 'button', key: 'create_batch', label: 'Create Batch', action: 'create_batch', kind: 'process' }]
      }
    });

    expect(html).toContain('type="submit"');
    expect(html).toContain('formaction="/documents/doc-1/action/create_batch"');
    expect(html).not.toContain('?source=ui');
    expect(html).toContain('data-fp-action-kind="process"');
  });

  it('renders new button node for lookup reload via targets + htmx trigger', () => {
    const html = renderLayout({
      mode: 'new',
      templateId: 'tpl-1',
      templateJson: {
        fields: {
          customer_id: { kind: 'lookup', label: 'Customer' },
          product_id: { kind: 'lookup', label: 'Product' }
        },
        layout: [
          {
            type: 'button',
            key: 'reload',
            label: 'Reload Customers',
            action: 'reload_customer_lookup',
            targets: ['customer_id', 'product_id']
          }
        ]
      }
    });

    expect(html).toContain('hx-on:click=');
    expect(html).toContain('field-customer_id');
    expect(html).toContain('field-product_id');
    expect(html).toContain('reloadLookup');
    expect(html).toContain('Reload Customers');
  });

  it('renders editable lookup in detail mode as select', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: ['customer_id'],
      readonlyKeys: [],
      externalRefsJson: { customer_id: 'c-1' },
      snapshotsJson: { customer_id: 'Acme' },
      templateJson: {
        fields: {
          customer_id: { kind: 'lookup', label: 'Customer' }
        },
        layout: [{ type: 'field', key: 'customer_id' }]
      }
    });

    expect(html).toContain('<select id="field-customer_id"');
    expect(html).toContain('name="lookup:customer_id"');
    expect(html).toContain('Acme');
  });

  it('renders readonly lookup in detail mode as disabled select with snapshot label', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: [],
      readonlyKeys: ['product_id'],
      externalRefsJson: { product_id: 'p-1' },
      snapshotsJson: { product_id: 'Product A' },
      templateJson: {
        fields: {
          product_id: { kind: 'lookup', label: 'Product' }
        },
        layout: [{ type: 'field', key: 'product_id' }]
      }
    });

    expect(html).toContain('<select id="field-product_id"');
    expect(html).toContain('disabled');
    expect(html).toContain('Product A');
    expect(html).not.toContain('Debug');
  });

  it('hides workflow status field in detail layout to avoid duplicate header status', () => {
    const html = renderLayout({
      mode: 'detail',
      documentId: 'doc-1',
      documentStatus: 'Submitted',
      dataJson: { status: 'LegacyDataStatus' },
      templateJson: {
        fields: {
          status: { kind: 'workflow', label: 'Status' }
        },
        layout: [{ type: 'field', key: 'status' }]
      }
    });

    expect(html).toBe('');
  });

  it('does not render empty group when all children are filtered out', () => {
    const html = renderLayout({
      mode: 'detail',
      documentId: 'doc-1',
      documentStatus: 'Created',
      templateJson: {
        fields: {
          status: { kind: 'workflow', label: 'Status' }
        },
        layout: [
          {
            type: 'group',
            title: 'Process',
            children: [{ type: 'field', key: 'status' }]
          }
        ]
      }
    });

    expect(html).toBe('');
    expect(html).not.toContain('Process');
    expect(html).not.toContain('<div class="card">');
  });

  it('renders editable date and checkbox controls', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: ['due_date', 'urgent'],
      readonlyKeys: [],
      dataJson: { due_date: '2026-03-09', urgent: 'yes' },
      templateJson: {
        fields: {
          due_date: { kind: 'editable', label: 'Due Date', control: 'date' },
          urgent: { kind: 'editable', label: 'Urgent', control: 'checkbox' }
        },
        layout: [{ type: 'field', key: 'due_date' }, { type: 'field', key: 'urgent' }]
      }
    });

    expect(html).toContain('name="data:due_date"');
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-03-09"');
    expect(html).toContain('name="data:urgent"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('value="1"');
    expect(html).toContain('checked');
  });

  it('renders kind=date and kind=checkbox as typed inputs', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: ['due_date', 'urgent'],
      readonlyKeys: [],
      dataJson: { due_date: '2026-03-09', urgent: true },
      templateJson: {
        fields: {
          due_date: { kind: 'date', label: 'Due Date' },
          urgent: { kind: 'checkbox', label: 'Urgent' }
        },
        layout: [{ type: 'field', key: 'due_date' }, { type: 'field', key: 'urgent' }]
      }
    });

    expect(html).toContain('name="data:due_date"');
    expect(html).toContain('type="date"');
    expect(html).toContain('name="data:urgent"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });
});
