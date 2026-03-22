import { z } from 'zod';
import type { IntegrationHttpMethod } from '../core/integration-client.js';

export const connectorAuthNoneSchema = z.object({ type: z.literal('none') });
export const connectorAuthApiKeySchema = z.object({
  type: z.literal('apiKey'),
  credentialsKey: z.string().min(1),
  in: z.enum(['header', 'query']).default('header'),
  name: z.string().min(1)
});
export const connectorAuthBasicSchema = z.object({
  type: z.literal('basic'),
  credentialsKey: z.string().min(1)
});
export const connectorAuthBearerTokenSchema = z.object({
  type: z.literal('bearerToken'),
  credentialsKey: z.string().min(1)
});
export const connectorAuthOauthClientCredentialsSchema = z.object({
  type: z.literal('oauth2ClientCredentials'),
  credentialsKey: z.string().min(1),
  tokenUrl: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  audience: z.string().optional()
});

export const connectorAuthConfigSchema = z.discriminatedUnion('type', [
  connectorAuthNoneSchema,
  connectorAuthApiKeySchema,
  connectorAuthBasicSchema,
  connectorAuthBearerTokenSchema,
  connectorAuthOauthClientCredentialsSchema
]);

export type ConnectorAuthConfig = z.infer<typeof connectorAuthConfigSchema>;

export const connectorCredentialsNoneSchema = z.object({ type: z.literal('none') });
export const connectorCredentialsApiKeySchema = z.object({ type: z.literal('apiKey'), apiKey: z.string().min(1) });
export const connectorCredentialsBasicSchema = z.object({
  type: z.literal('basic'),
  username: z.string().min(1),
  password: z.string().min(1)
});
export const connectorCredentialsBearerTokenSchema = z.object({
  type: z.literal('bearerToken'),
  token: z.string().min(1)
});
export const connectorCredentialsOauthClientCredentialsSchema = z.object({
  type: z.literal('oauth2ClientCredentials'),
  accessToken: z.string().min(1),
  tokenType: z.string().default('Bearer'),
  expiresAt: z.string().optional(),
  scopes: z.array(z.string()).optional()
});

export const connectorCredentialsSchema = z.discriminatedUnion('type', [
  connectorCredentialsNoneSchema,
  connectorCredentialsApiKeySchema,
  connectorCredentialsBasicSchema,
  connectorCredentialsBearerTokenSchema,
  connectorCredentialsOauthClientCredentialsSchema
]);

export type ConnectorCredentials = z.infer<typeof connectorCredentialsSchema>;

export type ConnectorDefinition = {
  key: string;
  name: string;
  description?: string;
  auth: ConnectorAuthConfig;
  baseUrl: {
    source: 'service-registry' | 'env' | 'static';
    value: string;
  };
  metadata?: {
    copyReady?: boolean;
    targetSystem?: string;
  };
};

export type ConnectorOperationMetadata = {
  kind: 'lookup' | 'command' | 'query';
  method: IntegrationHttpMethod;
  path: string;
  requestShape?: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  };
  lookup?: {
    valueKey?: string;
    labelKey?: string;
  };
};

export type ConnectorRuntime = {
  defaultErpBaseUrl: string;
  fetchImpl?: typeof fetch;
  credentials?: Record<string, ConnectorCredentials | undefined>;
  env?: Record<string, string | undefined>;
  context?: ConnectorRuntimeContext;
};

export type ConnectorRuntimeContext = {
  document: {
    id: string;
    status: string;
  };
  data: Record<string, unknown>;
  external: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  integration: Record<string, unknown>;
  template?: {
    id?: string;
    key?: string;
    name?: string;
  };
  workflow?: {
    ref?: string;
    actionKey?: string;
    trigger?: 'formAction' | 'workflowTransition' | 'workflowAction' | 'enterState';
  };
  user?: {
    id?: string;
    username?: string;
    displayName?: string;
  };
};

export type ConnectorContextPatch = {
  dataJson?: Record<string, unknown>;
  externalRefsJson?: Record<string, unknown>;
  snapshotsJson?: Record<string, unknown>;
  integrationContextJson?: Record<string, unknown>;
  status?: string;
};

export type ConnectorExecuteContext<TInput> = {
  connector: ConnectorDefinition;
  operation: ConnectorOperationDefinition<TInput, unknown>;
  input: TInput;
  runtime: ConnectorRuntime;
};

export type ConnectorOperationExecutionResult<TOutput> = {
  output: TOutput;
  patch?: ConnectorContextPatch;
};

export type ConnectorOperationDefinition<TInput, TOutput> = {
  ref: string;
  name: string;
  description?: string;
  connector: ConnectorDefinition;
  metadata: ConnectorOperationMetadata;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (
    context: ConnectorExecuteContext<TInput>
  ) => Promise<TOutput | ConnectorOperationExecutionResult<TOutput>>;
};

export type AnyConnectorOperationDefinition = ConnectorOperationDefinition<any, any>;

export function defineConnector(definition: ConnectorDefinition) {
  return definition;
}

export function defineConnectorOperation<TInput, TOutput>(definition: ConnectorOperationDefinition<TInput, TOutput>) {
  return definition;
}
