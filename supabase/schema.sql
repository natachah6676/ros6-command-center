-- ROS6 Command Center — schéma partagé (à exécuter dans le SQL Editor Supabase)
-- Auth : création des comptes via Edge Function admin-create-user (Service Role serveur)
-- Voir aussi : supabase/migrations/20260804_admin_create_user.sql et SUPABASE-USER-SETUP.md

create table if not exists public.ros6_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id)
);

insert into public.ros6_state (id, data, version)
values ('main', '{}'::jsonb, 0)
on conflict (id) do nothing;

alter table public.ros6_state enable row level security;

drop policy if exists "ros6_state_select_authenticated" on public.ros6_state;
create policy "ros6_state_select_authenticated"
  on public.ros6_state
  for select
  to authenticated
  using (true);

drop policy if exists "ros6_state_insert_authenticated" on public.ros6_state;
create policy "ros6_state_insert_authenticated"
  on public.ros6_state
  for insert
  to authenticated
  with check (true);

drop policy if exists "ros6_state_update_authenticated" on public.ros6_state;
create policy "ros6_state_update_authenticated"
  on public.ros6_state
  for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Profils utilisateurs
-- ---------------------------------------------------------------------------

create table if not exists public.ros6_user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  player_id text null,
  app_role text not null default 'R4'
    check (app_role in ('R4', 'R5')),
  status text not null default 'Actif'
    check (status in ('Actif', 'Désactivé')),
  last_sign_in_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ros6_user_profiles
  add column if not exists last_sign_in_at timestamptz null;

create index if not exists ros6_user_profiles_player_id_idx
  on public.ros6_user_profiles (player_id);

create index if not exists ros6_user_profiles_email_idx
  on public.ros6_user_profiles (email);

drop index if exists ros6_user_profiles_player_unique;
create unique index ros6_user_profiles_player_unique
  on public.ros6_user_profiles (player_id)
  where player_id is not null and length(trim(player_id)) > 0;

create or replace function public.ros6_is_active_r5()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists (
    select 1
    from public.ros6_user_profiles
    where user_id = auth.uid()
      and app_role = 'R5'
      and status = 'Actif'
  )
  into ok;
  return coalesce(ok, false);
end;
$$;

revoke all on function public.ros6_is_active_r5() from public;
grant execute on function public.ros6_is_active_r5() to authenticated;

create or replace function public.ros6_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and not public.ros6_is_active_r5() then
    if new.app_role is distinct from old.app_role then
      raise exception 'Seul un R5 peut modifier le rôle';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'Seul un R5 peut modifier le joueur associé';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Seul un R5 peut modifier le statut';
    end if;
    new.email := coalesce(nullif(trim(new.email), ''), old.email);
  end if;

  if tg_op = 'INSERT' and not public.ros6_is_active_r5() then
    if exists (
      select 1 from public.ros6_user_profiles
      where app_role = 'R5' and status = 'Actif'
    ) then
      new.app_role := 'R4';
    end if;
    if new.user_id is distinct from auth.uid() then
      raise exception 'Seul un R5 peut créer un profil pour un autre utilisateur';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ros6_profiles_guard_trg on public.ros6_user_profiles;
create trigger ros6_profiles_guard_trg
  before insert or update on public.ros6_user_profiles
  for each row
  execute procedure public.ros6_profiles_guard();

alter table public.ros6_user_profiles enable row level security;

drop policy if exists "ros6_profiles_select_authenticated" on public.ros6_user_profiles;
create policy "ros6_profiles_select_authenticated"
  on public.ros6_user_profiles
  for select
  to authenticated
  using (true);

drop policy if exists "ros6_profiles_insert_own" on public.ros6_user_profiles;
drop policy if exists "ros6_profiles_insert_own_or_r5" on public.ros6_user_profiles;
create policy "ros6_profiles_insert_own"
  on public.ros6_user_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ros6_profiles_update_own_or_r5" on public.ros6_user_profiles;
create policy "ros6_profiles_update_own_or_r5"
  on public.ros6_user_profiles
  for update
  to authenticated
  using (auth.uid() = user_id or public.ros6_is_active_r5())
  with check (auth.uid() = user_id or public.ros6_is_active_r5());

-- Création / association multi-comptes : Edge Function admin-create-user
-- (Service Role Key uniquement côté serveur — jamais dans le navigateur)

NOTIFY pgrst, 'reload schema';
