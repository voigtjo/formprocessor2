# ERP Simulator – API Contract (P0)

Base: `http://localhost:<ERP_SIM_PORT>` (default `3001`)

## Service routes

- `GET /` -> `{ "ok": true, "service": "erp-sim" }`
- `GET /health` -> `{ "ok": true }`

## Master data

- `GET /api/products?valid=true|false`
  - sorted by name
  - fields: `id,name,valid,product_type`

- `GET /api/customers?valid=true|false`
  - sorted by name
  - fields: `id,name,valid`

- `PATCH /api/products/:id` body `{ "valid": boolean }`
- `PATCH /api/customers/:id` body `{ "valid": boolean }`

## Movement data

- `GET /api/batches?product_id=<uuid>&status=<ordered|produced|validated>`
  - gated by product valid + type `batch`

- `GET /api/serial-instances?product_id=<uuid>&status=<ordered|produced|validated>`
  - gated by product valid + type `serial`

- `GET /api/customer-orders?customer_id=<uuid>&status=<received|offer_created|completed>`
  - gated by customer valid

- `PATCH /api/batches/:id/status`
- `PATCH /api/serial-instances/:id/status`
- `PATCH /api/customer-orders/:id/status`

Transition constraints:
- movement: `ordered -> produced -> validated`
- customer orders: `received -> offer_created -> completed`

## Create customer order (implemented)

- `POST /api/customer-orders`
- optional body: `{ "customer_id": "<uuid>" }`

Behavior:
- creates one `customer_orders` row with:
  - `status: "received"`
  - generated `order_number` (`O-...`)
- if `customer_id` omitted, service uses first valid customer as fallback
- returns created order object (`id`, `customer_id`, `order_number`, `status`, `created_at`)

## Randomize

- `POST /api/randomize`
  - adds additional valid masters + initial movement rows

## Status codes

- `200` success
- `400` invalid input
- `404` missing referenced entity
- `409` invalid state transition
