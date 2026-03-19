import { describe, expect, it } from 'vitest';
import { buildDocumentDeepLink, normalizeAppBaseUrl, resolveAppBaseUrl } from './app-links.js';

describe('app links', () => {
  it('normalizes configured base urls', () => {
    expect(normalizeAppBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('resolves configured base url before request headers', () => {
    expect(
      resolveAppBaseUrl({
        configuredBaseUrl: 'https://app.example.test/',
        requestProtocol: 'http',
        requestHost: 'localhost:3000'
      })
    ).toBe('https://app.example.test');
  });

  it('builds document deep links centrally', () => {
    expect(
      buildDocumentDeepLink({
        baseUrl: 'https://app.example.test/',
        documentId: 'doc-1'
      })
    ).toBe('https://app.example.test/documents/doc-1');
  });
});
