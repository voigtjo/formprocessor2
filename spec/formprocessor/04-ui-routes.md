# FormProcessor – UI Routes (P0)

Base: `http://localhost:<FP_PORT>` (default `3000`)

UI is server-rendered with EJS + HTMX (no React).

## Health
- `GET /health` -> `{ "ok": true }`

## Root
- `GET /` -> redirect to `/templates`

## Templates
- `GET /templates`
  - lists active templates
- `GET /templates/new`
  - create form (metadata + raw `template_json` textarea)
- `POST /templates`
  - create template
- `GET /templates/:id/edit`
  - edit metadata + raw `template_json`
- `POST /templates/:id`
  - update template
- `GET /templates/:id/preview`
  - preview form rendering based on layout nodes

## Documents
- `GET /documents`
  - list recent documents (latest first) with status/template/snapshot preview
- `GET /documents/new?templateId=<uuid>`
  - start form from template
- `POST /documents`
  - create document:
    - `status = workflow.initial`
    - stores editable values in `data_json`
    - stores lookup IDs in `external_refs_json`
    - stores lookup labels in `snapshots_json`
    - if `fields.erp_customer_order_id` is a `system` field, app calls ERP-Sim `POST /api/customer-orders` and stores:
      - `external_refs_json.customer_order_id`
      - `snapshots_json.customer_order_id`
      - `data_json.erp_customer_order_id`
- `GET /documents/:id`
  - document detail, rendered via node-based layout renderer
- `POST /documents/:id/save`
  - saves only editable fields for current workflow state
- `POST /documents/:id/action/:controlKey`
  - executes action engine using control -> action mapping

## HTMX lookup endpoint
- `GET /api/lookup?templateId=<uuid>&fieldKey=<fieldKey>[&lookup:<depField>=<id>]`
  - resolves lookup source from template field
  - calls ERP-Sim and returns HTML `<option>` list (not JSON)
  - never hard-fails with 500 for expected lookup errors; returns fallback option text
