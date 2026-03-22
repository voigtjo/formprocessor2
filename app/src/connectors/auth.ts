import { Buffer } from 'node:buffer';
import type { ConnectorAuthConfig, ConnectorCredentials } from './types.js';

export type ResolvedAuth = {
  headers: Record<string, string>;
  query: Record<string, string>;
};

function readCredential(config: ConnectorAuthConfig, credentials: Record<string, ConnectorCredentials | undefined> | undefined) {
  if (config.type === 'none') return { type: 'none' } as const;
  const resolved = credentials?.[config.credentialsKey];
  if (!resolved) {
    throw new Error(`Missing credentials for connector auth key: ${config.credentialsKey}`);
  }
  return resolved;
}

export function resolveConnectorAuth(
  config: ConnectorAuthConfig,
  credentials: Record<string, ConnectorCredentials | undefined> | undefined
): ResolvedAuth {
  if (config.type === 'none') {
    return { headers: {}, query: {} };
  }

  const resolved = readCredential(config, credentials);

  if (config.type === 'apiKey') {
    if (resolved.type !== 'apiKey') {
      throw new Error(`Connector auth credential type mismatch for ${config.credentialsKey}`);
    }
    return config.in === 'query'
      ? { headers: {}, query: { [config.name]: resolved.apiKey } }
      : { headers: { [config.name]: resolved.apiKey }, query: {} };
  }

  if (config.type === 'basic') {
    if (resolved.type !== 'basic') {
      throw new Error(`Connector auth credential type mismatch for ${config.credentialsKey}`);
    }
    const token = Buffer.from(`${resolved.username}:${resolved.password}`).toString('base64');
    return {
      headers: { Authorization: `Basic ${token}` },
      query: {}
    };
  }

  if (config.type === 'bearerToken') {
    if (resolved.type !== 'bearerToken') {
      throw new Error(`Connector auth credential type mismatch for ${config.credentialsKey}`);
    }
    return {
      headers: { Authorization: `Bearer ${resolved.token}` },
      query: {}
    };
  }

  if (resolved.type !== 'oauth2ClientCredentials') {
    throw new Error(`Connector auth credential type mismatch for ${config.credentialsKey}`);
  }

  return {
    headers: { Authorization: `${resolved.tokenType} ${resolved.accessToken}` },
    query: {}
  };
}
