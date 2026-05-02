-- ============================================
-- ClassShow 课堂作品秀 - 数据库初始化
-- 请在 Supabase SQL Editor 中运行此脚本
-- ============================================

-- 清理旧表
drop table if exists views cascade;
drop table if exists ratings cascade;
drop table if exists submissions cascade;
drop table if exists users cascade;
drop table if exists activities cascade;
drop table if exists assignments cascade;

-- 1. 课堂活动表
create table activities (
  id uuid primary key default gen_random_uuid(),
  course_name text not null,
  class_name text not null,
  activity_name text not null,
  description text,
  invite_code text unique not null,
  teacher_password text not null,
  upload_open boolean default true,
  voting_open boolean default false,
  show_live_ranking boolean default false,
  created_at timestamptz default now(),
  ended_at timestamptz
);

-- 2. 学生用户表
create table users (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  name text not null,
  student_id text not null,
  class_name text not null,
  group_name text,
  created_at timestamptz default now(),
  unique(activity_id, student_id)
);

-- 3. 作品表
create table submissions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  anonymous_code text not null,
  title text not null,
  description text,
  image_url text not null,
  upload_time timestamptz default now(),
  last_modified_time timestamptz default now(),
  edit_count int default 0,
  view_count int default 0,
  rating_count int default 0,
  average_rating numeric(3,2) default 0,
  composite_score numeric(5,2) default 0,
  teacher_score numeric(3,1),
  final_score numeric(5,2),
  rank int,
  status text default 'visible',
  is_pinned boolean default false,
  is_teacher_selected boolean default false
);

-- 4. 评分表
create table ratings (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  submission_id uuid references submissions(id) on delete cascade,
  rater_user_id uuid references users(id) on delete cascade,
  score int not null check (score >= 1 and score <= 5),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(submission_id, rater_user_id)
);

-- 5. 浏览记录表
create table views (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references submissions(id) on delete cascade,
  viewer_user_id uuid references users(id) on delete cascade,
  viewed_at timestamptz default now(),
  is_valid boolean default false
);

-- 关闭行级安全 (MVP阶段)
alter table activities disable row level security;
alter table users disable row level security;
alter table submissions disable row level security;
alter table ratings disable row level security;
alter table views disable row level security;

-- 创建图片存储桶
insert into storage.buckets (id, name, public) 
values ('submissions', 'submissions', true)
on conflict do nothing;

-- 存储策略：允许上传和读取
create policy "allow_upload" on storage.objects for insert to anon with check (bucket_id = 'submissions');
create policy "allow_read" on storage.objects for select to anon using (bucket_id = 'submissions');
create policy "allow_delete" on storage.objects for delete to anon using (bucket_id = 'submissions');
