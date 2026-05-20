# ClassShow 维护日志

## 2026-05-14
### Super Admin Course Console and Integration Spec
- Added a unified super-admin course console at `public/super-admin.html`.
- Added protected APIs:
  - `GET /api/super-admin/status`
  - `POST /api/super-admin/login`
  - `GET /api/super-admin/overview`
- Added a shared course registry at `data/course-registry.json` so future dedicated course pages can be mapped to stable public routes without changing the activity data model.
- Added a dedicated AI course slot at `public/courses/ai-learning/index.html`. This is the first live integration placeholder and can be replaced directly by the real AI course page later.
- Added a lightweight course runtime adapter at `public/js/course-runtime.js` so future course pages can read shared identity, current activity context, registry metadata, and live course summaries.
- Added a browser-viewable integration guide at `public/course-integration-spec.html` and a repo-level maintenance guide at `COURSE_PAGE_INTEGRATION_SPEC.md`.
- Exposed super-admin entry buttons from the homepage and teacher login page to reduce operational friction.

### Course Portal Foundation
- Added public course-directory APIs for the main showcase portal:
  - `GET /api/portal/courses`
  - `GET /api/portal/course-activities?course_name=...`
- The portal groups existing `activities.course_name` values, so AI, economics, math, and later courses can share one student-work showcase homepage without changing the current DPU139 workflow.
- Added homepage course cards with course-level activity, student, image, video, and work counts.
- Added `course.html` as the course landing page. It lists all activities for a course and provides student entry, guest browsing, and big-screen display shortcuts.
- Course directory APIs intentionally do not expose activity invite codes. Students still need the teacher-provided course invite code to enter, preserving course isolation.
- `AI学习课程` is now pinned as the first default course card even before its first activity is created.
- Kept the current invite-code login as the fallback path, so teachers and students can still enter a class even if the course directory is temporarily unavailable.
- Local validation passed: `/api/health` OK, `/api/portal/courses` returned 27 course groups, `invite_code_exposed = false`, and `course.html` loaded successfully.

### Supabase Service-Role Maintenance Mode Preparation
- Split Supabase access into two server-side clients:
  - app client prefers `SUPABASE_ANON_KEY`
  - maintenance client prefers `SUPABASE_SERVICE_ROLE_KEY`
- Moved server-side `submissions` bucket maintenance operations onto the maintenance client, so hard delete, quarantine, archive, restore, and maintenance downloads no longer depend on anon fallback when service-role is available.
- Expanded `/api/health` to expose:
  - `supabase_app_key_type`
  - `supabase_maintenance_key_type`
  - `storage_maintenance_mode`
- Expanded teacher storage diagnostics so the panel can show app-key mode vs maintenance-key mode directly.
- Added the Render rollout checklist to `RENDER_SERVICE_ROLE_MAINTENANCE_MODE.md`.

### Teacher Trash Hard-Delete Fix and Storage Self-Diagnostics
- Root cause confirmed for the previous production hard-purge failure: `sanitizeStoragePath()` did not allow `trash/...` paths, so the teacher purge route rejected every recycle-bin object before the delete call even ran.
- Expanded storage-path validation to include `trash`, which unblocks permanent deletion for isolated recycle-bin files.
- Reworked hard-delete execution to return structured per-file results instead of a bare boolean. The route now reports method, error text, retry attempts, and grouped failure statistics.
- Added a live storage self-diagnostic endpoint: `GET /api/teacher/storage-diagnostics`.
- Added a teacher-dashboard diagnostics panel with:
  - a one-click storage self-check button,
  - a last hard-delete failure panel,
  - grouped failure reasons,
  - sample path validity checks,
  - storage key mode and REST-delete readiness hints.
- Deployed commit `8ccc248355f97f963fb8543d021a5d8016b801cb`.
- Performed a real live regression test by uploading a temporary file into `submissions/trash/...` and deleting it through the DPU139 teacher endpoint.
- Verified live result: `before_trash_count = 1`, `purge_removed = 1`, `purge_failed = 0`, `after_trash_count = 0`, `still_present = false`.
- Saved the machine-readable regression artifact to `tmp_e2e_report/DPU139_trash_purge_fix_2026-05-13T23-34-08-060.json`.

