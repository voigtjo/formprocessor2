import { z } from 'zod';
import { executeHttpConnectorRequest } from '../runtime.js';
import { defineConnectorOperation } from '../types.js';
import { salesforceSandboxConnector } from './shared.js';

const salesforceAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1)
});

const salesforceAccountsListRecentInputSchema = z.object({
  limit: z.number().int().positive().max(200).default(10)
});

const salesforceAccountsListRecentOutputSchema = z.array(salesforceAccountSchema);

export const salesforceAccountsListRecentOperation = defineConnectorOperation({
  ref: 'salesforce.accounts.listRecent',
  name: 'List Recent Accounts',
  description: 'Example bearer-token operation shape for future Salesforce integrations.',
  connector: salesforceSandboxConnector,
  metadata: {
    kind: 'query',
    method: 'GET',
    path: '/services/data/v1/accounts',
    requestShape: {
      query: { limit: 10 }
    },
    lookup: {
      valueKey: 'id',
      labelKey: 'name'
    }
  },
  inputSchema: salesforceAccountsListRecentInputSchema,
  outputSchema: salesforceAccountsListRecentOutputSchema,
  async execute(context) {
    const result = await executeHttpConnectorRequest<z.infer<typeof salesforceAccountsListRecentOutputSchema>>({
      operation: salesforceAccountsListRecentOperation,
      runtime: context.runtime,
      query: {
        limit: String(context.input.limit)
      }
    });
    return result.output;
  }
});
