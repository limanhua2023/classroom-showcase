# Super Admin Local Smoke

This project now has a dedicated authenticated smoke test for the super-admin side:

```powershell
node scripts/smoke-super-admin-flow.mjs
```

## What it checks

The script verifies the real super-admin path, not just the page shell:

1. `GET /api/super-admin/status`
2. unauthenticated `GET /api/super-admin/overview` returns `401`
3. `POST /api/super-admin/login`
4. authenticated `GET /api/super-admin/overview`
5. authenticated `GET /api/super-admin/egress-profile`
6. temporary course-registry create
7. temporary course-registry disable / enable
8. temporary course-registry scaffold
9. temporary course-registry reorder
10. temporary course-registry update
11. temporary course-registry delete

The smoke test cleans up its temporary registry entry automatically. It does not touch real courses, real student rosters, or real teacher activities.

## Local prerequisites

Set a local super-admin password before running the smoke:

```env
SUPER_ADMIN_PASSWORD=your-local-super-admin-password
```

Recommended place:

- `.env.local`

Fallbacks:

- `.env`
- environment variable `CLASSSHOW_SUPER_ADMIN_PASSWORD`
- environment variable `SUPER_ADMIN_PASSWORD`

Then restart the local backend.

## Local run

Start the backend:

```powershell
node server.js
```

Run the smoke against local:

```powershell
$env:CLASSSHOW_BACKEND_BASE='http://127.0.0.1:3000'
node scripts/smoke-super-admin-flow.mjs
```

## Production run

Use this only when you intentionally want an authenticated release smoke:

```powershell
$env:CLASSSHOW_BACKEND_BASE='https://classroom-showcase.onrender.com'
$env:CLASSSHOW_SUPER_ADMIN_PASSWORD='your-production-super-admin-password'
node scripts/smoke-super-admin-flow.mjs
```

## Optional integration with public readiness

`scripts/check-public-readiness.mjs` now supports an opt-in authenticated super-admin smoke.

Enable it like this:

```powershell
$env:CLASSSHOW_ENABLE_SUPER_ADMIN_SMOKE='1'
$env:CLASSSHOW_SUPER_ADMIN_PASSWORD='your-super-admin-password'
node scripts/check-public-readiness.mjs https://classshow-student.pages.dev https://classroom-showcase.onrender.com
```

If the flag is not set, readiness will still check the super-admin page shell, but it will mark the authenticated smoke as skipped instead of mutating the registry.