### Production Cleanup for DPU139
- Created a pre-cleanup cloud backup snapshot for activity `DPU139` and archived it to Google Drive before deleting any live data.
- Snapshot ID: `20260514_002312`
- Snapshot SHA256: `420084499a8d3e0c96e781441ab13dfa76615dc49f162c56fa9622e427659aff`
- Cleaned 7 confirmed source-missing submissions from the live activity. These same 7 records were also the entire `archive_failed` set, so both issue counts dropped to zero together.
- Purged 1 already quarantined, purge-ready missing-media record from the recycle bin, leaving the recycle area clean.
- Ran the live orphan-file cleanup endpoint and isolated 19 orphaned storage objects safely out of the active dataset.
- Verified after cleanup that `missing_media.total_count = 0`, `missing_media.archive_failed_count = 0`, `quarantined_missing_media.total_count = 0`, and `storage.orphan_count = 0`.
- Note: orphan cleanup currently quarantines/removes objects from active use but does not immediately reduce `usage_percent`, because the safety area still retains those bytes until a deeper storage purge policy is applied.
- Detailed operation report saved to `CLOUD_CLEANUP_2026-05-14.md`.

### DPU139 Hard Purge and Acceptance Closeout
- Deployed commit `5a98a24ee90cde20936db3d18dea9f3e1ee7298d` with a storage delete fallback that retries hard deletes through the raw Supabase Storage REST path.
- Archived a fresh protected DPU139 snapshot before the real hard-purge round. Snapshot ID: `20260514_012937`.
- Re-tested the live teacher hard-purge endpoint `/api/teacher/storage-trash-purge`; production still returned `removed = 0` and `failed = 32`, so this route remains an open follow-up issue.
- Executed a direct maintenance hard purge for the remaining recycle/trash storage objects and fully cleared the live trash area.
- Verified after hard purge that `storage.trash_count = 0`, `storage.trash_bytes = 0`, `storage.usage_percent = 8.6`, and `storage.warning.level = healthy`.
- Saved the endpoint retest artifact to `tmp_e2e_report/DPU139_hard_purge_report_20260513182934.json`.
- Saved the direct maintenance delete artifact to `tmp_e2e_report/DPU139_direct_trash_delete_20260513183112.json`.
- Saved the acceptance closeout report to `CLOUD_HARD_PURGE_ACCEPTANCE_2026-05-14.md`.

## 2026-05-09
### Restore Point and Learning Engagement Upgrade
- Created restore branch and tag `restore-2026-05-09-pre-engagement-upgrade` at commit `62fbb072152fa3251789e4253fe4d1b70ac6c128`, so future changes can be rolled back to the pre-engagement stable version.
- Added `RESTORE_POINTS.md` with rollback commands and operating cautions.
- Added `ARCHITECTURE_REVIEW_2026-05-09.md` documenting current architecture, risks, completed remediation, and next recommended upgrades.
- Added a `student_learning_sessions` schema block to `upgrade_v4.sql` for online learning duration tracking.
- Added student learning heartbeat and summary APIs. The APIs fail gracefully when the SQL migration has not been run, so core upload/rating/comment flows are not blocked.
- Added a student-side “学习力竞技场” panel with personal online duration, personal rank, engagement score, group rank, individual leaderboard, and group leaderboard.
- Enabled learning heartbeats on gallery, upload, and work-detail pages to measure active study time across real student behavior.

