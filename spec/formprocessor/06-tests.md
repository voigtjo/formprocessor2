# FormProcessor – Tests (P0)

## Unit/component tests (next to code)

- Template validation (Zod) for required top-level fields
- Workflow evaluation:
  - visible/readonly per status
  - button availability per status
- Action engine:
  - composite execution order
  - templating `{{external.*}}`

## E2E tests (root /tests)

- Create a template via API
- Create a document from template (start)
- Resolve lookups via ERP-Sim
- Execute an action that triggers ERP-Sim PATCH and updates document status
