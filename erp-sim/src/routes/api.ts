import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ErpDb } from '../db/index.js';
import {
  batches,
  customerOrders,
  customers,
  movementStatusEnum,
  productTypeEnum,
  products,
  serialInstances,
  customerOrderStatusEnum,
  type CustomerOrderStatus,
  type MovementStatus,
  type ProductType
} from '../db/schema.js';

const listMasterQuerySchema = z.object({
  valid: z.enum(['true', 'false']).optional()
});

const listBatchesQuerySchema = z.object({
  product_id: z.string().uuid(),
  status: z.enum(movementStatusEnum.enumValues).optional()
});

const listSerialQuerySchema = z.object({
  product_id: z.string().uuid(),
  status: z.enum(movementStatusEnum.enumValues).optional()
});

const listCustomerOrdersQuerySchema = z.object({
  customer_id: z.string().uuid(),
  status: z.enum(customerOrderStatusEnum.enumValues).optional()
});

const patchValidityBodySchema = z.object({ valid: z.boolean() });
const patchMovementStatusBodySchema = z.object({ status: z.enum(movementStatusEnum.enumValues) });
const patchCustomerOrderStatusBodySchema = z.object({ status: z.enum(customerOrderStatusEnum.enumValues) });
const createCustomerOrderBodySchema = z.object({ customer_id: z.string().uuid().optional() }).optional();
const createBatchBodySchema = z.object({ product_id: z.string().uuid() });
const idParamSchema = z.object({ id: z.string().uuid() });

const movementOrder: MovementStatus[] = ['ordered', 'produced', 'validated'];
const customerOrderOrder: CustomerOrderStatus[] = ['received', 'offer_created', 'completed'];

type CreatedCounts = {
  products: number;
  customers: number;
  batches: number;
  serial_instances: number;
  customer_orders: number;
};

type ApiRepo = ReturnType<typeof createDrizzleRepo>;

function parseBooleanFlag(value: 'true' | 'false' | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value === 'true';
}

function canAdvance<T extends string>(order: T[], from: T, to: T) {
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  return toIndex === fromIndex + 1;
}

function randomSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateOrderNumber() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `O-${random}`;
}

function generateBatchNumber(productId: string) {
  const prefix = productId.slice(0, 8).toUpperCase();
  const suffix = Date.now().toString(36).toUpperCase();
  return `B-${prefix}-${suffix}`;
}

function toProductResponse(item: Awaited<ReturnType<ApiRepo['listProducts']>>[number]) {
  return {
    id: item.id,
    name: item.name,
    valid: item.valid,
    product_type: item.productType
  };
}

function toCustomerResponse(item: Awaited<ReturnType<ApiRepo['listCustomers']>>[number]) {
  return {
    id: item.id,
    name: item.name,
    valid: item.valid
  };
}

function toBatchResponse(item: Awaited<ReturnType<ApiRepo['listBatches']>>[number]) {
  return {
    id: item.id,
    product_id: item.productId,
    batch_number: item.batchNumber,
    status: item.status,
    created_at: item.createdAt
  };
}

function toSerialResponse(item: Awaited<ReturnType<ApiRepo['listSerialInstances']>>[number]) {
  return {
    id: item.id,
    product_id: item.productId,
    serial_number: item.serialNumber,
    status: item.status,
    created_at: item.createdAt
  };
}

function toCustomerOrderResponse(item: Awaited<ReturnType<ApiRepo['listCustomerOrders']>>[number]) {
  return {
    id: item.id,
    customer_id: item.customerId,
    order_number: item.orderNumber,
    status: item.status,
    created_at: item.createdAt
  };
}

