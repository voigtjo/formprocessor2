# FormProcessor – Template JSON (P0)

Template JSON is the only place where form logic lives.

## Top-level shape

```json
{
  "key": "customer-order-process",
  "name": "Customer Order Process",
  "version": 1,
  "erp": { "baseUrl": "http://localhost:4001" },
  "fields": { /* see below */ },
  "layout": { /* see below */ },
  "workflow": { /* see below */ },
  "controls": { /* see below */ },
  "actions": { /* see below */ }
}
```

## fields

Fields are keyed by fieldKey.

```json
{
  "product_id": {
    "kind": "lookup",
    "label": "Product",
    "required": true,
    "lookup": {
      "source": "erp",
      "endpoint": "/api/products?valid=true",
      "valueField": "id",
      "labelField": "name",
      "snapshot": { "target": "product_name", "from": "name" }
    }
  },
  "batch_id": {
    "kind": "lookup",
    "label": "Batch",
    "required": true,
    "lookup": {
      "source": "erp",
      "endpoint": "/api/batches?status=ordered&product_id={{external.product_id}}",
      "valueField": "id",
      "labelField": "batch_number",
      "snapshot": { "target": "batch_number", "from": "batch_number" }
    }
  },
  "comment": {
    "kind": "editable",
    "label": "Comment",
    "type": "string",
    "multiline": true
  },
  "created_at": {
    "kind": "system",
    "label": "Created",
    "type": "datetime"
  }
}
```

Notes:
- For lookup endpoints, the renderer replaces `{{external.<key>}}` with `external_refs_json.<key>`.
- Lookup selection stores:
  - selected `id` into `external_refs_json[fieldKey]`
  - snapshot values into `snapshots_json[snapshot.target]`

## layout

Minimal P0 layout is a list of sections and fields.

```json
{
  "sections": [
    { "title": "Start", "fields": ["product_id", "batch_id"] },
    { "title": "Details", "fields": ["comment"] }
  ]
}
```

## workflow

```json
{
  "initial": "draft",
  "states": {
    "draft": {
      "label": "Draft",
      "fieldRules": {
        "product_id": { "visible": true, "readonly": false },
        "batch_id":   { "visible": true, "readonly": false },
        "comment":    { "visible": true, "readonly": false }
      },
      "buttons": ["save", "submit"]
    },
    "submitted": {
      "label": "Submitted",
      "fieldRules": {
        "product_id": { "visible": true, "readonly": true },
        "batch_id":   { "visible": true, "readonly": true },
        "comment":    { "visible": true, "readonly": true }
      },
      "buttons": ["markProduced"]
    }
  }
}
```

## controls (buttons)

```json
{
  "save": { "label": "Save", "action": "save" },
  "submit": { "label": "Submit", "action": "toSubmitted" },
  "markProduced": { "label": "Mark Produced", "action": "batchToProduced" }
}
```

## actions

Action kinds:
- `setStatus`
- `setField`
- `callExternal`

```json
{
  "save": {
    "type": "noop"
  },
  "toSubmitted": {
    "type": "composite",
    "steps": [
      { "type": "setStatus", "status": "submitted" }
    ]
  },
  "batchToProduced": {
    "type": "composite",
    "steps": [
      {
        "type": "callExternal",
        "service": "erp",
        "method": "PATCH",
        "path": "/api/batches/{{external.batch_id}}/status",
        "body": { "status": "produced" }
      },
      { "type": "setStatus", "status": "produced" }
    ]
  }
}
```
