# Economics Public Rollout

## Goal

Publish the latest `经济学基础课程` build to the existing `Render + Supabase` stack so students and teachers outside mainland China can use it over the public internet with stable URLs.

## Shortest Deployment Checklist

1. Confirm the latest code is on `main`.
2. In Supabase SQL Editor, run [upgrade_v5.sql](/d:/Users/ACER/AIOT-TEST/upgrade_v5.sql) if it has not been applied to production yet.
3. After `upgrade_v5.sql`, refresh Supabase schema cache or wait for propagation so `student_course_runtime_progress` becomes visible to the REST/API layer.
4. In Render service environment, verify these required variables exist and are stable:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_SECRET`
   - `SUPER_ADMIN_PASSWORD`
5. Keep archive/storage variables only if production archive is already in use:
   - `ARCHIVE_PROVIDER`
   - `ARCHIVE_S3_*` or `GOOGLE_DRIVE_*`
6. Trigger Render deploy from the latest `main` commit.
7. Wait until `GET /api/health` returns `200` and `environment=render`.
8. Run the automated public audit:

```powershell
npm run audit:public -- https://classroom-showcase.onrender.com
```

9. Run the post-deploy teacher smoke test:
   - teacher logs in
   - create or open an economics activity
   - student joins via invite code
   - open economics course page from the activity context
   - verify learning heartbeat reaches teacher dashboard learning panel

Or use the automated smoke test after exporting production cleanup credentials into the shell:

```powershell
npm run smoke:cloud:learning -- https://classroom-showcase.onrender.com
```

## What Must Be True Before Calling It Publicly Ready

- `https://.../courses/economics-fundamentals/` returns `200`
- `https://.../economics` redirects to the dedicated economics page
- `https://.../course/economics` redirects to the economics course portal
- `https://.../teacher` redirects to teacher login
- `https://.../admin` redirects to super-admin
- `/teacher-dashboard.html` contains the learning monitor panel
- `/api/portal/course-registry` exposes active economics entry
- teacher dashboard shows learning leaderboard and group leaderboard after student heartbeat

## Recommended Formal URL Plan

Use one public domain for the whole product first. Do not split frontend and admin across multiple hosts until traffic or org boundaries require it.

- Student portal: `https://classshow.yourdomain.com/`
- Economics direct course page: `https://classshow.yourdomain.com/economics`
- Economics course portal: `https://classshow.yourdomain.com/course/economics`
- Teacher login: `https://classshow.yourdomain.com/teacher`
- Super admin: `https://classshow.yourdomain.com/admin`

Canonical internal paths remain available:

- `/index.html`
- `/course.html?course=经济学基础课程`
- `/courses/economics-fundamentals/`
- `/teacher-login.html`
- `/super-admin.html`

## Reachability Strategy

For Thailand and broader Southeast Asia, keep the backend and Supabase region close to Singapore whenever possible. For Canada and other regions, accept slightly higher dynamic latency but keep public assets on CDN-backed storage and put the public site behind Cloudflare proxy if you want better global edge routing.

This architecture is reasonable for Thailand, Canada, the US, Europe, and most normal international access patterns. It is not a guarantee for mainland China. China needs separate validation and often separate network strategy.

## Public Audit Command

The repository now includes a repeatable audit command:

```powershell
npm run audit:public -- https://classroom-showcase.onrender.com
```

Override the base URL to test any staging or production host.
