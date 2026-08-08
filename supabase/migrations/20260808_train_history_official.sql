-- Historique officiel Train (occurrences Conducteur/VIP depuis le début WarOps)
-- Appliqué sur le projet Supabase : train_history_weeks / train_history_days

create table if not exists public.train_history_weeks (
  id text primary key,
  week_key text not null unique,
  week_label text not null default '',
  week_start_date date null,
  week_end_date date null,
  source text not null default 'close'
    check (source in ('close', 'init', 'correction')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id)
);

create table if not exists public.train_history_days (
  id text primary key,
  week_id text not null references public.train_history_weeks (id) on delete cascade,
  day_key text not null
    check (day_key in ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche')),
  day_label text not null default '',
  day_date date null,
  conductor_player_id text null,
  conductor_pseudo text null,
  vip_player_id text null,
  vip_pseudo text null,
  unique (week_id, day_key)
);

create index if not exists train_history_days_week_id_idx
  on public.train_history_days (week_id);
create index if not exists train_history_days_conductor_idx
  on public.train_history_days (conductor_player_id);
create index if not exists train_history_days_vip_idx
  on public.train_history_days (vip_player_id);
create index if not exists train_history_weeks_start_idx
  on public.train_history_weeks (week_start_date);

alter table public.train_history_weeks enable row level security;
alter table public.train_history_days enable row level security;

drop policy if exists train_history_weeks_select on public.train_history_weeks;
create policy train_history_weeks_select
  on public.train_history_weeks for select to authenticated using (true);

drop policy if exists train_history_weeks_insert on public.train_history_weeks;
create policy train_history_weeks_insert
  on public.train_history_weeks for insert to authenticated
  with check (public.ros6_is_active_r4_or_r5());

drop policy if exists train_history_weeks_update on public.train_history_weeks;
create policy train_history_weeks_update
  on public.train_history_weeks for update to authenticated
  using (public.ros6_is_active_r4_or_r5())
  with check (public.ros6_is_active_r4_or_r5());

drop policy if exists train_history_weeks_delete on public.train_history_weeks;
create policy train_history_weeks_delete
  on public.train_history_weeks for delete to authenticated
  using (public.ros6_is_active_r5());

drop policy if exists train_history_days_select on public.train_history_days;
create policy train_history_days_select
  on public.train_history_days for select to authenticated using (true);

drop policy if exists train_history_days_insert on public.train_history_days;
create policy train_history_days_insert
  on public.train_history_days for insert to authenticated
  with check (public.ros6_is_active_r4_or_r5());

drop policy if exists train_history_days_update on public.train_history_days;
create policy train_history_days_update
  on public.train_history_days for update to authenticated
  using (public.ros6_is_active_r4_or_r5())
  with check (public.ros6_is_active_r4_or_r5());

drop policy if exists train_history_days_delete on public.train_history_days;
create policy train_history_days_delete
  on public.train_history_days for delete to authenticated
  using (public.ros6_is_active_r4_or_r5());
