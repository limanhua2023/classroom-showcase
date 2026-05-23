-- ============================================
-- ClassShow V5 course runtime progress upgrade
-- Run this in Supabase SQL Editor after upgrade_v4.sql.
-- ============================================

create table if not exists student_course_runtime_progress (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  course_slug text not null,
  runtime_version text,
  learning_mode text,
  current_chapter integer default 0,
  current_lesson integer default 0,
  current_stage text,
  progress_percent numeric(5,2) default 0,
  completed_chapters integer default 0,
  total_chapters integer default 0,
  xp integer default 0,
  active boolean default true,
  last_event text,
  page_path text,
  client_updated_at timestamptz,
  snapshot jsonb default '{}'::jsonb,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(activity_id, user_id, course_slug)
);

alter table student_course_runtime_progress add column if not exists runtime_version text;
alter table student_course_runtime_progress add column if not exists learning_mode text;
alter table student_course_runtime_progress add column if not exists current_chapter integer default 0;
alter table student_course_runtime_progress add column if not exists current_lesson integer default 0;
alter table student_course_runtime_progress add column if not exists current_stage text;
alter table student_course_runtime_progress add column if not exists progress_percent numeric(5,2) default 0;
alter table student_course_runtime_progress add column if not exists completed_chapters integer default 0;
alter table student_course_runtime_progress add column if not exists total_chapters integer default 0;
alter table student_course_runtime_progress add column if not exists xp integer default 0;
alter table student_course_runtime_progress add column if not exists active boolean default true;
alter table student_course_runtime_progress add column if not exists last_event text;
alter table student_course_runtime_progress add column if not exists page_path text;
alter table student_course_runtime_progress add column if not exists client_updated_at timestamptz;
alter table student_course_runtime_progress add column if not exists snapshot jsonb default '{}'::jsonb;
alter table student_course_runtime_progress add column if not exists last_seen_at timestamptz default now();
alter table student_course_runtime_progress add column if not exists created_at timestamptz default now();
alter table student_course_runtime_progress add column if not exists updated_at timestamptz default now();

update student_course_runtime_progress set current_chapter = 0 where current_chapter is null;
update student_course_runtime_progress set current_lesson = 0 where current_lesson is null;
update student_course_runtime_progress set progress_percent = 0 where progress_percent is null;
update student_course_runtime_progress set completed_chapters = 0 where completed_chapters is null;
update student_course_runtime_progress set total_chapters = 0 where total_chapters is null;
update student_course_runtime_progress set xp = 0 where xp is null;
update student_course_runtime_progress set active = true where active is null;
update student_course_runtime_progress set snapshot = '{}'::jsonb where snapshot is null;
update student_course_runtime_progress set last_seen_at = coalesce(last_seen_at, now()) where last_seen_at is null;
update student_course_runtime_progress set created_at = coalesce(created_at, now()) where created_at is null;
update student_course_runtime_progress set updated_at = coalesce(updated_at, now()) where updated_at is null;

with ranked as (
  select id,
         row_number() over (
           partition by activity_id, user_id, course_slug
           order by updated_at desc nulls last, last_seen_at desc nulls last, id
         ) as rn
  from student_course_runtime_progress
)
delete from student_course_runtime_progress p
using ranked x
where p.id = x.id and x.rn > 1;

create unique index if not exists student_course_runtime_progress_activity_user_slug_uidx
  on student_course_runtime_progress(activity_id, user_id, course_slug);

create index if not exists student_course_runtime_progress_activity_slug_idx
  on student_course_runtime_progress(activity_id, course_slug);

create index if not exists student_course_runtime_progress_activity_user_idx
  on student_course_runtime_progress(activity_id, user_id);

create index if not exists student_course_runtime_progress_last_seen_idx
  on student_course_runtime_progress(last_seen_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table public.student_course_runtime_progress to anon, authenticated, service_role;

alter table public.student_course_runtime_progress no force row level security;
alter table public.student_course_runtime_progress disable row level security;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_course_runtime_progress'
      and policyname = 'student_course_runtime_progress_server_access'
  ) then
    drop policy student_course_runtime_progress_server_access on public.student_course_runtime_progress;
  end if;
end $$;

create policy student_course_runtime_progress_server_access
  on public.student_course_runtime_progress
  for all
  to anon, authenticated
  using (true)
  with check (true);
