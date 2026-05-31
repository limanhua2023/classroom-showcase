# ClassShow 稳定版本备份清单

签收日期：2026-06-01  
稳定版本提交：`476d9dcac3474aa6d796aacdbdd620ef0af11aa9`

## 1. Git 还原点

已创建：

- 还原点分支：`restore/2026-06-01-stable-system-signoff`
- 还原点标签：`restore-2026-06-01-stable-system-signoff`

两者都指向提交：

- `476d9dcac3474aa6d796aacdbdd620ef0af11aa9`

## 2. 项目代码快照

生成时间：

- `2026-05-31T17:10:21.711Z`

本地文件：

- ZIP：`D:\Users\ACER\AIOT-TEST\project_backup\snapshots\20260531_171019\classshow_project_backup_20260531_171019.zip`
- Manifest：`D:\Users\ACER\AIOT-TEST\project_backup\snapshots\20260531_171019\classshow_project_backup_20260531_171019.manifest.json`

云端对象：

- ZIP：`classshow-system-backups/codebase/20260531_171019/classshow_project_backup_20260531_171019.zip`
- Manifest：`classshow-system-backups/codebase/20260531_171019/classshow_project_backup_20260531_171019.manifest.json`

校验值：

- ZIP SHA256：`9d9b828d390c724e13ad9ad2b61cbfdc916b4b75a5e3ec34e6b31668c8877f83`
- Manifest SHA256：`3be220286bf9f2dbc932822039cf79eeac0d38b82f163302e6f1eeb14a1fcacf`

说明：

- 文件数：`138`
- `include_secrets=false`

## 3. 加密 secrets 备份

生成时间：

- `2026-05-31T17:10:22.252Z`

本地文件：

- Bundle：`D:\Users\ACER\AIOT-TEST\secrets_backup\snapshots\20260531_171021\classshow_secrets_backup_20260531_171021.bundle.json`
- Manifest：`D:\Users\ACER\AIOT-TEST\secrets_backup\snapshots\20260531_171021\classshow_secrets_backup_20260531_171021.manifest.json`

云端对象：

- Bundle：`classshow-system-backups/secrets/20260531_171021/classshow_secrets_backup_20260531_171021.bundle.json`
- Manifest：`classshow-system-backups/secrets/20260531_171021/classshow_secrets_backup_20260531_171021.manifest.json`

校验值：

- Bundle SHA256：`92888fd9f23b8164b4ced131d5c4fbc73a7d48e1f17cba88a7ade51b276f8ea5`
- Manifest SHA256：`1d948e20bedb70771cdb8b6d2cc2db3b694da98849e9a0f716d917daff4c802e`

覆盖文件：

- `.env`
- `.env.local-backup.local`
- `.env.project-backup.local`
- `.env.render-backup.local`

说明：

- 文件数：`4`
- 云端上传：`成功`
- 缺失源文件：`0`

## 4. 业务数据本地备份

生成时间：

- `2026-05-31T17:10:34.735Z`

本地根目录：

- `D:\ClassShowBackup`

最新报告：

- `D:\ClassShowBackup\reports\latest-report.json`
- `D:\ClassShowBackup\reports\backup-report_2026-05-31T17-10-34-735Z.json`

本次结果：

- 状态：`ok`
- 存储桶：`submissions`
- 对象总数：`499`
- 新下载：`35`
- 已跳过：`464`
- 失败：`0`
- stale local files：`0`

表快照：

- `activities=173`
- `users=295`
- `student_roster=241`
- `submissions=294`
- `ratings=22`
- `comments=50`
- `views=0`
- `activity_feedback_likes=8`
- `student_learning_sessions=84`
- `student_course_runtime_progress=47`

课程总数：

- `29`

报告 SHA256：

- `d37815f41dc64eb3184565b5905d71033c80e0f8d5f112e62f9535db816fbf9b`

说明：

- 业务数据本地备份已成功
- `views` 表因当前结构不存在 `activity_id` 列，被脚本记录为 optional skip，不影响本次稳定备份完成

## 5. USB 二级备份

当前配置：

- `USB_BACKUP_ROOT=E:\ClassShowBackup`

本次状态：

- 未执行

原因：

- 当前机器未检测到 `E:\ClassShowBackup` 目标路径

说明：

- 当前已经具备“本地 + 云端”双份恢复点
- 如果后续插入 USB 目标盘，可再执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/usb-secondary-backup.ps1
```

## 6. 回滚建议

### 代码回滚

```powershell
git fetch origin
git checkout main
git reset --hard restore-2026-06-01-stable-system-signoff
git push --force-with-lease origin main
```

### 项目恢复

1. 解压项目 ZIP 到干净目录
2. 用加密 secrets bundle 恢复环境文件
3. 重新部署 Render
4. 如有需要，用本地业务数据备份恢复活动与媒体

### Secrets 恢复

```powershell
node scripts/restore-secrets-backup.mjs `
  --input "D:\Users\ACER\AIOT-TEST\secrets_backup\snapshots\20260531_171021\classshow_secrets_backup_20260531_171021.bundle.json" `
  --output ".\recovered_secrets" `
  --passphrase "<your-passphrase>"
```

## 7. 关联文档

- `SYSTEM_USAGE_MANUAL.md`
- `RESTORE_POINTS.md`
- `PROJECT_BACKUP_AGENT.md`
- `SECRETS_BACKUP_AGENT.md`
- `SYSTEM_DISASTER_RECOVERY_10_MINUTES.md`
