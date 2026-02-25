# formprocessor2 – Overview

This repo contains two services and shared HTTP smoke tests.

## Services

- `erp-sim/`: ERP Simulator (master + movement data, status APIs)
- `app/`: FormProcessor (generic template-driven process UI)
- `tests/`: cross-service smoke tests

## Current milestone (P0 implemented)

- Node.js + TypeScript + Fastify
- Postgres + Drizzle + Zod
- App UI with EJS + HTMX
- Template CRUD with raw JSON editor
- Node-based renderer v2 (SSR)
- Workflow buttons -> action engine
- ERP lookup integration and customer-order creation hook on document start

## Architecture baseline

- Templates define:
  - `fields` (data contract)
  - `layout` (render contract)
  - `workflow` (state + editable/readonly + buttons)
  - `controls` (UI button -> action key)
  - `actions` (declarative steps and macro actions)
- Documents store:
  - `status`
  - `data_json`
  - `external_refs_json`
  - `snapshots_json`

## Next planned slices

1. Workflow-controlled process field(s), including canonical statuses:
   - `Assigned`, `Started`, `Submitted`, `Approved`, `Rejected`
2. In-layout buttons (`layout` nodes) for lookup load/reload interactions
   - e.g. customers/products/batches/order numbers
3. Workflow/process bar buttons
   - `Assign`, `Start`, `Save`, `Submit`, `Approve`, `Reject`
4. TypeScript macro action registry
   - named macros (assign/start/submit/approve/reject)
   - can call APIs and define state transitions

Specs under `spec/` are source of truth going forward.
