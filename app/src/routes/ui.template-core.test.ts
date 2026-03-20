import { describe, expect, it } from 'vitest';
import { buildLegacyBridgeTemplateJson, buildV1CustomerOrderTemplateJson } from './test-template-fixtures.js';
import { collectTemplateWarnings, normalizeTemplateJsonForV1Storage, parseTemplateEditorJson } from './ui.js';

describe('template V1 core schema + normalization', () => {
  it('accepts V1 core template JSON without legacy keys', () => {
    const parsed = parseTemplateEditorJson(JSON.stringify(buildV1CustomerOrderTemplateJson()));

    expect(parsed).toEqual(buildV1CustomerOrderTemplateJson());
  });

  it('keeps legacy templates loadable but normalizes them back to the V1 core on save', () => {
    const parsed = parseTemplateEditorJson(JSON.stringify(buildLegacyBridgeTemplateJson()));

    expect(collectTemplateWarnings(parsed)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('template_json.fieldAccess is legacy'),
        expect.stringContaining('template_json.workflow is legacy'),
        expect.stringContaining('template_json.controls is legacy')
      ])
    );

    expect(normalizeTemplateJsonForV1Storage(parsed as any)).toEqual({
      fields: {},
      layout: [],
      actions: {
        startAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Started' }] },
        submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Submitted' }] },
        approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] }
      }
    });
  });

  it('accepts richer builder-style V1 templates with lookup, journal, rows and form actions', () => {
    const parsed = parseTemplateEditorJson(
      JSON.stringify({
        fields: {
          product_id: {
            kind: 'lookup',
            label: 'Product',
            apiRef: 'products.listValid',
            valueKey: 'id',
            labelKey: 'name'
          },
          findings: {
            kind: 'journal',
            label: 'Findings',
            columns: [
              { key: 'finding', label: 'Finding', type: 'text' },
              { key: 'closed', label: 'Closed', type: 'checkbox' }
            ]
          }
        },
        layout: [
          { type: 'h1', text: 'Builder Example' },
          {
            type: 'row',
            children: [
              { type: 'col', width: 6, align: 'left', children: [{ type: 'field', key: 'product_id' }] },
              {
                type: 'col',
                width: 6,
                align: 'right',
                children: [{ type: 'button', key: 'refresh_lookup', action: 'refresh_lookup', kind: 'ui', label: 'Refresh Lookup' }]
              }
            ]
          },
          { type: 'field', key: 'findings' }
        ],
        actions: {
          refresh_lookup: {
            type: 'composite',
            steps: [
              { type: 'require', from: 'external.product_id', message: 'Select product first.' },
              { type: 'message', value: 'Lookup refreshed.' }
            ]
          }
        },
        documentTable: {
          columns: [{ key: 'product_id', label: 'Product' }]
        }
      })
    );

    expect(parsed).toMatchObject({
      fields: {
        product_id: {
          kind: 'lookup',
          apiRef: 'products.listValid'
        },
        findings: {
          kind: 'journal'
        }
      },
      layout: expect.any(Array),
      actions: {
        refresh_lookup: {
          type: 'composite'
        }
      },
      documentTable: {
        columns: [{ key: 'product_id', label: 'Product' }]
      }
    });
  });
});
