# Cloud Acceptance 2026-05-13

## Scope

- Strict re-test of student learning heartbeat
- Strict re-test of individual learning leaderboard
- Strict re-test of group learning leaderboard
- Overall cloud acceptance on live Render + Supabase + Google Drive OAuth archive
- Read-only pressure test on teacher-side operational endpoints

## Environment

- Live site: `https://classroom-showcase.onrender.com`
- Activity: `DPU139`
- Render version: `ea46168966cbe079749a696a03d91034458ca1f5`
- Archive provider: `google-drive`
- Archive auth mode: `oauth-refresh-token`

## Result Summary

### Accepted

- `upgrade_v4.sql` has been applied successfully in Supabase SQL Editor.
- `student_learning_sessions` is now visible to Supabase REST and writable.
- `/api/student/learning/heartbeat` works on live cloud.
- `/api/student/learning/summary` works on live cloud.
- Student learning leaderboard payload is returned normally.
- Group learning leaderboard payload is returned normally.
- `/api/health` works on live cloud.
- Teacher dashboard summary works on live cloud.
- Missing-media export works on live cloud.
- Archive-run endpoint works on live cloud.
- Google Drive archive destination is connected and writable.

### Not fully closed yet

- There are still historical missing-media records in `DPU139`.
- There are still historical failed archive records in `DPU139`.
- Group ranking quality is affected by dirty historical `class_name` / `group_name` data.
- Teacher operational endpoints are stable, but on free Render the p95 latency is still high under burst load.

## Learning Module Retest

### Heartbeat

Live retest used a real `DPU139` student account and a fresh session token.

- First heartbeat:
  - HTTP `200`
  - `ok: true`
  - `schema_ready: true`
  - `added_seconds: 0`
- Second heartbeat after waiting about 2 seconds:
  - HTTP `200`
  - `ok: true`
  - `schema_ready: true`
  - `added_seconds: 3`

Conclusion:

- The live heartbeat route is writable.
- Session creation and second-hit increment logic both work.

### Individual leaderboard

Direct cloud response confirms:

- `schema_ready: true`
- `my.rank = 1`
- `my.active_seconds = 6`
- `leaderboard` returns valid ranked rows

Spot check result:

- The current live Top-5 individual leaderboard ordering is internally consistent.
- The tested student's own row is present and ranked correctly.

### Group leaderboard

Direct cloud response confirms:

- `group_leaderboard` returns valid ranked rows
- Current live Top-5 group leaderboard ordering is internally consistent

Important note:

- The ranking code is working.
- But the current historical data quality is poor: some users are grouped under class names such as `123`, `39`, `678`, `59-1`, `AIOT 59-1`, and many rows have no explicit group so they fall back to `未分组`.
- This is not a runtime failure. It is a data-normalization issue that weakens the fairness and readability of the group competition board.

## Cloud Health Check

`/api/health` returned `200` and reported:

- Supabase configured: `true`
- Supabase connectivity: `true`
- Transcode task health: `healthy`
- Archive task health: `healthy`
- Archive provider configured: `true`
- Archive provider public URL capability: `true`

## Read-Only Pressure Test

Artifact:

- `tmp_e2e_report/ops_pressure_report_20260513170306.json`

Configuration:

- Write mode: `false`
- Read concurrency: `24`
- Read rounds: `5`
- Total requests: `120`

Result:

- Success: `120/120`
- Failure rate: `0%`
- Average latency: `2054 ms`
- P50: `2105 ms`
- P95: `3788 ms`
- Max: `5040 ms`

Heaviest routes during this run:

1. `/api/teacher/dashboard-summary`
2. `/api/activity-feedback?...sort=hot`
3. `/api/submissions?activity_id=...`

Interpretation:

- Cloud stability is acceptable.
- Free Render is still the main latency bottleneck.
- No endpoint crashed during this pressure round.

## DPU139 Live Data Snapshot

From the pressure report:

- Participants: `25`
- Submissions: `36`
- Images: `28`
- Videos: `8`
- Feedback items: `17`
- Total views: `33`
- Storage usage: `10.8%`
- Estimated days to limit at recent growth: `172`
- Missing-media records: `7`
- Historical orphan files: `19`
- Trash/recycle items: `7`

## Open Issue List

### High

1. Historical broken media still exist in `DPU139`
   - Count: `7`
   - Pattern: `source_missing`
   - Impact: these works cannot be shown, re-archived, or restored automatically

### Medium

2. Historical archive failures still exist
   - Count: `7`
   - Root cause in current sample: the primary file is already missing, so archive retry is disabled

3. Historical orphan files still occupy storage
   - Count: `19`
   - Size: about `5.89 MB`

4. Group competition board is polluted by inconsistent class naming
   - Example classes seen in live data: `123`, `39`, `678`, `59-1`, `AIOT 59-1`
   - Impact: group leaderboard is technically correct but semantically messy

### Low

5. Operational routes are stable but still slow under burst load on free Render
   - No failures in this round
   - Still worth monitoring if classroom traffic rises

## Recommended Next Actions

### Must do

1. Clean the 7 historical missing-media records
   - Either repair/re-upload them
   - Or quarantine and remove them from active history

2. Normalize class/group data for the current roster and user records
   - This will improve fairness and readability of group competition

### Strongly recommended

3. Keep `ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false` until at least several successful restore drills have been completed

4. Run `ops:pressure` after every schema change or media-pipeline deployment

5. Keep using the missing-media export as the first incident artifact when broken works reappear

### Nice to have

6. Add a dedicated roster normalization tool
   - Batch fix `class_name`
   - Batch fix `group_name`
   - Preview leaderboard changes before applying

7. Add a teacher-side “learning coverage” card
   - Show how many students have at least one learning heartbeat
   - Current tracked student count is still low compared with total participants

## Final Acceptance Decision

Current status is:

- **Learning heartbeat**: pass
- **Personal learning leaderboard**: pass
- **Group learning leaderboard**: pass
- **Google Drive OAuth archive connectivity**: pass
- **Overall cloud runtime stability**: pass
- **Historical media integrity cleanup**: not yet closed
- **Historical roster/group data quality**: not yet closed

So the system is now **operational and deploy-safe**, but **historical data cleanup remains the main remaining risk**.
