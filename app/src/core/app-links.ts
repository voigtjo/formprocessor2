export function normalizeAppBaseUrl(raw: string | null | undefined) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

export function resolveAppBaseUrl(params: {
  configuredBaseUrl?: string | null;
  requestProtocol?: string | null;
  requestHost?: string | null;
}) {
  const configured = normalizeAppBaseUrl(params.configuredBaseUrl);
  if (configured) return configured;
  const protocol = String(params.requestProtocol ?? '').trim() || 'http';
  const host = String(params.requestHost ?? '').trim();
  if (!host) return 'http://localhost:3000';
  return `${protocol}://${host}`;
}

export function buildDocumentDeepLink(params: {
  baseUrl: string;
  documentId: string;
}) {
  return `${normalizeAppBaseUrl(params.baseUrl)}/documents/${encodeURIComponent(params.documentId)}`;
}
