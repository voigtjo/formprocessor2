# FormProcessor – Workflow & Actions (P0)

## Control -> Action mapping

1. UI renders buttons from `workflow.states[document.status].buttons`.
2. Each button key resolves via `controls[controlKey].action` to `actionKey`.
3. `actions[actionKey]` is loaded and executed.

If a control is not allowed in current state, or mapping is missing, UI shows a non-500 error message on document detail.

## Action definition shapes

Supported P0 forms:
- single step object (e.g. `{ "type": "setStatus", "to": "..." }`)
- object with `steps` array
- composite:

```json
{
  "type": "composite",
  "steps": [ ... ]
}
```

## Supported step types

### `setStatus`
- shape: `{ "type": "setStatus", "to": "new_status" }`
- `status` is also accepted as fallback key.
- updates in-memory doc status for later steps.

### `setField`
- shape: `{ "type": "setField", "key": "fieldKey", "value": ... }`
- writes into `data_json[key]`.
- `value` supports interpolation.

### `callExternal`
- shape:

```json
{
  "type": "callExternal",
  "service": "erp-sim",
  "method": "PATCH",
  "path": "/api/customer-orders/{{external.customer_order_id}}/status",
  "body": { "status": "completed" }
}
```

- currently only `service: "erp-sim"` is supported.
- base URL: `ERP_SIM_BASE_URL`.
- request uses JSON headers/body (when body is present).
- non-2xx responses fail the action with a clear message.

## Interpolation

Interpolation is supported in path/body strings:
- `{{doc.id}}`
- `{{doc.status}}`
- `{{data.<key>}}`
- `{{external.<key>}}`
- `{{snapshot.<key>}}`

Behavior:
- interpolation is recursive in objects/arrays.
- missing or empty interpolation value throws a clear error.
  - example: missing `external.customer_order_id` fails action cleanly.

## Transactional behavior and errors

Execution model:
1. load document + template
2. run all steps sequentially in memory
3. persist document changes only after all steps succeed

Persistence in P0 action route:
- updates `status`
- updates `data_json`
- does not mutate `external_refs_json`/`snapshots_json` during action execution

On any failure:
- no document changes are persisted
- document detail page is re-rendered with an error message
- no unhandled 500 is returned for expected action errors
