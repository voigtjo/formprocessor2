import { defineConnector } from '../types.js';

export const erpSimConnector = defineConnector({
  key: 'erp-sim',
  name: 'ERP Simulation',
  description: 'Local ERP simulator used as the V1 connector reference backend.',
  auth: { type: 'none' },
  baseUrl: {
    source: 'service-registry',
    value: 'erp'
  },
  metadata: {
    copyReady: true,
    targetSystem: 'ERP simulation'
  }
});
