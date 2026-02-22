# ERP Simulator – Seed (P0)

## Goal

On startup (or via a script) ERP-Sim should ensure a minimal dataset exists:

- 10 products (mix of `batch` and `serial`, mix of `valid=true/false`)
- 10 customers (mix valid/invalid)
- For each **valid** product:
  - if product_type=batch → create multiple `batches` with status `ordered`
  - if product_type=serial → create multiple `serial_instances` with status `ordered`
- For each **valid** customer:
  - create multiple `customer_orders` with status `received`

## Determinism

Seed does not need to be strictly deterministic, but should be stable enough for tests:

- Use fixed prefixes:
  - products: `P-<n>`
  - customers: `C-<n>`
  - batch_number: `B-<productIndex>-<n>`
  - serial_number: `S-<productIndex>-<n>`
  - order_number: `O-<customerIndex>-<n>`

## /api/randomize

Creates additional **valid** masters + movements in initial status.

Suggested defaults (per call):
- 3 products + 3 customers
- For each created product: 2 movements
- For each created customer: 2 orders
