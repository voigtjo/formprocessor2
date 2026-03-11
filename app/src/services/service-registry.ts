export type SupportedLookupService = 'erp-sim' | 'erp';

export function resolveServiceBaseUrl(service: string | undefined, defaultErpBaseUrl: string) {
  const normalized = String(service ?? 'erp-sim').trim().toLowerCase();
  if (normalized === '' || normalized === 'erp-sim' || normalized === 'erp') {
    return defaultErpBaseUrl;
  }
  throw new Error(`Unsupported lookup service: ${service}`);
}
