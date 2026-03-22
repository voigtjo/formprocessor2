import { z } from 'zod';
import { executeIntegrationRequest } from '../../core/integration-client.js';
import { resolveConnectorAuth } from '../auth.js';
import { executeHttpConnectorRequest } from '../runtime.js';
import { resolveConnectorBaseUrl } from '../runtime.js';
import { defineConnectorOperation } from '../types.js';
import { erpSimConnector } from './shared.js';

const customerOrderRecordSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1).optional(),
  order_number: z.string().min(1),
  status: z.string().min(1).optional()
});

const customerOrdersCreateInputSchema = z.object({
  customer_id: z.string().uuid()
});

const customerOrdersSetStatusInputSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1)
});

const customerOrdersSetStatusOutputSchema = z.object({
  ok: z.boolean()
});

const erpCustomerOrderStatusSchema = z.enum(['received', 'offer_created', 'completed']);

function normalizeCustomerOrderStatus(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'received' || normalized === 'assigned' || normalized === 'started' || normalized === 'draft') {
    return 'received' as const;
  }
  if (normalized === 'offer_created' || normalized === 'submitted') {
    return 'offer_created' as const;
  }
  if (normalized === 'completed' || normalized === 'approved' || normalized === 'rejected' || normalized === 'archived') {
    return 'completed' as const;
  }
  return normalized || 'received';
}

export const customerOrdersCreateOperation = defineConnectorOperation({
  ref: 'customerOrders.create',
  name: 'Create Customer Order',
  description: 'Creates a customer order in the ERP simulation.',
  connector: erpSimConnector,
  metadata: {
    kind: 'command',
    method: 'POST',
    path: '/api/customer-orders',
    requestShape: {
      body: { customer_id: 'uuid' }
    }
  },
  inputSchema: customerOrdersCreateInputSchema,
  outputSchema: customerOrderRecordSchema,
  async execute(context) {
    const result = await executeHttpConnectorRequest<z.infer<typeof customerOrderRecordSchema>>({
      operation: customerOrdersCreateOperation,
      runtime: context.runtime,
      jsonBody: context.input
    });
    return {
      output: result.output,
      patch: {
        integrationContextJson: {
          customerOrder: {
            lastCreated: {
              id: result.output.id,
              orderNumber: result.output.order_number,
              customerId: result.output.customer_id ?? context.input.customer_id
            }
          }
        }
      }
    };
  }
});

export const customerOrdersSetStatusOperation = defineConnectorOperation({
  ref: 'customerOrders.setStatus',
  name: 'Set Customer Order Status',
  description: 'Updates the ERP simulation status of an existing customer order.',
  connector: erpSimConnector,
  metadata: {
    kind: 'command',
    method: 'PATCH',
    path: '/api/customer-orders/:id/status',
    requestShape: {
      body: { id: 'string', status: 'string' }
    }
  },
  inputSchema: customerOrdersSetStatusInputSchema,
  outputSchema: customerOrdersSetStatusOutputSchema,
  async execute(context) {
    const baseUrl = resolveConnectorBaseUrl(context.connector, context.runtime);
    const auth = resolveConnectorAuth(context.connector.auth, context.runtime.credentials);
    const fetchImpl = context.runtime.fetchImpl ?? fetch;
    const targetStatus = normalizeCustomerOrderStatus(context.input.status);
    const currentResponse = await executeIntegrationRequest(
      {
        baseUrl,
        path: `/api/customer-orders/${encodeURIComponent(context.input.id)}`,
        method: 'GET',
        query: auth.query,
        headers: auth.headers
      },
      fetchImpl
    );

    if (!currentResponse.ok) {
      throw new Error(`Connector operation failed (${currentResponse.status}) ${customerOrdersSetStatusOperation.ref}`);
    }

    const currentOrder = customerOrderRecordSchema.parse(currentResponse.bodyJson);
    const currentStatus = erpCustomerOrderStatusSchema.parse(currentOrder.status ?? 'received');
    const order = ['received', 'offer_created', 'completed'] as const;
    const currentIndex = order.indexOf(currentStatus);
    const targetIndex = order.indexOf(targetStatus);

    if (currentIndex === -1 || targetIndex === -1) {
      throw new Error(`Unsupported ERP status transition for ${customerOrdersSetStatusOperation.ref}`);
    }

    if (targetIndex < currentIndex) {
      return { output: { ok: true } };
    }

    for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
      const nextStatus = order[index];
      const response = await executeIntegrationRequest(
        {
          baseUrl,
          path: `/api/customer-orders/${encodeURIComponent(context.input.id)}/status`,
          method: 'PATCH',
          query: auth.query,
          headers: auth.headers,
          jsonBody: { status: nextStatus }
        },
        fetchImpl
      );

      if (!response.ok) {
        throw new Error(`Connector operation failed (${response.status}) ${customerOrdersSetStatusOperation.ref}`);
      }
    }

    return {
      output: { ok: true },
      patch: {
        integrationContextJson: {
          customerOrder: {
            lastSync: {
              id: context.input.id,
              requestedStatus: context.input.status,
              appliedStatus: targetStatus
            }
          }
        }
      }
    };
  }
});

const customerOrdersSetStatusFromContextInputSchema = z.object({
  status: z.string().min(1),
  id: z.string().min(1).optional()
});

export const customerOrdersSetStatusFromContextOperation = defineConnectorOperation({
  ref: 'customerOrders.setStatusFromContext',
  name: 'Set Customer Order Status From Context',
  description: 'Reads the last created customer order id from document integration context and syncs its status.',
  connector: erpSimConnector,
  metadata: {
    kind: 'command',
    method: 'PATCH',
    path: '/api/customer-orders/:id/status',
    requestShape: {
      body: { status: 'string', id: 'string?' }
    }
  },
  inputSchema: customerOrdersSetStatusFromContextInputSchema,
  outputSchema: customerOrdersSetStatusOutputSchema,
  async execute(context) {
    const explicitId = typeof context.input.id === 'string' && context.input.id.trim().length > 0 ? context.input.id.trim() : '';
    const contextId = String(
      context.runtime.context?.integration?.customerOrder &&
        typeof context.runtime.context.integration.customerOrder === 'object' &&
        !Array.isArray(context.runtime.context.integration.customerOrder) &&
        (context.runtime.context.integration.customerOrder as Record<string, unknown>).lastCreated &&
        typeof (context.runtime.context.integration.customerOrder as Record<string, unknown>).lastCreated === 'object' &&
        !Array.isArray((context.runtime.context.integration.customerOrder as Record<string, unknown>).lastCreated)
        ? (((context.runtime.context.integration.customerOrder as Record<string, unknown>).lastCreated as Record<string, unknown>).id ?? '')
        : ''
    ).trim();
    const fallbackExternalId = String(context.runtime.context?.external?.customer_order_id ?? '').trim();
    const id = explicitId || contextId || fallbackExternalId;
    if (!id) {
      throw new Error('No customer order id found in operation input, integration context or external refs');
    }
    return customerOrdersSetStatusOperation.execute({
      ...context,
      operation: customerOrdersSetStatusFromContextOperation,
      input: {
        id,
        status: context.input.status
      }
    });
  }
});
