# FormProcessor – Tests (Current P0)

## Unit tests (app)

Location: `app/src/**/*.test.ts`

Current key scenarios:
- `app/src/routes/health.test.ts`
  - `/health` returns `{ ok: true }`
- `app/src/lookup.test.ts`
  - lookup URL building, query normalization, option mapping
- `app/src/routes/ui.save.test.ts`
  - save updates only allowed editable fields
- `app/src/actions.test.ts`
  - interpolation
  - action execution order / `setStatus` + `setField`
  - clear failure on missing interpolation data
- `app/src/routes/ui.create.test.ts`
  - document creation enrichment sets `external.customer_order_id`
- `app/src/render/layout.test.ts`
  - Renderer v2 structure rendering (`group/row/field`)

## Cross-service E2E smoke (root tests workspace)

Location: `tests/e2e/smoke.test.ts`

Covers running services over HTTP:
- ERP-Sim health + valid products list
- App health + templates page
- optional `/documents/new` reachability via parsed templateId

Prerequisite: services already running.
