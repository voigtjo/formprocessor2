# FormProcessor – Template JSON (P0)

This document describes the currently implemented P0 `template_json` contract used by the app.

## Top-level shape

`template_json` is stored in `fp_templates.template_json` and must contain:

```json
{
  "fields": {},
  "layout": [],
  "workflow": {
    "initial": "received",
    "states": {}
  },
  "controls": {},
  "actions": {}
}
```

Validation in app (P0) is intentionally minimal:
- `fields`: object
- `layout`: array
- `workflow.initial`: string
- `workflow.states`: object
- `controls`: object
- `actions`: object

## Fields

`fields` is a map keyed by `fieldKey`.

Supported field kinds in P0:
- `lookup`
- `editable`
- `system`

Common field properties used by renderer:
- `label` (optional)
- `multiline` (editable only, optional)

Lookup source forms accepted:
- `source` style:
  - `source.path`
  - `source.query`
  - label/value key config via either
    - `valueField`/`labelField`, or
    - `valueKey`/`labelKey`
- `lookup.endpoint` style (legacy-compatible)

Lookup values are stored on document creation as:
- selected ID: `external_refs_json[fieldKey]`
- selected label snapshot: `snapshots_json[fieldKey]`

## Layout (Renderer v2)

`layout` is an array of nodes rendered recursively.

Supported node types now:
- `h1`: `{ "type": "h1", "text": "..." }`
- `h2`: `{ "type": "h2", "text": "..." }`
- `text`: `{ "type": "text", "text": "..." }`
- `hint`: `{ "type": "hint", "text": "..." }`
- `divider`: `{ "type": "divider" }`
- `field`: `{ "type": "field", "key": "fieldKey" }`
- `group`: `{ "type": "group", "title": "...", "children": [...] }`
- `row`: `{ "type": "row", "children": [...] }`
- `col`: `{ "type": "col", "width": 1, "children": [...] }`

Behavior:
- Unknown node types are ignored safely.
- In non-production (`NODE_ENV != production`), unknown nodes render a small muted warning.
- Legacy layout support remains:
  - `{ "sections": [{ "title": "...", "fields": ["..."] }] }`
  - Fallback to all field keys if layout is missing/empty.

## Workflow

```json
{
  "initial": "received",
  "states": {
    "received": {
      "editable": ["comment"],
      "readonly": ["erp_customer_order_id"],
      "buttons": ["complete"]
    }
  }
}
```

- Document starts in `workflow.initial`.
- Detail/save uses `states[document.status].editable` and `readonly`.
- Action buttons shown from `states[document.status].buttons`.

## Controls

`controls` maps UI button key to action key:

```json
{
  "complete": { "label": "Complete", "action": "complete_process" }
}
```

## Actions

`actions` maps action key to an action definition (see `03-workflow-actions.md`).
