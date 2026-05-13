# Cloud Trash Purge Fix 2026-05-14

## Scope

- Fix the production DPU139 teacher trash hard-delete route
- Add a failure-details panel and a storage self-diagnostic path
- Re-run a real live purge against a temporary trash object

## Root Cause

The previous production hard-delete route failed before it ever reached Supabase Storage deletion.

- The route read recycle-bin paths such as `trash/...`
- `sanitizeStoragePath()` only allowed:
  - `uploads/...`
  - `videos/...`
  - `thumbs/...`
  - `manifests/...`
- As a result, every hard-delete request against recycle-bin files was rejected locally and surfaced as a generic delete failure

This was not a Google Drive issue and not a Render memory issue.

## Code Fix

### Backend

- Expanded `sanitizeStoragePath()` to allow `trash/...`
- Added `deleteStorageObjectDetailed()` so hard-delete returns:
  - `ok`
  - `method`
  - `error`
  - `attempts`
  - `diagnostics`
- Added `summarizeStorageFailures()` for grouped failure statistics
- Added `buildStorageDiagnostics()` for runtime checks
- Added endpoint:
  - `GET /api/teacher/storage-diagnostics`
- Upgraded endpoint:
  - `POST /api/teacher/storage-trash-purge`

### Frontend

- Added teacher dashboard panel:
  - `硬删失败原因与自检诊断`
- Added buttons:
  - `运行自检`
  - `清空面板`
- Added live failure detail rendering for the most recent hard-delete attempt

## Live Deployment

- Render version after deploy: `8ccc248355f97f963fb8543d021a5d8016b801cb`
- Live site: `https://classroom-showcase.onrender.com`
- Activity invite code: `DPU139`
- Activity ID: `e538b984-727a-4f97-8cfa-0375ff20d2cf`

## Real Regression Test

I performed a live end-to-end proof, not just a static code review.

### Test Steps

1. Log in to the live teacher API for `DPU139`
2. Upload a temporary object into:
   - `submissions/trash/diag_2026-05-13T23-34-08-060Z.txt`
3. Confirm the live dashboard summary sees:
   - `trash_count = 1`
4. Call:
   - `GET /api/teacher/storage-diagnostics`
5. Call:
   - `POST /api/teacher/storage-trash-purge`
6. Verify:
   - the file is removed from Supabase Storage
   - live dashboard summary returns `trash_count = 0`

### Live Result

- Upload to trash: success
- Diagnostics endpoint: success
- Hard-delete endpoint: success
- Removed files: `1`
- Failed files: `0`
- Bytes freed: `47`
- Trash count before purge: `1`
- Trash count after purge: `0`
- Object still present after purge: `false`

## Diagnostics Output Highlights

- Supabase key type detected live: `anon`
- Storage safe delete: `true`
- Trash listing probe: success
- REST delete URL readiness: `true`

Current note:

- The system still runs maintenance storage operations under the publishable anon key in this deployment.
- This now works for the tested purge path, but `service_role` remains the stronger long-term maintenance setup.

## Artifact

- Machine report:
  - `tmp_e2e_report/DPU139_trash_purge_fix_2026-05-13T23-34-08-060.json`

## Outcome

The production teacher hard-delete route is now fixed for real recycle-bin objects, and the teacher dashboard now exposes enough detail to diagnose any future storage purge failure without guessing.
