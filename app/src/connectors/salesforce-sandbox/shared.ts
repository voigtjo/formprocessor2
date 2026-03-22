import { defineConnector } from '../types.js';

export const salesforceSandboxConnector = defineConnector({
  key: 'salesforce-sandbox',
  name: 'Salesforce Sandbox',
  description: 'Example bearer-token connector shape for future external CRM integrations.',
  auth: {
    type: 'bearerToken',
    credentialsKey: 'salesforceSandbox'
  },
  baseUrl: {
    source: 'env',
    value: 'SALESFORCE_SANDBOX_BASE_URL'
  },
  metadata: {
    copyReady: true,
    targetSystem: 'Salesforce'
  }
});
