-- ROS6 Command Center — schéma partagé (à exécuter dans le SQL Editor Supabase)
-- Auth : comptes créés manuellement par le R5 (pas d’inscription publique dans l’app)

create table if not exists public.ros6_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id)
);

-- Ligne unique attendue par l’application
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

-- Pas de DELETE depuis le client (aucune suppression automatique)
