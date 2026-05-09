# ClassShow 还原点记录

## 2026-05-09 课业竞技与学习时长升级前

- 还原点分支：`restore/2026-05-09-pre-engagement-upgrade`
- 还原点标签：`restore-2026-05-09-pre-engagement-upgrade`
- 对应提交：`62fbb072152fa3251789e4253fe4d1b70ac6c128`
- 状态说明：这是新增学习时长、个人排行、小组排行之前的稳定版本。

### 回滚步骤

仅在确认需要回到该版本时执行：

```powershell
git fetch origin
git checkout main
git reset --hard restore-2026-05-09-pre-engagement-upgrade
git push --force-with-lease origin main
```

### 注意事项

- 回滚会把 `main` 恢复到还原点提交，回滚前应先导出 Supabase 关键数据和最新媒体归档状态。
- 不要把临时测试文件、OAuth 密钥、Render 环境变量截图提交到仓库。
- 每次大改前继续创建新的 `restore/YYYY-MM-DD-说明` 分支和同名标签。
