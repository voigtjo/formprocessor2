# FormProcessor – Domain (P0)

FormProcessor is a generic process-form system. **No form types are hardcoded.**
All behavior is defined by Template JSON.

## Core concepts

### Template
A template defines:

1) `fields` (schema)
2) `layout` (UI)
3) `controls` (buttons)
4) `workflow` (state machine)
5) `actions` (status transition + side effects + external calls)

Templates are stored as JSON and edited via a JSON editor UI (P0).

### Document (process instance)
A document is created from a template.

- `status` – current workflow state (**single source of truth** for process status)
- `group_id` – optional RBAC context of the document (derived from template assignment at create time)
- `data_json` – field values
- `external_refs_json` – IDs referencing ERP entities
- `snapshots_json` – copied display values (names/numbers) for stable display even if ERP changes

Status source-of-truth rule:
- workflow/process status is stored only in `fp_documents.status`
- `data_json.status` / `external_refs_json.status` are not authoritative and must not be written by workflow transitions
- `workflow` field `status` is display-only in UI and reads from document status

### Field kinds
- `editable` – user input stored in `data_json`
- `readonly` – derived or fixed display, may be stored in snapshots
- `system` – set by actions (e.g., timestamps, computed)
- `lookup` – selects ERP entity or movement record via ERP-Sim HTTP APIs

### Lookup behavior (P0)
- Lookup fields load options from ERP-Sim via HTTP.
- On document start, chosen lookup values are stored in:
  - `external_refs_json` (IDs)
  - `snapshots_json` (human-friendly names/numbers)

### Workflow rules (P0)
- Status controls which fields are visible and/or readonly.
- Button availability depends on current status.

### External side effects
Actions can call ERP-Sim endpoints (e.g. patch movement status).

## RBAC (P0 minimal, no login)

- Active user is selected in UI (dropdown) and stored in cookie `fp_user`.
- Templates are assigned to groups.
- Dev seed (`cd app && npm run seed`) creates default RBAC data:
  - groups `ops`, `qa`
  - users `alice`, `bob`
  - memberships in `ops`:
    - `alice` rights `rwx`
    - `bob` rights `r`
- New templates are auto-assigned to `ops` when that group exists.
- Users are members of groups with rights string:
  - `r` = read
  - `w` = write
  - `x` = execute
- Action execution is checked against the assigned template group:
  - user must be member of that group
  - required rights are resolved from `template_json.permissions.actions`
  - if no permission rule exists, action is allowed (backward compatibility)
