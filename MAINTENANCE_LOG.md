# ClassShow 维护日志

## 2026-05-08

### 运维压测与稳定性补强

- 新增 `npm run ops:pressure`，用于对线上或本地活动执行受控压测、上传测试、交互测试、备份快照检查、归档队列检查，并输出 JSON 报告。
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
