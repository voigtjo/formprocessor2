import { describe, expect, it } from 'vitest';
import { applyEditableDataUpdate } from './ui.js';

describe('document save data merge', () => {
  it('updates only allowed editable fields', () => {
    const templateJson = {
      fields: {
        comment: { kind: 'editable' },
        quantity: { kind: 'editable' },
        locked_note: { kind: 'editable' }
      },
      workflow: { initial: 'created', states: { created: { editable: ['comment'] } } }
    } as any;
    const currentData = {
      comment: 'old',
      quantity: '5',
      locked_note: 'keep'
    };

    const form = {
      'data:comment': 'new comment',
      'data:locked_note': 'should not change'
    };

    const next = applyEditableDataUpdate(templateJson, currentData, form, ['comment']);

    expect(next).toEqual({
      comment: 'new comment',
      quantity: '5',
      locked_note: 'keep'
    });
  });

  it('stores checkbox as true when posted', () => {
    const templateJson = {
      fields: {
        urgent: { kind: 'editable', control: 'checkbox' }
      },
      workflow: { initial: 'created', states: { created: { editable: ['urgent'] } } }
    } as any;
    const next = applyEditableDataUpdate(templateJson, {}, { 'data:urgent': '1' }, ['urgent']);
    expect(next.urgent).toBe(true);
  });

  it('stores checkbox as false when missing in post', () => {
    const templateJson = {
      fields: {
        urgent: { kind: 'editable', control: 'checkbox' }
      },
      workflow: { initial: 'created', states: { created: { editable: ['urgent'] } } }
    } as any;
    const next = applyEditableDataUpdate(templateJson, { urgent: true }, {}, ['urgent']);
    expect(next.urgent).toBe(false);
  });

  it('roundtrips date string as submitted', () => {
    const templateJson = {
      fields: {
        due_date: { kind: 'editable', control: 'date' }
      },
      workflow: { initial: 'created', states: { created: { editable: ['due_date'] } } }
    } as any;
    const next = applyEditableDataUpdate(templateJson, {}, { 'data:due_date': '2026-03-09' }, ['due_date']);
    expect(next.due_date).toBe('2026-03-09');
  });
});
