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
  "actions": {},
  "permissions": {}
}
```

Minimal validation (current):
- `fields`: object
- `layout`: array
- `workflow.initial`: string
- `workflow.states`: object
- `controls`: object
- `actions`: object
- `permissions`: optional object

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

`button` node (supported):
- `{ "type": "button", "key": "reloadCustomers", "label": "Reload", "kind": "ui" }`
- `kind` is optional and defaults to `"ui"` for backward compatibility
- `kind: "ui"` buttons are UI helper buttons (lookup reload etc.)
- `kind: "process"` is reserved/process-like and must not execute process steps when triggered as layout UI button source
- `key` refers to a control/action key

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

This mapping is shared by workflow bar buttons and layout button nodes.

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

## permissions (P0 RBAC)

Optional action permission map:

```json
{
  "permissions": {
    "actions": {
      "approve": { "requires": ["execute"] },
      "approveAction": { "requires": ["execute"] }
    }
  }
}
```

Resolution order for required rights:
1. `permissions.actions[controlKey]`
2. `permissions.actions[actionKey]`
3. default allow

Runtime enforcement:
- rights are checked against the active user membership in `document.group_id`
- if `document.group_id` is `null`, action is allowed in P0 (no group-scoped check)
- failing checks return `403` with a clear forbidden message

Supported requirement values:
- `read`
- `write`
- `execute`

Rights mapping to group membership rights string:
- `read` -> `r`
- `write` -> `w`
- `execute` -> `x`
