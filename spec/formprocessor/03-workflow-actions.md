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

## Action definition types (transition model)

The platform is moving from macro-centric execution to domain actions:
- **Template actions**: field/value logic in template JSON
- **System actions**: fixed in-code platform actions (status, validation, assignment, archive/save)
- **API actions**: template action step references centrally managed APIs
- **Legacy macros**: still supported for backward compatibility during migration

Primary action types now:
- `system`
- `api`
- `composite`
- `macro` (legacy bridge)

### Declarative

- single step object, or
- `{ "steps": [...] }`, or
- `{ "type": "composite", "steps": [...] }`

Supported step types:
- `setStatus` (`to` or `status`)
- `system` (`action`, e.g. `setStatus`, `showMessage`, `requireValue`)
- `setField` (`key`, `value`)
- `requireField` (`key`, optional `message`) for friendly precondition checks
- `api` (`apiRef`, optional `requestMapping`, optional `responseMapping`, optional `successMessage`) – preferred for form-centric API actions
- `callApi` (`apiRef`, optional `method`, optional `body`) – preferred integration path
- `callExternal` (`service`, `method`, `path`, `body`)
  - legacy integration path (still supported)

UI button restrictions (unchanged for compatibility):
- UI button source may execute UI-safe action definitions (`macro`, `api`, `callApi`)
- UI button source must not execute process step types (`setStatus`, `setField`, `callExternal`, ...)
- violations return `400` with message `UI button cannot execute process action`

Status source-of-truth behavior:
- `setStatus` updates process status in `fp_documents.status` only
- workflow status must not be mirrored to `data_json.status` or `external_refs_json.status`
- UI workflow field `status` displays `doc.status` (not `data_json.status`)

### API catalog execution

`callApi` resolves `apiRef` from a central catalog (current P0 implementation is in-code registry, later DB/UI-managed).

Current catalog includes example refs:
- `api:erp/createBatch@1`
- `api:erp/createCustomerOrder@1`

Execution semantics:
1. Resolve and execute `system` actions.
2. Resolve and execute `api` actions.
3. Resolve `composite` action steps.
4. Resolve `macro` only as legacy fallback path.

Step execution semantics:
1. Resolve `apiRef` in central catalog.
2. Resolve base URL from service registry.
3. Interpolate request data from doc/data/external/snapshot.
4. Execute HTTP request and fail with clear error on non-2xx.

### MacroRef execution (legacy bridge)

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
3. Engine executes DB JSON macro when `kind=json` and `definition_json` is present.
4. Built-in registry handler is fallback (`kind=builtin` or missing JSON definition).
5. If catalog entry is missing/disabled or runtime implementation is missing:
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

## callExternal rules (legacy bridge)

- service resolution uses central service registry (`erp`, `erp-sim` currently map to ERP base URL)
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
