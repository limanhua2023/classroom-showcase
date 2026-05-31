# ClassShow 超级管理员简明手册

更新时间：2026-06-01  
适用对象：系统管理员 / 课程平台主管

## 1. 超管入口

- 超级管理员入口：`https://classroom-showcase.onrender.com/admin`

登录只需要：

- 超级管理员密码

不需要邀请码。

## 2. 超级管理员主要负责什么

超级管理员只负责系统层，不负责具体课堂教学操作。

核心职责：

- 管理课程注册表
- 决定课程是否上架
- 管理课程顺序
- 查看备份与恢复状态
- 查看存储与流量状态
- 在故障时执行恢复

## 3. 课程注册表怎么管

进入超管页后，主要管理的是“课程注册表”。

你可以：

- 新增课程
- 修改课程名称和 slug
- 启用课程
- 停用课程
- 调整课程排序
- 挂载 scaffold

当前建议规则：

- 只有准备好的课程才启用
- 暂时不用的课程先停用，不要删除
- 对外名称保持统一，不要并存多个旧别名

## 4. 现在的正式入口

学生：

- `https://classshow-student.pages.dev/student`
- `https://classshow-student.pages.dev/economics`

教师：

- `https://classroom-showcase.onrender.com/teacher`

超级管理员：

- `https://classroom-showcase.onrender.com/admin`

## 5. 平时最重要看哪几个面板

优先级最高的是四块：

- 备份与恢复总览
- 项目代码快照状态
- 加密 secrets 备份状态
- Render egress / R2 / 热存储状态

这些面板主要用于回答四个问题：

1. 现在系统是否健康
2. 当前是否有可恢复的稳定备份
3. 哪一部分开始吃流量或吃存储
4. 当前是否适合继续上线新功能

## 6. 发布前检查

每次重要上线前，建议至少确认：

1. 学生站可正常打开
2. 教师后台可正常登录
3. 超级管理员登录正常
4. `/api/health` 正常
5. 最近一次项目代码备份正常
6. 最近一次 secrets 备份正常
7. 本地业务数据备份正常

如需严格验收，使用：

```powershell
$env:CLASSSHOW_ENABLE_SUPER_ADMIN_SMOKE='1'
$env:CLASSSHOW_SUPER_ADMIN_PASSWORD='你的超管密码'
node scripts/check-public-readiness.mjs https://classshow-student.pages.dev https://classroom-showcase.onrender.com
```

当前稳定签收结果：

- `21/21 passed`

## 7. 出现异常时怎么判断

### 学生进不去课程

先判断是课程级问题还是活动级问题：

- 如果只有某一班进不去，先让教师检查实名名单和邀请码
- 如果所有学生都进不去，再检查学生站、后端健康、课程注册表

### 教师后台异常

优先检查：

- Render 服务是否在线
- `/api/health`
- Supabase 是否可用

### 流量异常升高

优先看：

- egress 画像面板
- 最近事件
- 节流清单

如果学生流量大幅增加，先确认学生前端是否仍然主要走 Cloudflare Pages，而不是回打 Render。

## 8. 什么时候该做稳定备份

建议在这些时点做一套完整稳定备份：

- 新课程上线前
- 大改数据库结构前
- 调整鉴权逻辑前
- 切换部署环境前
- 系统验收通过后

当前已建立稳定版本记录：

- `STABLE_BACKUP_2026-06-01.md`
- `restore/2026-06-01-stable-system-signoff`
- `restore-2026-06-01-stable-system-signoff`

## 9. 如果升级失败，怎么回到稳定版

代码回滚：

```powershell
git fetch origin
git checkout main
git reset --hard restore-2026-06-01-stable-system-signoff
git push --force-with-lease origin main
```

然后按需恢复：

- 项目代码快照
- secrets bundle
- 本地业务数据备份

详细路径和校验值见：

- `STABLE_BACKUP_2026-06-01.md`

## 10. 超管日常建议

建议保持三个原则：

- 不在生产上直接做无记录的大改
- 每次大改前先建 restore point
- 先停用，再删除

尤其是课程注册表：

- 课程名不要频繁改
- slug 一旦对外使用，尽量保持稳定
- 旧别名要及时清理，避免统计混乱

## 11. 关联文档

- `SYSTEM_USAGE_MANUAL.md`
- `TEACHER_QUICK_MANUAL.md`
- `STABLE_BACKUP_2026-06-01.md`
- `RESTORE_POINTS.md`
- `SYSTEM_DISASTER_RECOVERY_10_MINUTES.md`
- `SUPER_ADMIN_LOCAL_SMOKE.md`