### 2026-05-13 Cloud Acceptance Retest
- Re-ran the latest Supabase migration with the PostgREST schema reload notification and confirmed that `student_learning_sessions` is now writable through the live REST/Data API path.
- Strict live validation passed for `POST /api/student/learning/heartbeat` and `GET /api/student/learning/summary`; the response now reports `schema_ready: true` and returns both personal and group leaderboard data.
- Verified the production health endpoint on Render. The service reports commit `ea46168`, healthy background queues, and Google Drive archive auth mode `oauth-refresh-token`.
- Executed a read-only live pressure round with `scripts/ops-pressure-test.mjs`: 120/120 requests succeeded, average latency was about 2054 ms, p95 was about 3788 ms, and no route-level failures occurred during the run.
- Outstanding historical cleanup risks remain visible but do not block normal use: 7 missing-media submissions, 7 failed archive items, and 19 orphaned storage files.
- Saved the detailed acceptance report to `CLOUD_ACCEPTANCE_2026-05-13.md` and the machine-readable live pressure artifact to `tmp_e2e_report/ops_pressure_report_20260513170306.json`.

### Quarantine Purge Preview and Excel Export
- Added a recycle-bin purge preview modal. Teachers now see the exact title, student, class, group, status, and quarantine time for the current filtered result set before any permanent delete is submitted.
- Batch permanent delete no longer jumps straight from filter selection to irreversible deletion. The preview layer reduces accidental cleanup risk when the teacher is filtering by class or group.
- Added native `.xlsx` export for the current recycle-bin result set, using a browser-side SheetJS bundle served from `public/vendor/xlsx.full.min.js`.
- The Excel workbook includes two sheets: `导出说明` and `回收区结果`, so teachers can archive both the filtered data and the filter context used at export time.
- Kept CSV export as a parallel fallback/export option, so the teacher can choose quick plain-text export or formatted Excel archive as needed.

## 2026-05-08
### Quarantine Class/Group Filters and Export
- Added recycle-bin secondary filters for `class` and `group`, populated from the currently loaded quarantined works. Teachers can now narrow the recycle list by organizational slice before acting.
- Added one-click CSV export for the current recycle-bin result set, including title, student identity, class, group, media type, upload time, quarantine time, restore status, archive status, and error reason.
- The class filter and group filter are persisted per activity in browser local storage alongside the existing time filter, recoverable-only toggle, and search text.
- The recycle-bin batch restore and batch delete actions remain tied to the current filtered result set, so export, restore, and cleanup now operate on the same visible scope.

### Quarantine Search and Recoverable Filter
- Added recycle-bin search by student name or student ID, so teachers can quickly locate a quarantined work without scanning the full list.
- Added a one-click `recoverable only` filter in the recycle area. Items count as recoverable when the source file still exists or when an archive restore path is available.
- Search text and the recoverable-only toggle are now persisted per activity in browser local storage, so a full refresh keeps the teacher's current recycle-bin working context.
- When the top overdue red badge jumps into the recycle bin, auxiliary filters are cleared first to ensure the first truly overdue work is always brought into focus.

### Quarantine Due Reminder and Red Badge
- Added recycle-bin due reminders in the teacher dashboard. The recycle area now shows an inline expiry alert when quarantined works become eligible for handling.
- Added a recycle-bin quick button in the top bar with a red dot and numeric badge that reflects the current `purge_ready_count`.
- The browser title now prefixes the due count, so teachers can see pending recycle-bin work even when the tab is in the background.
- Reminder toasts only fire when the due-count state changes, avoiding repeated noise during manual refreshes.

### Quarantine Due Filters and Focus Jump
- Added recycle-bin filters for `all`, `today due`, and `overdue`, allowing teachers to narrow the recycle list to the works that need same-day review or are already past the retention lock.
- The top recycle-bin red badge now jumps directly to the recycle area and focuses the first overdue work, reducing scan time when teachers return to the dashboard.
- Overdue recycle items now carry dedicated DOM markers and visual emphasis so the first actionable work can be scrolled into view and highlighted safely.
- Batch restore and batch permanent-delete actions now respect the active recycle-bin filter instead of always operating on the full recycle list.

