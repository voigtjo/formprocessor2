import { describe, expect, it } from 'vitest';
import { resolveConnectorAuth } from './auth.js';

describe('connector auth resolution', () => {
  it('builds api key query auth', () => {
    const result = resolveConnectorAuth(
      {
        type: 'apiKey',
        credentialsKey: 'sapSandbox',
        in: 'query',
        name: 'api_key'
      },
      {
        sapSandbox: {
          type: 'apiKey',
          apiKey: 'secret-key'
        }
      }
    );

    expect(result.query).toEqual({ api_key: 'secret-key' });
    expect(result.headers).toEqual({});
  });

  it('builds bearer token header auth', () => {
    const result = resolveConnectorAuth(
      {
        type: 'bearerToken',
        credentialsKey: 'salesforceSandbox'
      },
      {
        salesforceSandbox: {
          type: 'bearerToken',
          token: 'token-123'
        }
      }
    );

    expect(result.headers.Authorization).toBe('Bearer token-123');
  });

  it('fails clearly on credential type mismatch', () => {
    expect(() =>
      resolveConnectorAuth(
        {
          type: 'basic',
          credentialsKey: 'sapSandbox'
        },
        {
          sapSandbox: {
            type: 'apiKey',
            apiKey: 'wrong-shape'
          }
        }
      )
    ).toThrow('Connector auth credential type mismatch');
  });
});
