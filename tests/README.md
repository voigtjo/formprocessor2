# tests

HTTP smoke tests for running `erp-sim` + `app` instances.

## Prerequisites

- Node.js 20+
- Services are already running:
  - ERP-Sim: `http://localhost:3001`
  - App: `http://localhost:3000`
- Optional overrides:
  - `ERP_BASE_URL`
  - `FP_BASE_URL`

## Run

```bash
cd /Users/jvoigt/Projects/_formapps/formprocessor2/tests
npm i
npm test
```
