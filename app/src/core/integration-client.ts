export type IntegrationHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type IntegrationRequest = {
  baseUrl: string;
  path: string;
  method?: IntegrationHttpMethod;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  jsonBody?: unknown;
};

export type IntegrationResponse = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  bodyText: string;
  bodyJson?: unknown;
};

export function buildIntegrationUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (String(value ?? '').trim().length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

export async function executeIntegrationRequest(
  request: IntegrationRequest,
  fetchImpl: typeof fetch = fetch
): Promise<IntegrationResponse> {
  const method = (request.method ?? 'GET').toUpperCase() as IntegrationHttpMethod;
  const url = buildIntegrationUrl(request.baseUrl, request.path, request.query);
  const hasBody = request.jsonBody !== undefined && method !== 'GET' && method !== 'HEAD';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(request.headers ?? {}),
    ...(hasBody ? { 'Content-Type': 'application/json' } : {})
  };

  const response = await fetchImpl(url.toString(), {
    method,
    headers,
    ...(hasBody ? { body: JSON.stringify(request.jsonBody) } : {})
  });

  const bodyText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  let bodyJson: unknown;
  if (bodyText && contentType.includes('application/json')) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = undefined;
    }
  }

  return {
    url: url.toString(),
    status: response.status,
    ok: response.ok,
    contentType,
    bodyText,
    bodyJson
  };
}
