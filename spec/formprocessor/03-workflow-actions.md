# FormProcessor – Workflow & Actions (P0)

## Workflow engine (P0)

- A template defines `workflow.initial` and `workflow.states`.
- A document has `status`.
- The UI renders buttons listed in `workflow.states[status].buttons`.
- Field rules are evaluated per field:
  - `visible` (default true)
  - `readonly` (default false)

## Action engine (P0)

Actions are executed by name (from control/button mapping).

### Action types

#### noop
Does nothing (used for Save because persistence is handled by API).

#### composite
Executes steps in order.

#### setStatus
- updates document status

#### setField
- sets a value into `data_json` (or in P0 also allow writing into `snapshots_json`)

#### callExternal
- performs an HTTP request to ERP-Sim
- supports templating:
  - `{{external.<key>}}` resolves from `external_refs_json`.

### Error handling

- If any step fails, the action fails and the document is not persisted (transactional behavior in FormProcessor service).
- External call failures return 502 with the upstream status/body included (sanitized).
