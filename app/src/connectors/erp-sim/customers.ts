import { z } from 'zod';
import { executeHttpConnectorRequest } from '../runtime.js';
import { defineConnectorOperation } from '../types.js';
import { erpSimConnector } from './shared.js';

const customerRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  valid: z.boolean().optional()
});

const customersListValidInputSchema = z.object({
  valid: z.boolean().default(true)
});

const customersListValidOutputSchema = z.array(customerRecordSchema);

export const customersListValidOperation = defineConnectorOperation({
  ref: 'customers.listValid',
  name: 'List Valid Customers',
  description: 'Returns valid customers from the ERP simulation.',
  connector: erpSimConnector,
  metadata: {
    kind: 'lookup',
    method: 'GET',
    path: '/api/customers',
    requestShape: {
      query: { valid: true }
    },
    lookup: {
      valueKey: 'id',
      labelKey: 'name'
    }
  },
  inputSchema: customersListValidInputSchema,
  outputSchema: customersListValidOutputSchema,
  async execute(context) {
    const input = context.input;
    const result = await executeHttpConnectorRequest<z.infer<typeof customersListValidOutputSchema>>({
      operation: customersListValidOperation,
      runtime: context.runtime,
      query: {
        valid: String(input.valid)
      }
    });
    return result.output;
  }
});
