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
- `GET /documents/new`
  - without `templateId`: shows wizard template dropdown (published templates only)
  - with `templateId`: shows document form for selected template
- `POST /documents`
  - rejects non-published templates with `400`
- `GET /documents/:id`
- `POST /documents/:id/save`
- `POST /documents/:id/action/:controlKey`
  - supports `?source=ui` for layout button requests

## Workplaces

- `GET /workspaces/me`
  - current user workspace
  - shows memberships and open tasks (`assignee_user_id` or `reviewer_user_id`, status != approved)
- `GET /workspaces/groups/:groupId`
  - group workplace (requires membership in group; otherwise `403`)
  - shows assigned templates and group documents (created/template/status/assignee/reviewer)

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
- document create requires `templateId`; missing/invalid templateId returns `400`
- document create resolves template assignment and sets `fp_documents.group_id`:
  - first assigned group is used (P0)
  - if template is unassigned, `group_id` remains `null` and UI shows `Unassigned template`
- if `erp_customer_order_id` system field exists, app creates ERP customer order and stores its refs/snapshot
- action errors re-render detail with message (no expected hard 500)
- workflow `status` field is display-only/read-only and renders from `fp_documents.status` as the canonical status value
- `source=ui` action requests are restricted to UI-safe actions (e.g. `reloadLookup` macro), process steps return `400`

## UI design classes (P0 mini design system)

Global stylesheet: `/public/styles.css`

- layout: `.container`, `.page-header`, `.card`
- layout grid: `.row`, `.col`, `.col-6`
- actions: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`
- badges: `.badge`, `.badge-status`
- text/helper: `.muted`
