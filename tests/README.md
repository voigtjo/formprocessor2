# tests

E2E tests call both services via HTTP.

## Required env

- `FP_BASE_URL` (default: http://localhost:4000)
- `ERP_BASE_URL` (default: http://localhost:4001)

## Run

1) Start both services in separate terminals:
   - `npm run dev:app`
   - `npm run dev:erp`

2) Run e2e:
   - `npm --workspace tests test`
