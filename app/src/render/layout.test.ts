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
    expect(html).toContain('<div class="layout-row"');
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

    expect(html).toContain('hx-post="/documents/doc-1/action/submit"');
    expect(html).toContain('type="button"');
    expect(html).toContain('>Submit<');
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
});
