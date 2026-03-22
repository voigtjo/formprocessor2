import { z } from 'zod';
import { executeHttpConnectorRequest } from '../runtime.js';
import { defineConnectorOperation } from '../types.js';
import { erpSimConnector } from './shared.js';

const productRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  valid: z.boolean().optional(),
  product_type: z.string().optional()
});

const productsListValidInputSchema = z.object({
  valid: z.boolean().default(true)
});

const productsListValidOutputSchema = z.array(productRecordSchema);

export const productsListValidOperation = defineConnectorOperation({
  ref: 'products.listValid',
  name: 'List Valid Products',
  description: 'Returns valid products from the ERP simulation.',
  connector: erpSimConnector,
  metadata: {
    kind: 'lookup',
    method: 'GET',
    path: '/api/products',
    requestShape: {
      query: { valid: true }
    },
    lookup: {
      valueKey: 'id',
      labelKey: 'name'
    }
  },
  inputSchema: productsListValidInputSchema,
  outputSchema: productsListValidOutputSchema,
  async execute(context) {
    const input = context.input;
    const result = await executeHttpConnectorRequest<z.infer<typeof productsListValidOutputSchema>>({
      operation: productsListValidOperation,
      runtime: context.runtime,
      query: {
        valid: String(input.valid)
      }
    });
    return result.output;
  }
});
