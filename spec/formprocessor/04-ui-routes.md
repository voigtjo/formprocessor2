# FormProcessor – UI & API Routes (P0)

Base: `http://localhost:<FP_PORT>`

## Server-side rendered UI (EJS + HTMX)

### Pages

- `GET /` → redirect to `/templates`

#### Templates
- `GET /templates` – list templates
- `GET /templates/new` – new template form
- `POST /templates` – create template (JSON)
- `GET /templates/:id` – template detail (JSON editor + preview)
- `POST /templates/:id` – update template JSON
- `POST /templates/:id/delete` – delete

Preview:
- `GET /templates/:id/preview` – renders a preview form based on template (no persistence)

#### Documents
- `GET /documents` – list documents
- `GET /documents/new?template_id=<id>` – start document wizard (lookups)
- `POST /documents` – create document instance
- `GET /documents/:id` – document detail (form + workflow buttons)
- `POST /documents/:id/save` – save editable fields
- `POST /documents/:id/action/:actionKey` – execute workflow action and persist changes

## JSON endpoints (used by HTMX)

- `GET /api/templates` → `{ items: [...] }`
- `GET /api/templates/:id` → `{ item: ... }`
- `GET /api/documents` → `{ items: [...] }`
- `GET /api/documents/:id` → `{ item: ... }`

Lookup proxy:
- `GET /api/lookup?template_id=<id>&field=<fieldKey>&document_id=<optional>`
  - resolves endpoint from template field lookup config
  - calls ERP-Sim and returns `{ items: [...] }`

P0: SSR pages can call JSON endpoints directly (internal function call), but HTTP separation is acceptable.
