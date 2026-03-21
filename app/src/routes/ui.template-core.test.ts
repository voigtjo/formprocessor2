import { describe, expect, it } from 'vitest';
import {
  buildLegacyBridgeTemplateJson,
  buildV1CustomerOrderTemplateJson,
  buildV1EvidenceProductCheckTemplateJson,
  buildV1MinimalEvidenceTemplateJson,
  buildV1ProductionBatchTemplateJson
} from './test-template-fixtures.js';
import { collectTemplateWarnings, normalizeTemplateJsonForV1Storage, parseTemplateEditorJson } from './ui.js';

describe('template V1 core schema + normalization', () => {
  it('accepts V1 core template JSON without legacy keys', () => {
    const parsed = parseTemplateEditorJson(JSON.stringify(buildV1CustomerOrderTemplateJson()));

    expect(parsed).toMatchObject({
      fields: buildV1CustomerOrderTemplateJson().fields,
      actions: buildV1CustomerOrderTemplateJson().actions,
      documentTable: buildV1CustomerOrderTemplateJson().documentTable,
      form: {
        rows: expect.any(Array)
      }
    });
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
      form: { rows: [] },
      actions: {
        startAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Started' }] },
        submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Submitted' }] },
        approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] }
      }
    });
  });

  it('accepts builder-ready V1 templates with form rows, cells and separated actions', () => {
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
        form: {
          rows: [
            {
              cells: [
                { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Builder Example' } }
              ]
            },
            {
              cells: [
                { width: 6, align: 'left', content: { type: 'field', fieldKey: 'product_id' } },
                { width: 6, align: 'right', content: { type: 'button', key: 'refresh_lookup', action: 'refresh_lookup', label: 'Refresh Lookup', kind: 'ui' } }
              ]
            },
            {
              cells: [
                { width: 12, content: { type: 'journal', fieldKey: 'findings' } }
              ]
            },
            {
              cells: [
                {
                  width: 12,
                  content: {
                    type: 'attachmentArea',
                    title: 'Evidence Attachments',
                    helpText: 'Upload images and files for this record.'
                  }
                }
              ]
            }
          ]
        },
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
      form: {
        rows: expect.any(Array)
      },
      actions: {
        refresh_lookup: {
          type: 'composite'
        }
      },
      documentTable: {
        columns: [{ key: 'product_id', label: 'Product' }]
      }
    });

    expect(parsed.form.rows[2].cells[0].content).toMatchObject({
      type: 'journal',
      fieldKey: 'findings'
    });
    expect(parsed.form.rows[3].cells[0].content).toMatchObject({
      type: 'attachmentArea',
      title: 'Evidence Attachments',
      helpText: 'Upload images and files for this record.'
    });
  });

  it('keeps canonical V1 reference fixtures on form.rows instead of legacy-first layout definitions', () => {
    const fixtures = [
      buildV1MinimalEvidenceTemplateJson(),
      buildV1EvidenceProductCheckTemplateJson(),
      buildV1ProductionBatchTemplateJson(),
      buildV1CustomerOrderTemplateJson()
    ];

    for (const fixture of fixtures) {
      expect(fixture).toHaveProperty('form.rows');
      expect(Array.isArray((fixture as any).form.rows)).toBe(true);
      expect('layout' in fixture).toBe(false);
    }
  });
});
