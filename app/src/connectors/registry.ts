import { z } from 'zod';
import type { ApiCatalogEntry } from '../actions/api-catalog.js';
import { batchesCreateOperation } from './erp-sim/batches.js';
import {
  customerOrdersCreateOperation,
  customerOrdersSetStatusFromContextOperation,
  customerOrdersSetStatusOperation
} from './erp-sim/customer-orders.js';
import { customersListValidOperation } from './erp-sim/customers.js';
import { productsListValidOperation } from './erp-sim/products.js';
import { salesforceAccountsListRecentOperation } from './salesforce-sandbox/accounts.js';
import type { AnyConnectorOperationDefinition, ConnectorRuntime } from './types.js';

const operations = [
  productsListValidOperation,
  customersListValidOperation,
  batchesCreateOperation,
  customerOrdersCreateOperation,
  customerOrdersSetStatusOperation,
  customerOrdersSetStatusFromContextOperation,
  salesforceAccountsListRecentOperation
] satisfies AnyConnectorOperationDefinition[];

const byRef = new Map(operations.map((operation) => [operation.ref, operation]));

export function listConnectorOperations() {
  return [...operations];
}

export function resolveConnectorOperation(ref: string) {
  const normalized = String(ref ?? '').trim();
  const direct = byRef.get(normalized);
  if (direct) return direct;
  if (normalized.startsWith('operation:')) {
    const stripped = normalized.slice('operation:'.length);
    const byOperationPrefix = byRef.get(stripped);
    if (byOperationPrefix) return byOperationPrefix;
  }
  if (normalized.startsWith('api:')) {
    const stripped = normalized.slice('api:'.length);
    const byApiPrefix = byRef.get(stripped);
    if (byApiPrefix) return byApiPrefix;
  }
  return null;
}

export async function executeConnectorOperation<TInput = unknown, TOutput = unknown>(params: {
  ref: string;
  input: TInput;
  runtime: ConnectorRuntime;
}) {
  const operation = resolveConnectorOperation(params.ref);
  if (!operation) {
    throw new Error(`Connector operation not found: ${params.ref}`);
  }
  const parsedInput = operation.inputSchema.parse(params.input);
  const rawResult = await operation.execute({
    connector: operation.connector,
    operation,
    input: parsedInput,
    runtime: params.runtime
  });
  const executionResult =
    rawResult && typeof rawResult === 'object' && Object.prototype.hasOwnProperty.call(rawResult, 'output')
      ? (rawResult as { output: unknown; patch?: unknown })
      : { output: rawResult, patch: undefined };
  return {
    operation,
    output: operation.outputSchema.parse(executionResult.output) as TOutput,
    patch:
      executionResult.patch && typeof executionResult.patch === 'object'
        ? (executionResult.patch as Record<string, unknown>)
        : undefined
  };
}

export function toApiCatalogEntry(operation: AnyConnectorOperationDefinition, runtime: ConnectorRuntime): ApiCatalogEntry {
  const requestShape = operation.metadata.requestShape;
  const requestSchemaJson = requestShape
    ? {
        ...(requestShape.query ? { query: requestShape.query } : {}),
        ...(requestShape.body ? { body: requestShape.body } : {})
      }
    : null;
  const outputShape = operation.outputSchema instanceof z.ZodArray ? [] : {};

  let baseUrl: string | undefined;
  try {
    if (operation.connector.baseUrl.source === 'static') {
      baseUrl = operation.connector.baseUrl.value;
    } else if (operation.connector.baseUrl.source === 'service-registry') {
      baseUrl = runtime.defaultErpBaseUrl;
    } else {
      baseUrl = runtime.env?.[operation.connector.baseUrl.value] ?? process.env[operation.connector.baseUrl.value];
    }
  } catch {
    baseUrl = undefined;
  }

  return {
    key: operation.ref,
    ref: `api:${operation.ref}`,
    name: operation.name,
    description: operation.description,
    serviceKey:
      operation.connector.baseUrl.source === 'static' || operation.connector.baseUrl.source === 'env' ? 'custom' : 'erp',
    method: operation.metadata.method,
    baseUrl,
    path: operation.metadata.path,
    requestSchemaJson,
    responseSchemaJson: outputShape,
    handlerCode: null
  };
}
