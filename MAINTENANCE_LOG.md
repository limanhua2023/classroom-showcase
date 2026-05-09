# ClassShow 维护日志

## 2026-05-09
### Restore Point and Learning Engagement Upgrade
- Created restore branch and tag `restore-2026-05-09-pre-engagement-upgrade` at commit `62fbb072152fa3251789e4253fe4d1b70ac6c128`, so future changes can be rolled back to the pre-engagement stable version.
- Added `RESTORE_POINTS.md` with rollback commands and operating cautions.
- Added `ARCHITECTURE_REVIEW_2026-05-09.md` documenting current architecture, risks, completed remediation, and next recommended upgrades.
- Added a `student_learning_sessions` schema block to `upgrade_v4.sql` for online learning duration tracking.
- Added student learning heartbeat and summary APIs. The APIs fail gracefully when the SQL migration has not been run, so core upload/rating/comment flows are not blocked.
- Added a student-side “学习力竞技场” panel with personal online duration, personal rank, engagement score, group rank, individual leaderboard, and group leaderboard.
- Enabled learning heartbeats on gallery, upload, and work-detail pages to measure active study time across real student behavior.

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

### 2026-05-08 压力测试后整改

- 云端写入压力测试已在 DPU139 创建 6 个压测学生、12 个作品，其中包含图片与视频；上传、缩略图、评分、评论、信息反馈、备份快照、归档队列均完成接口级验证。
- 发现 Render 免费实例在并发访问教师仪表盘和缺失媒体导出时会反复扫描 Supabase Storage 与媒体清单，导致单次 502 和 p95 延迟过高。
- 新增重型运维查询短时缓存与同请求合并：`buildStorageSummary`、缺失媒体导出共用 30 秒缓存；作品新增、修改、删除、修复、转码、归档、清理后自动失效缓存。
- 修正压测报告里的快照大小统计，避免 JSON 响应被解析后显示为 0 字节。
- 本次整改目标：降低教师后台高并发运维接口对免费 Render 单实例的阻塞，减少课堂展示和学生访问被运维扫描拖慢的风险。
