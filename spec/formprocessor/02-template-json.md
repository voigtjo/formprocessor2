# FormProcessor – Template JSON Contract

This file defines the current P0 contract and planned extensions.

## Top-level

`template_json` must include:

```json
{
  "fields": {},
  "layout": [],
  "workflow": { "initial": "...", "states": {} },
  "controls": {},
  "actions": {}
}
```

Minimal validation (current):
- `fields`: object
- `layout`: array
- `workflow.initial`: string
- `workflow.states`: object
- `controls`: object
- `actions`: object

## fields

`fields` is a map by `fieldKey`.

Supported/target kinds:
- `editable` (user input)
- `lookup` (ERP-backed choices)
- `system` (computed/system value)
- `workflow` (planned: process-controlled fields such as status)

Common field props in use:
- `label`
- `multiline` (editable)

Lookup source compatibility:
- `source.path` + `source.query`
- optional value/label mapping via either:
  - `valueField` / `labelField`
  - `valueKey` / `labelKey`
- legacy-compatible `lookup.endpoint` is supported.

## layout nodes (Renderer v2)

`layout` is an array of nodes rendered recursively.

Supported now:
- `h1`: `{ "type": "h1", "text": "..." }`
- `h2`: `{ "type": "h2", "text": "..." }`
- `text`: `{ "type": "text", "text": "..." }`
- `hint`: `{ "type": "hint", "text": "..." }`
- `divider`: `{ "type": "divider" }`
- `field`: `{ "type": "field", "key": "fieldKey" }`
- `group`: `{ "type": "group", "title": "...", "children": [...] }`
- `row`: `{ "type": "row", "children": [...] }`
- `col`: `{ "type": "col", "width": 1, "children": [...] }`

Planned extension:
- `button`: `{ "type": "button", "key": "reloadCustomers", "label": "Reload" }`
  - `key` refers to a control/action key
  - used for in-form actions (e.g. load/reload lookup options)

Behavior:
- unknown node types are ignored safely
- non-production may render a small warning
- legacy section layout remains accepted as fallback

## workflow

```json
{
  "initial": "Assigned",
  "states": {
    "Assigned": {
      "editable": ["..."],
      "readonly": ["..."],
      "buttons": ["assign", "start", "save"]
    }
  }
}
```

- `editable[]`: fields that can be changed
- `readonly[]`: fields shown read-only
- `buttons[]`: workflow/process button keys for current state

## controls

Maps button key -> action key:

```json
{
  "save": { "label": "Save", "action": "save" },
  "submit": { "label": "Submit", "action": "submit_case" }
}
```

This mapping is shared by workflow bar buttons and planned layout button nodes.

## actions

Two supported definition forms:

1. Declarative/composite:
```json
{ "type": "composite", "steps": [ ... ] }
```

2. Macro action:
```json
{ "type": "macro", "name": "assign", "params": {} }
```

Planned macro names include:
- `assign`, `start`, `save`, `submit`, `approve`, `reject`

Interpolation tokens usable in action path/body strings:
- `{{doc.*}}`
- `{{data.*}}`
- `{{external.*}}`
- `{{snapshot.*}}`
