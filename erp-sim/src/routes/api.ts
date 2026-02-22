import type { FastifyInstance } from 'fastify';

// P0 scaffold: endpoints return empty arrays until Run 1 implementation.
export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/products', async () => ({ items: [] }));
  app.get('/api/customers', async () => ({ items: [] }));
  app.get('/api/batches', async () => ({ items: [] }));
  app.get('/api/serial-instances', async () => ({ items: [] }));
  app.get('/api/customer-orders', async () => ({ items: [] }));

  app.post('/api/randomize', async () => ({ ok: true, created: { products: 0, customers: 0, batches: 0, serial_instances: 0, customer_orders: 0 } }));

  app.patch('/api/products/:id', async () => ({ ok: true }));
  app.patch('/api/customers/:id', async () => ({ ok: true }));

  app.patch('/api/batches/:id/status', async () => ({ ok: true }));
  app.patch('/api/serial-instances/:id/status', async () => ({ ok: true }));
  app.patch('/api/customer-orders/:id/status', async () => ({ ok: true }));
}