export function createDrizzleRepo(db: ErpDb) {
  return {
    async listProducts(valid?: boolean) {
      const where = valid === undefined ? undefined : eq(products.valid, valid);
      return db.select().from(products).where(where).orderBy(asc(products.name));
    },

    async listCustomers(valid?: boolean) {
      const where = valid === undefined ? undefined : eq(customers.valid, valid);
      return db.select().from(customers).where(where).orderBy(asc(customers.name));
    },

    async getProductById(id: string) {
      return db.query.products.findFirst({ where: eq(products.id, id) });
    },

    async getCustomerById(id: string) {
      return db.query.customers.findFirst({ where: eq(customers.id, id) });
    },

    async listBatches(productId: string, status?: MovementStatus) {
      const where = status
        ? and(eq(batches.productId, productId), eq(batches.status, status))
        : eq(batches.productId, productId);
      return db.select().from(batches).where(where).orderBy(asc(batches.createdAt));
    },

    async listSerialInstances(productId: string, status?: MovementStatus) {
      const where = status
        ? and(eq(serialInstances.productId, productId), eq(serialInstances.status, status))
        : eq(serialInstances.productId, productId);
      return db.select().from(serialInstances).where(where).orderBy(asc(serialInstances.createdAt));
    },

    async listCustomerOrders(customerId: string, status?: CustomerOrderStatus) {
      const where = status
        ? and(eq(customerOrders.customerId, customerId), eq(customerOrders.status, status))
        : eq(customerOrders.customerId, customerId);
      return db.select().from(customerOrders).where(where).orderBy(asc(customerOrders.createdAt));
    },

    async setProductValid(id: string, valid: boolean) {
      const updated = await db.update(products).set({ valid }).where(eq(products.id, id)).returning({ id: products.id });
      return updated.length > 0;
    },

    async setCustomerValid(id: string, valid: boolean) {
      const updated = await db.update(customers).set({ valid }).where(eq(customers.id, id)).returning({ id: customers.id });
      return updated.length > 0;
    },

    async getBatchById(id: string) {
      return db.query.batches.findFirst({ where: eq(batches.id, id) });
    },

    async setBatchStatus(id: string, status: MovementStatus) {
      await db.update(batches).set({ status }).where(eq(batches.id, id));
    },

    async getSerialInstanceById(id: string) {
      return db.query.serialInstances.findFirst({ where: eq(serialInstances.id, id) });
    },

    async setSerialInstanceStatus(id: string, status: MovementStatus) {
      await db.update(serialInstances).set({ status }).where(eq(serialInstances.id, id));
    },

    async getCustomerOrderById(id: string) {
      return db.query.customerOrders.findFirst({ where: eq(customerOrders.id, id) });
    },

    async setCustomerOrderStatus(id: string, status: CustomerOrderStatus) {
      await db.update(customerOrders).set({ status }).where(eq(customerOrders.id, id));
    },

    async createCustomerOrder(customerId: string) {
      const orderNumber = generateOrderNumber();
      const inserted = await db
        .insert(customerOrders)
        .values({
          customerId,
          orderNumber,
          status: 'received'
        })
        .returning();
      return inserted[0];
    },

    async createBatch(productId: string) {
      const batchNumber = generateBatchNumber(productId);
      const inserted = await db
        .insert(batches)
        .values({
          productId,
          batchNumber,
          status: 'ordered'
        })
        .returning();
      return inserted[0];
    },

    async randomize(): Promise<CreatedCounts> {
      const suffix = randomSuffix();
      const newProducts = await db
        .insert(products)
        .values([
          { name: `P-${suffix}-1`, valid: true, productType: 'batch' },
          { name: `P-${suffix}-2`, valid: true, productType: 'serial' },
          { name: `P-${suffix}-3`, valid: true, productType: 'batch' }
        ])
        .returning({ id: products.id, productType: products.productType });

      const newCustomers = await db
        .insert(customers)
        .values([
          { name: `C-${suffix}-1`, valid: true },
          { name: `C-${suffix}-2`, valid: true },
          { name: `C-${suffix}-3`, valid: true }
        ])
        .returning({ id: customers.id });

      let batchesCreated = 0;
      let serialCreated = 0;

      for (const [index, product] of newProducts.entries()) {
        if (product.productType === 'batch') {
          await db.insert(batches).values([
            { productId: product.id, batchNumber: `B-${suffix}-${index + 1}-1`, status: 'ordered' },
            { productId: product.id, batchNumber: `B-${suffix}-${index + 1}-2`, status: 'ordered' }
          ]);
          batchesCreated += 2;
        } else {
          await db.insert(serialInstances).values([
            { productId: product.id, serialNumber: `S-${suffix}-${index + 1}-1`, status: 'ordered' },
            { productId: product.id, serialNumber: `S-${suffix}-${index + 1}-2`, status: 'ordered' }
          ]);
          serialCreated += 2;
        }
      }

      let customerOrdersCreated = 0;
      for (const [index, customer] of newCustomers.entries()) {
        await db.insert(customerOrders).values([
          { customerId: customer.id, orderNumber: `O-${suffix}-${index + 1}-1`, status: 'received' },
          { customerId: customer.id, orderNumber: `O-${suffix}-${index + 1}-2`, status: 'received' }
        ]);
        customerOrdersCreated += 2;
      }

      return {
        products: newProducts.length,
        customers: newCustomers.length,
        batches: batchesCreated,
        serial_instances: serialCreated,
        customer_orders: customerOrdersCreated
      };
    }
  };
}

export type ApiRoutesOptions = {
  db?: ErpDb;
  repo?: ApiRepo;
};