### Quarantine Today Highlight and Filter Persistence
- Added an orange highlight style for recycle-bin works whose retention lock expires on the current Bangkok day, making same-day review items stand out before they become overdue.
- The `today due` recycle filter now gains attention styling when there are same-day items waiting.
- The recycle-bin filter state is now stored per activity in browser local storage, so a full teacher-page refresh keeps the current `all / today / overdue` view instead of resetting to `all`.

### 缺失作品回收区

- 教师后台将“当前筛选结果一键删除缺失作品”改为“当前筛选结果一键隔离缺失作品”，先移出公开展示，再进入“缺失作品回收区”等待教师二次确认。
- 新增后端接口：`/api/teacher/missing-media-quarantine`、`/api/teacher/quarantined-submissions-restore`、`/api/teacher/quarantined-submissions-purge`，分别负责隔离、恢复、彻底删除。
- 学生端、作品详情、评分、评论、浏览量与教师作品列表全部只对 `visible` 状态开放；被隔离作品不会再出现在学生端、大屏、画廊和排行榜。
- 回收区支持三条安全路径：上传修复文件后恢复、从归档恢复后恢复、确认无保留价值后彻底删除。

### Quarantine Retention Lock
- Added activity-level `quarantine_retention_days` with a teacher control in the archive panel. Default is 3 days and the UI accepts 0 to 365 days.
- Added `submissions.quarantined_at` for new environments. Older environments without that column still persist the timestamp into the media manifest so the safety window remains enforceable.
- Permanent purge now checks the retention window first. Items still inside the protection window stay in the recycle bin and cannot be hard deleted.
- Batch purge only submits items whose protection window has already expired. Locked items show remaining retention time and unlock time in the recycle bin.
- Legacy quarantined items without a timestamp are backfilled automatically on dashboard load, then follow the same retention policy afterward.

### 缺失作品一键清理

- 教师后台“缺失媒体告警列表”新增两类删除入口：单条“删除记录”和“当前筛选结果一键删除缺失作品”。
- 后端新增 `/api/teacher/missing-media-delete`，仅允许批量删除“源文件确实缺失”的作品记录；仅缩略图缺失或可归档恢复的作品不会被后端误删。
- 批量删除完成后自动失效教师仪表盘、缺失媒体、空间统计缓存，避免删除后列表残留旧数据。

### 运维压测与稳定性补强

- 新增 `npm run ops:pressure`，用于对线上或本地活动执行受控压测、上传测试、交互测试、备份快照检查、归档队列检查，并输出 JSON 报告。
- 压测脚本支持自动生成 PNG 图片和小体积 MP4 视频，覆盖图片压缩、视频封面、视频转码排队和归档链路。
- 新增 `/api/health` 健康检查接口，返回 Supabase 连通性、归档提供方、后台转码/归档任务状态和接口延迟，便于日常巡检。
- 修复学生撤回“信息反馈”时未查询 `content` 字段的问题，避免重复撤回判断异常和撤回内容变成无效值。
- 更新 `.gitignore`，忽略压测报告、临时上传素材和本地诊断输出，避免维护文件污染代码仓库。

### 本轮检查记录

- 本地检查通过：`node --check server.js`、`node --check scripts/ops-pressure-test.mjs`、`npm run build`。
- 云端只读巡检完成：24 个读请求全部成功；旧版本线上尚未部署 `/api/health`，返回 404，等待本次部署后复测。
- 巡检发现遗留风险：DPU139 仍有 10 个历史源文件缺失、10 个归档失败项；这类问题已在教师后台通过缺失媒体告警和失败原因分类暴露。
- 性能观察：免费 Render 冷启动/重负载下 p95 偏高，部署后需用分路由统计继续判断是否由缺失媒体导出或冷启动导致。

### 维护规则

- 每次上线前至少执行：`node --check server.js`、`node --check scripts/ops-pressure-test.mjs`、`npm run build`。
- 每次云端改动后至少执行一次：`npm run ops:pressure`，并保留 `tmp_e2e_report/ops_pressure_report_*.json` 报告。
- 如出现媒体缺失或归档失败，优先查看教师后台“缺失媒体告警列表 / 失败原因分类统计”，再执行一键重试、修复缩略图或从归档恢复。

