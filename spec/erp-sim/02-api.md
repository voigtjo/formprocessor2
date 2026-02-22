# ERP Simulator – HTTP API (P0)

Base: `http://localhost:<ERP_SIM_PORT>` (default `3001`)

## Conventions

- JSON API
- `200` success
- `400` invalid query/body
- `404` missing entity
- `409` invalid transition

## Service routes

- `GET /` -> `{ "ok": true, "service": "erp-sim" }`
- `GET /health` -> `{ "ok": true }`

## Master lists

- `GET /api/products?valid=true|false`
  - sorted by name
  - response items include: `id,name,valid,product_type`

- `GET /api/customers?valid=true|false`
  - sorted by name
  - response items include: `id,name,valid`

## Movement lists

- `GET /api/batches?product_id=<uuid>&status=<ordered|produced|validated>`
  - gated by product validity + `product_type=batch`

- `GET /api/serial-instances?product_id=<uuid>&status=<ordered|produced|validated>`
  - gated by product validity + `product_type=serial`

- `GET /api/customer-orders?customer_id=<uuid>&status=<received|offer_created|completed>`
  - gated by customer validity

## Create customer order

- `POST /api/customer-orders`
- body (optional): `{ "customer_id": "<uuid>" }`

Behavior:
- creates one `customer_orders` row with:
  - `status = "received"`
  - generated `order_number` (`O-...`)
- if `customer_id` omitted, uses first valid customer as fallback
- returns created order object:

```json
{
  "id": "...",
  "customer_id": "...",
  "order_number": "O-ABC123",
  "status": "received",
  "created_at": "..."
}
```

## Randomize

- `POST /api/randomize`
  - creates additional valid master + movement data

## Patch validity

- `PATCH /api/products/:id` body `{ "valid": boolean }`
- `PATCH /api/customers/:id` body `{ "valid": boolean }`

## Patch movement status (monotonic)

- `PATCH /api/batches/:id/status`
- `PATCH /api/serial-instances/:id/status`
- `PATCH /api/customer-orders/:id/status`

Body:

```json
{ "status": "..." }
```

Transitions:
- movement: `ordered -> produced -> validated`
- customer orders: `received -> offer_created -> completed`
