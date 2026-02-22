import { describe, expect, it } from 'vitest';
import { applyEditableDataUpdate } from './ui.js';

describe('document save data merge', () => {
  it('updates only allowed editable fields', () => {
    const currentData = {
      comment: 'old',
      quantity: '5',
      locked_note: 'keep'
    };

    const form = {
      'data:comment': 'new comment',
      'data:locked_note': 'should not change'
    };

    const next = applyEditableDataUpdate(currentData, form, ['comment']);

    expect(next).toEqual({
      comment: 'new comment',
      quantity: '5',
      locked_note: 'keep'
    });
  });
});
