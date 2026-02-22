# formprocessor2

Two services + shared E2E tests.

## Setup

- Create two Postgres databases:
  - `erp_sim`
  - `formprocessor2`

- Export env vars:
  - `export ERP_DATABASE_URL=postgres://.../erp_sim`
  - `export ERP_SIM_PORT=3001` (optional)
  - `export FP_DATABASE_URL=postgres://.../formprocessor2`

## Install

From repo root:

```bash
npm install
```

## Run (dev)

```bash
npm run dev:erp
npm run dev:app
```

Default ports:
- FormProcessor: 4000
- ERP-Sim: 3001

## Tests

```bash
npm test
```

E2E tests require both services running (see `tests/README.md`).
