# Cloud Hard Purge Acceptance 2026-05-14

## Scope

- Perform a real storage hard-purge for the DPU139 recycle/trash area
- Reclaim Supabase bucket bytes immediately
- Re-check the live DPU139 teacher dashboard after cleanup

## Environment

- Live site: `https://classroom-showcase.onrender.com`
- Activity invite code: `DPU139`
- Activity ID: `e538b984-727a-4f97-8cfa-0375ff20d2cf`
- Render version after deploy: `5a98a24ee90cde20936db3d18dea9f3e1ee7298d`
- Archive provider: `google-drive`
- Archive auth mode: `oauth-refresh-token`

## Protected Snapshot Before Hard Delete

- A fresh cloud snapshot was archived before the real hard-purge step.
- Snapshot ID: `20260514_012937`
- Snapshot time: `2026-05-13T18:29:38.308Z`

## Before Hard Purge

- Trash files in storage summary: `32`
- Trash bytes in storage summary: `12,458,690`
- Orphan count: `0`
- Missing-media live records: `0`

## What Happened

### 1. Production hard-purge endpoint was re-tested

- Endpoint: `POST /api/teacher/storage-trash-purge`
- Result: endpoint still returned `removed = 0`
- Failed count: `32`
- Machine report: `tmp_e2e_report/DPU139_hard_purge_report_20260513182934.json`

### 2. Root-cause narrowing

- Local direct Supabase Storage delete with the current anon key succeeds
- Local `supabase-js` storage remove also succeeds
- Production teacher route still reports `Delete returned false`
- A REST-delete fallback was added to `server.js` and deployed, but the live route still did not clear the trash set

Current conclusion:

- The live cleanup goal is complete
- The teacher dashboard hard-purge route still has an unresolved production-only deletion mismatch and should remain on the follow-up list

### 3. Real hard purge executed through the maintenance path

- Direct maintenance deletion removed the remaining trash objects from bucket `submissions/trash/...`
- Machine report: `tmp_e2e_report/DPU139_direct_trash_delete_20260513183112.json`

Result:

- Removed files: `31`
- Failed files: `0`
- Bytes freed in that final maintenance batch: `6,972,755`

Note:

- Before this final batch, several probe deletes had already succeeded during diagnosis, so the total trash area moved from `34` historical files down to `0`

## After Hard Purge

- Trash files in storage summary: `0`
- Trash bytes in storage summary: `0`
- Total files: `464`
- Total bytes: `92,622,465`
- Usage percent: `8.6%`
- Remaining quota bytes: `981,119,359`
- Storage warning level: `healthy`

## DPU139 Teacher Dashboard Acceptance

The live teacher dashboard re-check passed for the main storage-control surface:

- Teacher login works
- Dashboard summary API works
- Snapshot archive list is present
- Latest snapshot is visible in live summary data
- Trash count is now `0`
- Trash bytes are now `0`
- Missing-media count is `0`
- Orphan count is `0`
- The hard-purge button source is present in `teacher-dashboard.html` as `purgeTrashBtn`

## Open Follow-up Issue

The production teacher hard-purge route is still not behaving correctly even though direct storage deletion works with the same project credentials from the maintenance path.

Recommended next fix:

1. Add a short-lived diagnostic field to `/api/health` or a teacher-only ops route that reports whether the live process is using `anon` or `service_role`
2. Log the exact storage delete error body for `/api/teacher/storage-trash-purge`
3. Compare the Render `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` with the local working key material

## Final Status

The requested outcome for this round is complete:

- Real storage trash was hard-deleted
- Supabase space was actually reclaimed
- DPU139 teacher dashboard storage summary is clean again
