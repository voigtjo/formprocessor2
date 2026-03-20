# tests

Small smoke and E2E-preparation layer for the Core App.

## V1 collaboration add-ons

Notifications / "Email":
- V1 currently uses a local Dev Outbox, not SMTP delivery.
- Notification files are written to `app/var/notifications`.
- Reference users:
  - `alice@example.local`
  - `bob@example.local`

Audit Trail:
- The `Audit Trail / History` section on the document detail page is the official V1 document audit trail.

Attachments:
- Files are stored locally under `app/var/attachments/<tenant>/<documentId>/...`
- In the seeded reference setup the tenant is `default`.

## Smoke matrix

The current V1 smoke focus is:

1. Templates are visible
2. A document can be created from a published template
3. The document detail page shows the working context
4. Attachments are visible in the document context
5. Journal data is visible in the document context
6. Audit history is visible in the document context
7. Template detail shows the document table view

## Automated layers

`app/`:
- route/unit/UI-near tests for the individual core features

`tests/`:
- cross-surface smoke tests
- currently still inject-based, but structured as the preparation layer for later browser E2E

Important files:
- [tests/e2e/core-v1-smoke.test.ts](/Users/jvoigt/Projects/_formapps/formprocessor2/tests/e2e/core-v1-smoke.test.ts)
- [tests/e2e/smoke.test.ts](/Users/jvoigt/Projects/_formapps/formprocessor2/tests/e2e/smoke.test.ts)
- [tests/e2e/golden-path.test.ts](/Users/jvoigt/Projects/_formapps/formprocessor2/tests/e2e/golden-path.test.ts)

## Run automated smoke checks

Core smoke only:

```bash
cd /Users/jvoigt/Projects/_formapps/formprocessor2/tests
npm test -- --run tests/e2e/core-v1-smoke.test.ts
```

Or via package script:

```bash
cd /Users/jvoigt/Projects/_formapps/formprocessor2/tests
npm run test:core-smoke
```

All tests workspace smoke:

```bash
cd /Users/jvoigt/Projects/_formapps/formprocessor2/tests
npm test
```

## Manual smoke flow

Prerequisites:

```bash
cd /Users/jvoigt/Projects/_formapps/formprocessor2/app
npm run db:push
npm run db:rebuild:reference
npm run dev
```

Open these pages:

1. `/templates`
2. `/documents/new`
3. `/templates/:id` for `evidence-basic`
4. `/templates/:id` for `production-batch`
5. the seeded `evidence-basic` document
6. the seeded `production-batch` document
7. the seeded `evidence-product-check` document

What should be visible:

1. `evidence-basic`, `evidence-product-check`, `production-batch`, `customer-order-test`
2. document creation from a published template works
3. document detail shows:
   - work summary
   - workflow actions
   - form actions
   - assignments
   - attachments
   - history
4. `evidence-basic` shows richer controls, journal rows, a seeded image attachment and visible audit history
5. `production-batch` shows lookup-related summary data, batch number, journal rows, a seeded file attachment and approved history
6. `evidence-product-check` stays ready for a manual attachment upload path
7. template detail shows document table columns and document rows
8. after assigning/submitting/approving in the UI, new notification JSON files appear in `app/var/notifications`
9. the document detail page labels `Audit Trail / History` explicitly as the V1 audit trail

## E2E status

There is now a small E2E-ready base:
- seed/reference-template aware
- V1-core focused
- still inject-based for speed and stability

The next natural step is a small browser runner on top of the same stable smoke matrix.