### 2026-05-13 学习时长 SQL 收口

- 云端已部署 `ef3b144`，包含学生在线学习时长心跳、个人学习榜和小组学习榜。
- 巡检发现：Render 代码已更新，但 Supabase REST schema cache 仍未识别 `student_learning_sessions`，导致学习心跳接口进入安全降级模式。
- 已在 `upgrade_v4.sql` 末尾加入 `notify pgrst, 'reload schema';`，用于在执行迁移后立即刷新 PostgREST schema cache，减少“表已创建但 REST 暂时不可见”的窗口期。
- 当前结论：上传、评分、评论、画廊和归档链路可正常使用；学习时长模块需要重新运行最新版 `upgrade_v4.sql` 后才能真正写入统计数据。

### 2026-05-08 压力测试后整改

- 云端写入压力测试已在 DPU139 创建 6 个压测学生、12 个作品，其中包含图片与视频；上传、缩略图、评分、评论、信息反馈、备份快照、归档队列均完成接口级验证。
- 发现 Render 免费实例在并发访问教师仪表盘和缺失媒体导出时会反复扫描 Supabase Storage 与媒体清单，导致单次 502 和 p95 延迟过高。
- 新增重型运维查询短时缓存与同请求合并：`buildStorageSummary`、缺失媒体导出共用 30 秒缓存；作品新增、修改、删除、修复、转码、归档、清理后自动失效缓存。
- 修正压测报告里的快照大小统计，避免 JSON 响应被解析后显示为 0 字节。
- 本次整改目标：降低教师后台高并发运维接口对免费 Render 单实例的阻塞，减少课堂展示和学生访问被运维扫描拖慢的风险。
## 2026-05-14 Super Admin Registry Editor
- Added a writable super-admin course registry flow. Course metadata can now be created and edited from `/super-admin.html` instead of manually editing `data/course-registry.json`.
- Added `POST /api/super-admin/course-registry/save` with duplicate-name and duplicate-slug protection plus validation for course name, slug, route, module key, and capability flags.
- Course registry persistence now prefers Supabase Storage at `submissions/system/course-registry.json`, with local file fallback kept for development and emergency recovery.
- Rebuilt the super-admin page into a clean UTF-8 version and added an inline registry editor, quick-register actions for unregistered live courses, and visible registry version/update metadata.

## 2026-05-14 Super Admin Registry Lifecycle
- Added registry lifecycle endpoints for super-admin maintenance: `POST /api/super-admin/course-registry/toggle`, `.../delete`, `.../reorder`, and `.../scaffold`.
- Registered courses can now be disabled without being deleted. Disabled courses stay visible to super-admins but disappear from the public course portal and course-activity API responses.
- Added drag-and-drop sorting for registered courses in `/super-admin.html`. Sort order is persisted in the registry and reused by the public course portal.
- Added one-click scaffold creation for registered courses. When enabled, a missing static course page now falls back to a dynamic scaffold route that exposes the expected mount path immediately.
- Local closed-loop verification passed for `create -> scaffold -> open route -> reorder -> disable -> delete`, and the maintenance UI now exposes those operations directly instead of requiring file edits.

## 2026-05-14 Local Backup Agent and USB Secondary Backup
- Added `scripts/local-backup-agent.mjs` and npm entrypoints `backup:local` / `backup:local:watch` for incremental local backup to a Windows hard drive.
- The local backup agent now pulls the full `submissions` storage bucket (`uploads`, `videos`, `thumbs`, `manifests`, `trash`, `system`) plus metadata tables and per-activity JSON snapshots.
- Backup runs persist a state file, write machine-readable reports under the local backup root, and keep stale-file warnings instead of auto-deleting local copies.
- Added `scripts/usb-secondary-backup.ps1` to create timestamped USB snapshots from the local backup root, plus optional `latest` mirroring without destructive purge mode.
- Added `scripts/install-local-backup-task.ps1`, `.env.local-backup.example`, and `LOCAL_BACKUP_AGENT.md` so the backup agent can be installed as a Windows logon task and operated without editing code.

