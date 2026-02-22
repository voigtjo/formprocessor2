# ERP Simulator – Tests (Current P0)

## Unit tests (erp-sim)

Location: `erp-sim/src/routes/*.test.ts`

Current key scenarios:
- `erp-sim/src/routes/health.test.ts`
  - `/health` returns `{ ok: true }`
- `erp-sim/src/routes/api.test.ts`
  - products `valid=true` filtering + sorting
  - batches gating behavior (invalid/wrong-type/invalid-product)
  - basic route wiring via Fastify inject

## Cross-service E2E smoke (root tests workspace)

Location: `tests/e2e/smoke.test.ts`

Covers:
- ERP-Sim `/health`
- ERP-Sim `/api/products?valid=true` non-empty
- app + ERP connectivity basics

Prerequisite: both services running and seeded DB.
