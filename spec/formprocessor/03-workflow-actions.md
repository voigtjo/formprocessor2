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

Both workflow bar buttons and planned in-layout `button` nodes use this same action engine.

## Action definition types

### Declarative

- single step object, or
- `{ "steps": [...] }`, or
- `{ "type": "composite", "steps": [...] }`

Supported step types:
- `setStatus` (`to` or `status`)
- `setField` (`key`, `value`)
- `callExternal` (`service`, `method`, `path`, `body`)

### Macro (planned extension)

```json
{ "type": "macro", "name": "assign", "params": {} }
```

Macro registry concept:
- TypeScript functions keyed by macro name
- invoked by the action engine
- can perform domain logic, API calls, and transitions

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
