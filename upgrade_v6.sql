alter table if exists activities
  add column if not exists economics_unlock_m2 boolean not null default false,
  add column if not exists economics_unlock_m3 boolean not null default false,
  add column if not exists economics_unlock_m4 boolean not null default false,
  add column if not exists economics_unlock_m5 boolean not null default false;
