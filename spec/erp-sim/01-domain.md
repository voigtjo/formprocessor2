# ERP Simulator – Domain (P0)

ERP-Sim provides realistic but minimal master + movement data and allows controlled status transitions.

## Master Data

### products
- `id` (uuid)
- `name` (text)
- `valid` (boolean)
- `product_type` (enum: `batch` | `serial`)

Rules:
- `name` is unique (case-insensitive uniqueness acceptable but not required in P0)

### customers
- `id` (uuid)
- `name` (text)
- `valid` (boolean)

Rules:
- `name` is unique (same note as products)

## Movement Data

Movement data exists only for **valid** master data, but may persist after invalidation.

### batches
Used only when `products.product_type = 'batch'`.

- `id` (uuid)
- `product_id` (uuid FK → products.id)
- `batch_number` (text)
- `status` (enum: `ordered` | `produced` | `validated`)
- `created_at` (timestamptz)

### serial_instances
Used only when `products.product_type = 'serial'`.

- `id` (uuid)
- `product_id` (uuid FK → products.id)
- `serial_number` (text)
- `status` (enum: `ordered` | `produced` | `validated`)
- `created_at` (timestamptz)

### customer_orders
- `id` (uuid)
- `customer_id` (uuid FK → customers.id)
- `order_number` (text)
- `status` (enum: `received` | `offer_created` | `completed`)
- `created_at` (timestamptz)

## Status transitions (P0)

All transitions are **monotonic forward only**.

- `batches.status`: `ordered` → `produced` → `validated`
- `serial_instances.status`: `ordered` → `produced` → `validated`
- `customer_orders.status`: `received` → `offer_created` → `completed`

Invalid transitions return 409.

## Validity rules for queries

- Query endpoints filter by `valid=true` **if requested** and sort by `name`.
- Movement query endpoints only return records if the referenced master is `valid=true` and has correct `product_type`.
