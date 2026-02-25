# FormProcessor – UI & Endpoint Routes

Base: `http://localhost:<FP_PORT>` (default `3000`)

UI stack: EJS + HTMX (SSR).

## Core pages

- `GET /` -> redirect `/templates`
- `GET /health` -> `{ "ok": true }`

## Template pages

- `GET /templates`
- `GET /templates/new`
- `POST /templates`
- `GET /templates/:id/edit`
- `POST /templates/:id`
- `GET /templates/:id/preview`

## Document pages

- `GET /documents`
- `GET /documents/new?templateId=<uuid>`
- `POST /documents`
- `GET /documents/:id`
- `POST /documents/:id/save`
- `POST /documents/:id/action/:controlKey`

## Lookup endpoint

- `GET /api/lookup?templateId=<uuid>&fieldKey=<fieldKey>[&lookup:<depField>=<id>]`
- returns HTML `<option>` entries for HTMX select replacement

## Button execution model

Two button surfaces (same action engine):
1. Workflow/process bar buttons (`workflow.states[state].buttons`)
2. Planned in-layout buttons (`layout` node `type: "button"`)

Both resolve through `controls` -> `actions` and execute via the same action route semantics.

## Current P0 behavior notes

- document create stores `data_json`, `external_refs_json`, `snapshots_json`
- if `erp_customer_order_id` system field exists, app creates ERP customer order and stores its refs/snapshot
- action errors re-render detail with message (no expected hard 500)
