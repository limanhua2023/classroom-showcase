# Economics Public Audit 2026-05-23

## Command

```powershell
npm run audit:public -- https://classroom-showcase.onrender.com
node scripts/check-public-readiness.mjs http://127.0.0.1:3105
```

## Local Latest Code

Base URL: `http://127.0.0.1:3105`

- Result: `11/11 passed`
- Interpretation:
  - latest economics route is mounted
  - short aliases are mounted
  - teacher dashboard contains learning monitor panel
  - super-admin shell contains economics course integration

## Current Render Public Site

Base URL: `https://classroom-showcase.onrender.com`

- Result: `2/11 passed`
- Passed:
  - `GET /api/health`
  - `GET /api/portal/course-registry`
- Failed:
  - student portal still does not show economics-first content
  - course portal still does not show economics-first content
  - dedicated economics page returns `404`
  - short aliases `/economics`, `/course/economics`, `/teacher`, `/admin` are not deployed
  - teacher dashboard shell does not contain learning monitor panel
  - super-admin shell does not contain economics integration markers

## Meaning

Production data and registry are already aware of the economics course, but the public Render site is still serving an older frontend/backend build. The next required action is deployment of the latest `main` build to Render.

## Release Gate

Do not announce the economics course public URL until the Render audit reaches `11/11 passed`.
