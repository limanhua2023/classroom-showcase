-- ============================================
-- ClassShow 课堂作品秀 V3 - 升级脚本
-- 请在 Supabase SQL Editor 中运行此脚本
-- ============================================

-- 1. 为活动表增加“是否开启评论”开关（默认关闭）
alter table activities add column if not exists comments_open boolean default false;

-- 2. 创建评论表
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  submission_id uuid references submissions(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- 3. 作品表增加评论数统计
alter table submissions add column if not exists comment_count int default 0;

-- 4. 关闭行级安全 (MVP阶段)
alter table comments disable row level security;
