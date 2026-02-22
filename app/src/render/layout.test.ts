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
});
