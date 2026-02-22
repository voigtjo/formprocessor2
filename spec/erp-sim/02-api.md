# ERP Simulator – HTTP API (P0)

Base: `http://localhost:<ERP_PORT>`

## Conventions

- JSON only
- `200` success
- `400` bad query params/body
- `404` missing entity
- `409` invalid status transition

## Endpoints

### Health
- `GET /health` → `{ ok: true }`

### Master data lists

#### Products
- `GET /api/products?valid=true`
  - If `valid=true` → return only valid products
  - Always sort by `name` ascending

Response:
```json
{ "items": [ { "id": "...", "name": "...", "valid": true, "product_type": "batch" } ] }
```

#### Customers
- `GET /api/customers?valid=true`
  - If `valid=true` → return only valid customers
  - Always sort by `name` ascending

Response:
```json
{ "items": [ { "id": "...", "name": "...", "valid": true } ] }
```

### Movement lists

#### Batches
- `GET /api/batches?status=ordered&product_id=<uuid>`

Rules:
- Only return items where:
  - batch.status matches
  - `products.valid=true`
  - `products.product_type='batch'`

Response:
```json
{ "items": [ { "id":"...", "product_id":"...", "batch_number":"B-0001", "status":"ordered", "created_at":"..." } ] }
```

#### Serial instances
- `GET /api/serial-instances?status=ordered&product_id=<uuid>`

Rules:
- Only return items where:
  - status matches
  - `products.valid=true`
  - `products.product_type='serial'`

Response:
```json
{ "items": [ { "id":"...", "product_id":"...", "serial_number":"S-0001", "status":"ordered", "created_at":"..." } ] }
```

#### Customer orders
- `GET /api/customer-orders?status=received&customer_id=<uuid>`

Rules:
- Only return items where:
  - status matches
  - `customers.valid=true`

Response:
```json
{ "items": [ { "id":"...", "customer_id":"...", "order_number":"O-0001", "status":"received", "created_at":"..." } ] }
```

### Randomize / seed

- `POST /api/randomize`

Creates additional random **valid** master data and associated movement data in initial statuses.

Response:
```json
{ "ok": true, "created": { "products": 3, "customers": 3, "batches": 6, "serial_instances": 6, "customer_orders": 6 } }
```

### Patch validity

- `PATCH /api/products/:id`

Body:
```json
{ "valid": true }
```

- `PATCH /api/customers/:id`

Body:
```json
{ "valid": false }
```

Response:
```json
{ "ok": true }
```

### Patch movement status

- `PATCH /api/batches/:id/status`
- `PATCH /api/serial-instances/:id/status`
- `PATCH /api/customer-orders/:id/status`

Body:
```json
{ "status": "produced" }
```

Rules:
- Enforce monotonic forward transitions only
- 409 on invalid transition

Response:
```json
{ "ok": true }
```
