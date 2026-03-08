# FormProcessor – Workflow & Action Engine

## Canonical process statuses

For process field `status` (planned canonical set):
- `Assigned`
- `Started`
- `Submitted`
- `Approved`
- `Rejected`

Workflow states may use the same strings; this is the recommended convention.

## Button resolution

1. Determine current state: `workflow.states[document.status]`
2. Read allowed button keys: `state.buttons[]`
3. Resolve each via `controls[buttonKey].action` to `actionKey`
4. Execute `actions[actionKey]`

Workflow bar buttons are `process` buttons and can execute normal process actions.
Layout buttons are `ui` buttons and are restricted to UI-safe actions only.

## Action definition types

### Declarative

- single step object, or
- `{ "steps": [...] }`, or
- `{ "type": "composite", "steps": [...] }`

Supported step types:
- `setStatus` (`to` or `status`)
- `setField` (`key`, `value`)
- `requireField` (`key`, optional `message`) for friendly precondition checks
- `callExternal` (`service`, `method`, `path`, `body`)

UI button restrictions:
- UI button source may execute only whitelist actions (e.g. macro `reloadLookup`, optional `noop`/`showToast`)
- UI button source must not execute `setStatus`, `setField`, `callExternal` or other process actions
- violations return `400` with message `UI button cannot execute process action`

Status source-of-truth behavior:
- `setStatus` updates process status in `fp_documents.status` only
- workflow status must not be mirrored to `data_json.status` or `external_refs_json.status`
- UI workflow field `status` displays `doc.status` (not `data_json.status`)

### MacroRef execution

```json
{ "type": "macro", "ref": "macro:erp/createBatch@1", "params": {} }
```

MacroRef syntax:
- `macro:<namespace>/<name>@<version>`
- example: `macro:erp/createBatch@1`

Execution semantics:
1. Action step is resolved by `ref` (legacy `name` may be mapped for backward compatibility).
2. Engine checks DB catalog table `fp_macros`:
   - `ref` must exist
   - `is_enabled` must be `true`
3. Engine checks in-code macro registry implementation for the same ref.
4. If catalog entry is missing/disabled or runtime implementation is missing:
   - fail gracefully with clear error message
   - no partial document update
   - no unhandled 500 crash in UI flow

## Interpolation

Supported in string path/body values (recursive in objects/arrays):
- `{{doc.id}}`, `{{doc.status}}`
- `{{data.<key>}}`
- `{{external.<key>}}`
- `{{snapshot.<key>}}`

Missing interpolation values must fail with a clear error (no crash).

## callExternal rules

- service `erp-sim` targets `ERP_SIM_BASE_URL`
- JSON request/response conventions
- non-2xx must fail action with clear message (include status)

## Transactionality and errors

Execution semantics:
1. load document + template
2. execute action steps sequentially in memory
3. persist document changes only if all steps succeed

On failure:
- no partial document update
- render detail page with error message
- avoid unhandled 500 for expected business/action errors
