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
});
