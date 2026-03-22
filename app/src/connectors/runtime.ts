import { executeIntegrationRequest } from '../core/integration-client.js';
import { resolveServiceBaseUrl } from '../services/service-registry.js';
import { resolveConnectorAuth } from './auth.js';
import type { AnyConnectorOperationDefinition, ConnectorDefinition, ConnectorRuntime } from './types.js';

export function resolveConnectorBaseUrl(connector: ConnectorDefinition, runtime: ConnectorRuntime) {
  if (connector.baseUrl.source === 'service-registry') {
    return resolveServiceBaseUrl(connector.baseUrl.value, runtime.defaultErpBaseUrl);
  }
  if (connector.baseUrl.source === 'static') {
    return connector.baseUrl.value;
  }
  const envValue = runtime.env?.[connector.baseUrl.value] ?? process.env[connector.baseUrl.value];
  if (!envValue || String(envValue).trim().length === 0) {
    throw new Error(`Missing connector base URL env: ${connector.baseUrl.value}`);
  }
  return String(envValue).trim();
}

export async function executeHttpConnectorRequest<TOutput>(params: {
  operation: AnyConnectorOperationDefinition;
  runtime: ConnectorRuntime;
  query?: Record<string, string>;
  jsonBody?: unknown;
}) {
  const baseUrl = resolveConnectorBaseUrl(params.operation.connector, params.runtime);
  const auth = resolveConnectorAuth(params.operation.connector.auth, params.runtime.credentials);
  const response = await executeIntegrationRequest(
    {
      baseUrl,
      path: params.operation.metadata.path,
      method: params.operation.metadata.method,
      query: {
        ...(params.query ?? {}),
        ...auth.query
      },
      headers: auth.headers,
      jsonBody: params.jsonBody
    },
    params.runtime.fetchImpl ?? fetch
  );

  if (!response.ok) {
    throw new Error(`Connector operation failed (${response.status}) ${params.operation.ref}`);
  }

  const parsed = params.operation.outputSchema.parse(response.bodyJson);
  return {
    response,
    output: parsed as TOutput
  };
}
