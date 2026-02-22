# formprocessor2 – Overview (P0)

This repo contains two Node.js/TypeScript services plus cross-service E2E tests.

## Structure

- `spec/` – source of truth (requirements + contracts)
- `erp-sim/` – ERP Simulator (external system simulation)
- `app/` – FormProcessor (generic process-form system)
- `tests/` – integration/E2E tests hitting both services via HTTP

## Tech (fixed)

- Node.js + TypeScript
- Fastify
- Postgres
- Drizzle ORM
- Zod
- EJS + HTMX (**FormProcessor UI only**)

## Databases

Two independent Postgres databases:

- `erp_sim` used by `erp-sim`
- `formprocessor2` used by `app`

Local env vars:

- `ERP_DATABASE_URL=postgres://.../erp_sim`
- `FP_DATABASE_URL=postgres://.../formprocessor2`

## Test placement

- Unit/component tests live next to code:
  - `erp-sim/src/**/*.test.ts`
  - `app/src/**/*.test.ts`
- Cross-service tests live in `tests/`:
  - `tests/e2e/*` uses HTTP to both services

## Iteration slice

Spec → Implementation → Tests → Smoke-test.