## 2026-05-19 R2 Storage Gauge and Threshold Alerts
- Added backend R2 archive storage summary caching with configurable free-quota, attention-threshold, and critical-threshold byte values. The default thresholds now track Cloudflare R2 free usage at 10 GB with warning levels at 8.5 GB and 9.0 GB.
- Teacher dashboard storage summaries now include `storage.archive_storage`, covering total archived bytes, snapshot/media split, object counts, endpoint host, remaining free capacity, and warning status.
- Added a speedometer-style R2 storage gauge to the teacher dashboard archive panel. The gauge renders current GB usage, percentage of the free tier, threshold chips, archive object statistics, and warning notes.
- The R2 gauge uses healthy / warning / critical states so teachers can see archive pressure before the free tier is exhausted, while keeping `ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false` safe mode unchanged.
- Validation completed with `node --check server.js` and inline script parsing for `public/teacher-dashboard.html`.

## 2026-05-19 Super Admin R2 Gauge and Health Summary
- Extended `/api/health` to return `archive_storage`, sourced from the same cached R2 usage summary used by the archive dashboards.
- Extended `/api/super-admin/overview` to return `archive_storage` so the portal layer can visualize archive pressure without triggering a second bucket scan.
- Added an R2 speedometer gauge to `/super-admin.html`, including snapshot/media split, object count, remaining capacity, and bucket metadata.
- Added a critical topbar alert button for the super-admin page. When R2 crosses the 9 GB red zone, the button appears and scrolls directly to the archive gauge.
- Validated `server.js`, `public/super-admin.html`, and `public/teacher-dashboard.html` after the change before deployment.

## 2026-05-19 R2 Trend History and Cleanup Guidance
- Added persisted R2 archive history sampling at `submissions/system/archive-storage-history.json`. The server now records hourly archive-usage points by default, or faster when storage jumps sharply.
- `archive_storage` responses now include `budget_alerts_usd`, `history_points`, `history_summary`, and `cleanup_suggestions`, so `/api/health`, the teacher dashboard, and the super-admin page all read the same archive-operations payload.
- Added an R2 trend card to the teacher dashboard and super-admin console. Both pages now render a lightweight 24-point SVG trend chart instead of only showing a single-point gauge.
- Added cleanup / ops suggestion panels for the 8.5 GB warning zone and 9.0 GB critical zone, including snapshot-first cleanup hints, large-media pressure hints, and short-horizon growth warnings.
- Surfaced Cloudflare budget targets (`$1`, `$3`) alongside storage-threshold reminders in both UI layers, so finance alerts and capacity alerts are visible from the application side even though the actual Cloudflare budget alert objects remain managed in Cloudflare Billing.
- Local validation passed with `node --check server.js` and inline-script parsing for `public/teacher-dashboard.html` and `public/super-admin.html`.


## 2026-05-19 Local Backup Heartbeat and R2 Top-N Cleanup
- The local Windows backup agent now uploads a cloud heartbeat file to `submissions/system/local-backup-status.json`, including host, mode, bucket, last success time, download/failure counts, and table snapshot totals.
- `/api/health` and `/api/super-admin/overview` now expose `local_backup_status`, so storage operations and backup-heartbeat diagnostics can be checked from the application without opening the Windows machine.
- The super-admin archive operations panel now shows a dedicated local-backup status card and includes the local-backup state in the top health summary line.
- Teacher and super-admin archive cleanup panels now list `Largest media Top 5` and `Largest snapshots Top 5`, so once the 8.5 GB warning zone is reached the operator can immediately see which objects are consuming the most archive space.
- Local validation completed with `node --check server.js`, `node --check scripts/local-backup-agent.mjs`, and inline script parsing for `public/super-admin.html` and `public/teacher-dashboard.html`.

