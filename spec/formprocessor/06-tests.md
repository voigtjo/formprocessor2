# FormProcessor – Test Strategy

## Unit/component tests (current location)

- `app/src/**/*.test.ts`

Current covered areas include:
- health route
- lookup URL/mapping behavior
- save-only-editable field merge
- action interpolation and action-step execution behavior
- document-create ERP enrichment
- renderer v2 layout structure rendering
- workplace routes (`/workspaces/me`, `/workspaces/groups/:groupId`) and membership deny path
- action-based assignee/reviewer assignment to document columns (not `data_json`)
- RBAC Test v2 workflow guards:
  - explicit actions `assign_editor` / `assign_approver`
  - `submit` blocked with friendly message when editor is missing
  - `approve` blocked with friendly message when approver is missing

## Cross-service smoke tests

- location: `tests/e2e/smoke.test.ts`
- verifies both running services over HTTP (health + basic list/pages)

## Golden-path E2E scenario (required next)

Recommended scenario to add/maintain:
1. open templates page and select template
2. start new document
3. load lookup options (customer/product/etc.)
4. create document and verify snapshots shown
5. Save via workflow button
6. run workflow transitions (Assign/Start/Submit/Approve or Reject)
7. verify external calls and final status

Prerequisite for E2E: both services running and seeded DBs.