export async function apiRoutes(app: FastifyInstance, opts: ApiRoutesOptions = {}) {
  const repo = opts.repo ?? (opts.db ? createDrizzleRepo(opts.db) : undefined);

  if (!repo) {
    throw new Error('apiRoutes requires either db or repo option');
  }

  app.get('/api/products', async (request, reply) => {
    const parsed = listMasterQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }

    const valid = parseBooleanFlag(parsed.data.valid);
    const items = await repo.listProducts(valid);
    return { items: items.map(toProductResponse) };
  });

  app.get('/api/customers', async (request, reply) => {
    const parsed = listMasterQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }

    const valid = parseBooleanFlag(parsed.data.valid);
    const items = await repo.listCustomers(valid);
    return { items: items.map(toCustomerResponse) };
  });

  app.get('/api/batches', async (request, reply) => {
    const parsed = listBatchesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }

    const product = await repo.getProductById(parsed.data.product_id);
    if (!product || !product.valid || product.productType !== 'batch') {
      return { items: [] };
    }

    const items = await repo.listBatches(parsed.data.product_id, parsed.data.status);
    return { items: items.map(toBatchResponse) };
  });

  app.get('/api/serial-instances', async (request, reply) => {
    const parsed = listSerialQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }

    const product = await repo.getProductById(parsed.data.product_id);
    if (!product || !product.valid || product.productType !== 'serial') {
      return { items: [] };
    }

    const items = await repo.listSerialInstances(parsed.data.product_id, parsed.data.status);
    return { items: items.map(toSerialResponse) };
  });

  app.get('/api/customer-orders', async (request, reply) => {
    const parsed = listCustomerOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }

    const customer = await repo.getCustomerById(parsed.data.customer_id);
    if (!customer || !customer.valid) {
      return { items: [] };
    }

    const items = await repo.listCustomerOrders(parsed.data.customer_id, parsed.data.status);
    return { items: items.map(toCustomerOrderResponse) };
  });

  app.get('/api/customer-orders/:id', async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const order = await repo.getCustomerOrderById(parsed.data.id);
    if (!order) {
      return reply.status(404).send({ message: 'Not found' });
    }

    return toCustomerOrderResponse(order);
  });

  app.post('/api/batches', async (request, reply) => {
    const parsed = createBatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body: product_id (uuid) is required' });
    }

    const product = await repo.getProductById(parsed.data.product_id);
    if (!product) {
      return reply.status(400).send({ message: 'Invalid product_id: product not found' });
    }
    if (!product.valid) {
      return reply.status(400).send({ message: 'Invalid product_id: product is not valid' });
    }
    if (product.productType !== 'batch') {
      return reply.status(400).send({ message: 'Invalid product_id: product_type must be batch' });
    }

    const created = await repo.createBatch(parsed.data.product_id);
    return toBatchResponse(created);
  });

  app.post('/api/customer-orders', async (request, reply) => {
    const parsed = createCustomerOrderBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body' });
    }

    let customerId = parsed.data?.customer_id;
    if (!customerId) {
      const fallbackCustomer = (await repo.listCustomers(true))[0];
      if (!fallbackCustomer) {
        return reply.status(400).send({ message: 'No valid customer available' });
      }
      customerId = fallbackCustomer.id;
    } else {
      const customer = await repo.getCustomerById(customerId);
      if (!customer) {
        return reply.status(404).send({ message: 'Customer not found' });
      }
    }

    const created = await repo.createCustomerOrder(customerId);
    return toCustomerOrderResponse(created);
  });

  app.post('/api/randomize', async () => {
    const created = await repo.randomize();
    return { ok: true, created };
  });

  app.patch('/api/products/:id', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = patchValidityBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const ok = await repo.setProductValid(parsedParams.data.id, parsedBody.data.valid);
    if (!ok) {
      return reply.status(404).send({ message: 'Not found' });
    }

    return { ok: true };
  });

  app.patch('/api/customers/:id', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = patchValidityBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const ok = await repo.setCustomerValid(parsedParams.data.id, parsedBody.data.valid);
    if (!ok) {
      return reply.status(404).send({ message: 'Not found' });
    }

    return { ok: true };
  });

  app.patch('/api/batches/:id/status', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = patchMovementStatusBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const current = await repo.getBatchById(parsedParams.data.id);
    if (!current) {
      return reply.status(404).send({ message: 'Not found' });
    }

    if (!canAdvance(movementOrder, current.status, parsedBody.data.status)) {
      return reply.status(409).send({ message: 'Invalid transition' });
    }

    await repo.setBatchStatus(parsedParams.data.id, parsedBody.data.status);
    return { ok: true };
  });

  app.patch('/api/serial-instances/:id/status', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = patchMovementStatusBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const current = await repo.getSerialInstanceById(parsedParams.data.id);
    if (!current) {
      return reply.status(404).send({ message: 'Not found' });
    }

    if (!canAdvance(movementOrder, current.status, parsedBody.data.status)) {
      return reply.status(409).send({ message: 'Invalid transition' });
    }

    await repo.setSerialInstanceStatus(parsedParams.data.id, parsedBody.data.status);
    return { ok: true };
  });

  app.patch('/api/customer-orders/:id/status', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = patchCustomerOrderStatusBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid request' });
    }

    const current = await repo.getCustomerOrderById(parsedParams.data.id);
    if (!current) {
      return reply.status(404).send({ message: 'Not found' });
    }

    if (!canAdvance(customerOrderOrder, current.status, parsedBody.data.status)) {
      return reply.status(409).send({ message: 'Invalid transition' });
    }

    await repo.setCustomerOrderStatus(parsedParams.data.id, parsedBody.data.status);
    return { ok: true };
  });
}

export type {
  ApiRepo,
  ProductType,
  MovementStatus,
  CustomerOrderStatus,
  CreatedCounts
};
