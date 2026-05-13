# Cloud Cleanup 2026-05-14

## Scope

- Clean historical broken submissions in live activity `DPU139`
- Clear the matching live `archive_failed` issue set
- Clear recycle-bin broken leftovers that were already purge-ready
- Isolate active orphaned storage objects safely

## Environment

- Live site: `https://classroom-showcase.onrender.com`
- Activity invite code: `DPU139`
- Activity ID: `e538b984-727a-4f97-8cfa-0375ff20d2cf`
- Archive provider: `google-drive`
- Archive auth mode: `oauth-refresh-token`

## Pre-cleanup Backup

- A full activity snapshot was archived before any destructive action.
- Snapshot ID: `20260514_002312`
- SHA256: `420084499a8d3e0c96e781441ab13dfa76615dc49f162c56fa9622e427659aff`
- Google Drive file ID: `13GStSCO9d1TvTpHubKyFTWkk0Ovctnbw`

## Before Cleanup

- Visible missing-media submissions: `7`
- Visible failed-archive submissions: `7`
- Quarantined broken submissions: `1`
- Purge-ready quarantined submissions: `1`
- Orphaned storage objects: `19`
- Orphaned bytes: `5,887,039`

## Actions Performed

### 1. Backup snapshot

- Called the teacher snapshot archive endpoint before cleanup.
- Result: success

### 2. Delete confirmed source-missing live submissions

- Endpoint: `POST /api/teacher/missing-media-delete`
- Requested: `7`
- Removed: `7`
- Failed: `0`

Affected submissions removed:

- `dd503205-5a67-418a-a1d4-73fc26af1539` `45（2026年05月04日23时25分53秒）`
- `c6a01564-1c3c-4934-ad45-464a2221f5db` `风格（2026年05月04日17时27分30秒）`
- `8d5de5df-4e19-4b91-9fad-909a9822aafa` `56789（2026年05月04日18时）`
- `a52d8010-e41a-44d5-b0a3-8cbfb2443572` `12345（2026年05月04日16时）`
- `30d53416-3418-4844-867e-70845bc09448` `356`
- `17aa2bc8-7cf1-42ea-b171-83658e7fce34` `58`
- `f7f94812-92b8-4f6b-a349-9a42ceaf88b6` `345`

These 7 rows were also the entire live `archive_failed` set, because all of them had `source_missing = true` and `archive_status = failed`.

### 3. Purge broken recycle-bin residue

- Endpoint: `POST /api/teacher/quarantined-submissions-purge`
- Requested: `1`
- Removed: `1`
- Failed: `0`

Purged recycle-bin item:

- `89beee73-235c-4560-a46f-3ce183869384` `789（2026年05月04日15时）`

### 4. Isolate orphan files

- Endpoint: `POST /api/teacher/storage-cleanup`
- Isolated orphan objects: `19`
- Isolated bytes: `5,887,039`

Important note:

- This orphan cleanup removed the objects from active use and from the orphan report.
- It did **not** immediately lower total storage usage, because the current safety strategy quarantines those objects instead of hard-deleting them instantly.

## After Cleanup

- Visible missing-media submissions: `0`
- Visible failed-archive submissions: `0`
- Quarantined broken submissions: `0`
- Orphaned storage objects: `0`
- Orphaned bytes: `0`

## Acceptance

The requested cleanup target is complete.

- `7` historical visible missing-media records: cleared
- `7` historical visible archive-failed records: cleared
- `19` active orphan files: cleared from the live orphan set

## Remaining Follow-up

- Storage usage percentage may still stay roughly similar until the quarantined storage safety area is purged by policy or by a deeper irreversible cleanup tool.
- If the goal is to reclaim bucket bytes immediately, the next step should be a dedicated hard-delete workflow for quarantined storage objects, protected by another confirmation layer and a fresh backup snapshot.
