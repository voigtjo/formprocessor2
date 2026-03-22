import { z } from 'zod';
import { executeHttpConnectorRequest } from '../runtime.js';
import { defineConnectorOperation } from '../types.js';
import { erpSimConnector } from './shared.js';

const batchRecordSchema = z.object({
  id: z.string().min(1),
  product_id: z.string().min(1).optional(),
  batch_number: z.string().min(1),
  status: z.string().min(1).optional()
});

const batchesCreateInputSchema = z.object({
  product_id: z.string().uuid()
});

export const batchesCreateOperation = defineConnectorOperation({
  ref: 'batches.create',
  name: 'Create Batch',
  description: 'Creates a batch in the ERP simulation.',
  connector: erpSimConnector,
  metadata: {
    kind: 'command',
    method: 'POST',
    path: '/api/batches',
    requestShape: {
      body: { product_id: 'uuid' }
    }
  },
  inputSchema: batchesCreateInputSchema,
  outputSchema: batchRecordSchema,
  async execute(context) {
    const result = await executeHttpConnectorRequest<z.infer<typeof batchRecordSchema>>({
      operation: batchesCreateOperation,
      runtime: context.runtime,
      jsonBody: context.input
    });
    return result.output;
  }
});
