# ERP Simulator – Tests (P0)

## Unit tests (next to code)

- `src/routes/*.test.ts`:
  - list endpoints filter correctly by `valid` and `status`
  - invalid transition returns 409

## E2E tests (root /tests)

- `tests/e2e/smoke.test.ts`:
  - `GET /health` on both services returns `{ok:true}`
  - basic ERP list calls return `200`

## Test data strategy

E2E assumes ERP-Sim is seeded on startup.

For transition tests, E2E may:

1) fetch an `ordered` movement item
2) patch to `produced`
3) patch to `validated`