## 2026-05-19 R2 7D/30D Trends and Course/Activity Cleanup Guidance
- Archive storage history now keeps a longer rolling window by default and publishes both `7d` and `30d` trend summaries, so the dashboards can switch between short-horizon and month-view pressure without rescanning the R2 bucket.
- Teacher and super-admin dashboards now provide `7D / 30D` trend toggle buttons on the R2 storage chart, with window-aware delta chips and empty-state messaging tied to the selected time range.
- Backend archive summaries now group R2 usage by activity and by course using archive object paths plus `activities` metadata, exposing `largest_activity_groups` and `largest_course_groups` for targeted cleanup planning.
- Cleanup suggestion panels now elevate the heaviest courses and activities first whenever R2 crosses the 8.5 GB warning line, alongside the existing largest-media and largest-snapshot object lists.
- Local validation completed with `node --check server.js` and inline script parsing for `public/super-admin.html` and `public/teacher-dashboard.html` before deployment.

## 2026-05-19 Largest Video Top-N and Local Backup Closed Loop
- Added `largest_video_objects` to the archive storage summary so R2 cleanup guidance can distinguish oversized videos from generic media objects and thumbnails.
- Teacher and super-admin cleanup panels now render `Largest videos Top 5` alongside the existing course/activity/media/snapshot lists.
- Archive object rank cards now support both `size_bytes` and raw `size`, fixing generic object lists so video/media entries no longer render as `0 B`.
- Verified the Windows local backup heartbeat end to end by running `npm run backup:local -- --output tmp_local_backup_verify --activity-id e538b984-727a-4f97-8cfa-0375ff20d2cf --exclude-trash`.
- Closed-loop backup result: `activities=1`, `submissions=29`, `downloaded=466`, `failed=0`. This confirmed that the current local environment can generate a real backup set and upload the heartbeat document consumed by `/api/health` and the super-admin console.
- Fixed local-backup status normalization so heartbeat summaries now read `storage/tables` counts from the root payload as well as legacy nested `report.*` fields, preventing healthy runs from showing zeroed statistics in the dashboard.

## 2026-05-19 Supabase Hot-Tier Dashboard and Storage Cost Forecast
- Added a global `hot_storage` summary to `/api/health`, teacher storage summaries, and `/api/super-admin/overview`, treating Supabase free storage as a 1 GB hot tier with default strategy thresholds at 40%, 50%, 70%, and 85%.
- Teacher archive controls now surface a dedicated Supabase hot-tier speedometer, mirrored/cold policy hints, recommended archive-after-days guidance, and grouped course/activity/file migration suggestions before the existing R2 gauge.
- Super-admin now exposes a matching `SUPABASE HOT TIER` section so portal-level operators can see the same hot-tier pressure, phase labels, and Top-N hot-file pressure without opening an activity dashboard first.
- Added `cost_projection` to the R2 archive summary. Both dashboards now show a rough storage-only monthly overage estimate plus Cloudflare free-operation reminders, so budget planning stays visible beside the `$1 / $3` alert thresholds.
- The intended operating model is now explicit in-product: Supabase is the hot tier for recent teaching assets, while R2 is the cold archive tier. Suggested archive pressure steps are `40% prepare -> 50% archive -> 70% accelerate -> 85% critical`.

## 2026-05-20 Hot-Tier Video Top-N and Cooldown Candidate Ranking
- Extended the Supabase hot-tier summary with `largest_video_items`, so both dashboards can separate generic large files from oversized videos when planning which objects should leave the hot layer first.
- Added `cooldown_candidates` to the hot-tier payload. Candidates are ranked by storage footprint, recent inactivity, and course-level recent upload activity so operators can see which activities are best suited for early migration into R2.
- Teacher and super-admin hot-tier operation panels now render `Move-to-cold candidates Top 5` and `Largest hot videos Top 5`, alongside the existing course/activity/file lists.
- The cooldown ranking favors activities with no uploads in the last 7 days, larger footprints, and low recent course activity, which makes the hot-to-cold recommendations more operationally useful than a pure size sort.
