import { describe, expect, it } from 'vitest';
import { extractTemplateUsage } from './template-analysis.js';

describe('template analysis', () => {
  it('extracts actions, api refs and legacy macro refs recursively', () => {
    const templateJson = {
      fields: {
        customer_id: {
          kind: 'lookup',
          apiRef: 'customers.listValid'
        }
      },
      actions: {
        create_customer_order: {
          type: 'composite',
          steps: [
            { type: 'require', from: 'external.customer_id' },
            {
              type: 'callApi',
              apiRef: 'customerOrders.create',
              request: { customer_id: '{{external.customer_id}}' },
              to: 'vars.customerOrderResponse'
            },
            {
              type: 'composite',
              steps: [{ type: 'macro', ref: 'macro:erp/ensureErpCustomerOrder@1' }]
            }
          ]
        }
      }
    };

    const usage = extractTemplateUsage(templateJson);

    expect(usage.lookupApiRefs).toEqual(['customers.listValid']);
    expect(usage.apiRefs).toEqual(['customerOrders.create', 'customers.listValid']);
    expect(usage.macroRefs).toEqual(['macro:erp/ensureErpCustomerOrder@1']);
    expect(usage.actions[0]?.actionKey).toBe('create_customer_order');
    expect(usage.actions[0]?.apiRefs).toEqual(['customerOrders.create']);
    expect(usage.actions[0]?.hasLegacyMacro).toBe(true);
  });
});
