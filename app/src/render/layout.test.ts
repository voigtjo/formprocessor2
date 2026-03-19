import { describe, expect, it } from 'vitest';
import {
  buildV1CustomerOrderTemplateJson,
  buildV1EvidenceProductCheckTemplateJson,
  buildV1MinimalEvidenceTemplateJson,
  buildV1ProductionBatchTemplateJson
} from '../routes/test-template-fixtures.js';
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
        actions: {
          submit: { type: 'composite', steps: [] }
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
        actions: {
          create_batch: { type: 'composite', steps: [] }
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

  it('renders document action button as disabled with hint in new mode and active in detail mode', () => {
    const templateJson = buildV1CustomerOrderTemplateJson();

    const newHtml = renderLayout({
      mode: 'new',
      templateId: 'tpl-1',
      templateJson
    });
    expect(newHtml).toContain('Create Customer Order');
    expect(newHtml).toContain('Available after document creation');
    expect(newHtml).toContain('disabled');
    expect(newHtml).not.toContain('hx-post=');
    expect(newHtml).not.toContain('hx-on:click=');

    const detailHtml = renderLayout({
      mode: 'detail',
      documentId: 'doc-1',
      templateId: 'tpl-1',
      templateJson
    });
    expect(detailHtml).toContain('hx-post="/documents/doc-1/action/create_customer_order?source=ui"');
    expect(detailHtml).not.toContain('Available after document creation');
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

  it('renders row and column alignment with width styles', () => {
    const html = renderLayout({
      mode: 'new',
      templateId: 'tpl-1',
      templateJson: {
        fields: {
          left_note: { kind: 'editable', label: 'Left Note' },
          right_note: { kind: 'editable', label: 'Right Note' }
        },
        layout: [
          {
            type: 'row',
            align: 'right',
            children: [
              { type: 'col', width: 4, children: [{ type: 'field', key: 'left_note' }] },
              { type: 'col', width: '1/3', align: 'center', children: [{ type: 'field', key: 'right_note' }] }
            ]
          }
        ]
      }
    });

    expect(html).toContain('row-align-right');
    expect(html).toContain('--col-basis:33.3333%');
    expect(html).toContain('col-align-center');
  });

  it('renders radio and checkbox groups with help text', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: ['result', 'flags'],
      readonlyKeys: [],
      dataJson: { result: 'hold', flags: ['signed', 'exception'] },
      templateJson: {
        fields: {
          result: {
            kind: 'editable',
            label: 'Result',
            control: 'radioGroup',
            helpText: 'Select the overall outcome.',
            options: [
              { value: 'pass', label: 'Pass' },
              { value: 'hold', label: 'Hold' },
              { value: 'fail', label: 'Fail' }
            ]
          },
          flags: {
            kind: 'editable',
            label: 'Flags',
            control: 'checkboxGroup',
            options: [
              { value: 'signed', label: 'Signed' },
              { value: 'exception', label: 'Exception' }
            ]
          }
        },
        layout: [{ type: 'field', key: 'result' }, { type: 'field', key: 'flags' }]
      }
    });

    expect(html).toContain('type="radio"');
    expect(html).toContain('name="data:result"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="data:flags"');
    expect(html).toContain('choice-group');
    expect(html).toContain('Select the overall outcome.');
    expect(html).toContain('checked');
  });

  it('renders readonly checkbox groups as disabled selections', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: [],
      readonlyKeys: ['flags'],
      dataJson: { flags: ['signed', 'exception'] },
      templateJson: {
        fields: {
          flags: {
            kind: 'editable',
            label: 'Flags',
            control: 'checkboxGroup',
            options: [
              { value: 'signed', label: 'Signed' },
              { value: 'exception', label: 'Exception' }
            ]
          }
        },
        layout: [{ type: 'field', key: 'flags' }]
      }
    });

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('value="signed" checked disabled');
    expect(html).toContain('value="exception" checked disabled');
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

  it('renders richer V1 reference template structures', () => {
    const html = renderLayout({
      mode: 'new',
      templateId: 'tpl-1',
      templateJson: buildV1EvidenceProductCheckTemplateJson()
    });

    expect(html).toContain('Evidence Product Check');
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('placeholder="Capture the observed condition, deviations, or follow-up."');
    expect(html).toContain('--col-basis:41.66666666666667%');
  });

  it('renders journal control with add-row ui and hidden json field', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: ['findings'],
      readonlyKeys: [],
      dataJson: {
        findings: [{ finding: 'Seal damaged', action: 'Replace', severity: 'high', closed: false }]
      },
      templateJson: buildV1MinimalEvidenceTemplateJson()
    });

    expect(html).toContain('journal-control');
    expect(html).toContain('data:findings');
    expect(html).toContain('Add row');
    expect(html).toContain('Severity');
    expect(html).toContain('journal-table');
  });

  it('renders readonly journal summary table', () => {
    const html = renderLayout({
      mode: 'detail',
      templateId: 'tpl-1',
      documentId: 'doc-1',
      editableKeys: [],
      readonlyKeys: ['inspection_steps'],
      dataJson: {
        inspection_steps: [{ step: 'Visual check', measured_value: 3, result: 'ok', confirmed: true }]
      },
      templateJson: buildV1ProductionBatchTemplateJson()
    });

    expect(html).toContain('Inspection Steps');
    expect(html).toContain('Visual check');
    expect(html).toContain('Yes');
    expect(html).not.toContain('Add row');
  });
});
