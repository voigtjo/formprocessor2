-- ERP Simulator DB schema (erp_sim)
-- P0

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('batch','serial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE batch_status AS ENUM ('ordered','produced','validated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('received','offer_created','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  valid boolean NOT NULL DEFAULT true,
  product_type product_type NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  valid boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_number text NOT NULL,
  status batch_status NOT NULL DEFAULT 'ordered',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS serial_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  serial_number text NOT NULL,
  status batch_status NOT NULL DEFAULT 'ordered',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_number text NOT NULL,
  status order_status NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_valid_name ON products(valid, name);
CREATE INDEX IF NOT EXISTS idx_customers_valid_name ON customers(valid, name);

CREATE INDEX IF NOT EXISTS idx_batches_product_status ON batches(product_id, status);
CREATE INDEX IF NOT EXISTS idx_serial_instances_product_status ON serial_instances(product_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_status ON customer_orders(customer_id, status);
