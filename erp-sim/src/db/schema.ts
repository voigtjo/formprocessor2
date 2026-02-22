import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

export const productTypeEnum = pgEnum('product_type_enum', ['batch', 'serial']);
export const movementStatusEnum = pgEnum('movement_status_enum', ['ordered', 'produced', 'validated']);
export const customerOrderStatusEnum = pgEnum('customer_order_status_enum', ['received', 'offer_created', 'completed']);

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    valid: boolean('valid').notNull().default(true),
    productType: productTypeEnum('product_type').notNull()
  },
  (table) => [index('idx_products_valid_name').on(table.valid, table.name)]
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    valid: boolean('valid').notNull().default(true)
  },
  (table) => [index('idx_customers_valid_name').on(table.valid, table.name)]
);

export const batches = pgTable(
  'batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchNumber: text('batch_number').notNull(),
    status: movementStatusEnum('status').notNull().default('ordered'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('idx_batches_product_status').on(table.productId, table.status)]
);

export const serialInstances = pgTable(
  'serial_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    status: movementStatusEnum('status').notNull().default('ordered'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('idx_serial_instances_product_status').on(table.productId, table.status)]
);

export const customerOrders = pgTable(
  'customer_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    orderNumber: text('order_number').notNull(),
    status: customerOrderStatusEnum('status').notNull().default('received'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('idx_customer_orders_customer_status').on(table.customerId, table.status)]
);

export type ProductType = (typeof productTypeEnum.enumValues)[number];
export type MovementStatus = (typeof movementStatusEnum.enumValues)[number];
export type CustomerOrderStatus = (typeof customerOrderStatusEnum.enumValues)[number];
