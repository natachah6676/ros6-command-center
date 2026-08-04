-- ---------------------------------------------------------------------------
-- FIX : permettre au R5 de créer un profil (RPC SECURITY DEFINER)
-- À exécuter dans le SQL Editor Supabase (RLS reste activé)
-- ---------------------------------------------------------------------------

-- Contrôle R5 fiable (bypass RLS via SECURITY DEFINER)
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

-- RPC : création de profil par le R5 (droits serveur, contrôles métier conservés)
create or replace function public.ros6_admin_create_profile(
  p_user_id uuid,
  p_email text,
  p_player_id text default null,
  p_app_role text default 'R4',
  p_status text default 'Actif'
)
returns public.ros6_user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.ros6_user_profiles;
  clean_email text;
  clean_player text;
  clean_role text;
  clean_status text;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;

  if not public.ros6_is_active_r5() then
    raise exception 'Seul un R5 actif peut créer un profil utilisateur';
  end if;

  if p_user_id is null then
    raise exception 'user_id manquant';
  end if;

  clean_email := lower(trim(coalesce(p_email, '')));
  clean_player := nullif(trim(coalesce(p_player_id, '')), '');
  clean_role := coalesce(nullif(trim(coalesce(p_app_role, '')), ''), 'R4');
  clean_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Actif');

  if clean_email = '' then
    raise exception 'E-mail manquant';
  end if;

  if clean_role not in ('R4', 'R5') then
    raise exception 'Rôle invalide (R4 ou R5)';
  end if;

  if clean_status not in ('Actif', 'Désactivé') then
    raise exception 'Statut invalide';
  end if;

  if exists (
    select 1 from public.ros6_user_profiles where user_id = p_user_id
  ) then
    raise exception 'Un profil existe déjà pour cet utilisateur';
  end if;

  if exists (
    select 1 from public.ros6_user_profiles
    where lower(email) = clean_email
  ) then
    raise exception 'Un profil existe déjà pour cet e-mail';
  end if;

  if clean_player is not null and exists (
    select 1 from public.ros6_user_profiles
    where player_id = clean_player
  ) then
    raise exception 'Ce joueur est déjà associé à un autre compte';
  end if;

  insert into public.ros6_user_profiles (
    user_id,
    email,
    player_id,
    app_role,
    status,
    updated_at
  )
  values (
    p_user_id,
    clean_email,
    clean_player,
    clean_role,
    clean_status,
    now()
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.ros6_admin_create_profile(uuid, text, text, text, text) from public;
grant execute on function public.ros6_admin_create_profile(uuid, text, text, text, text) to authenticated;

-- Policies RLS : conserver la sécurité, clarifier insert propre + R5
drop policy if exists "ros6_profiles_insert_own" on public.ros6_user_profiles;
drop policy if exists "ros6_profiles_insert_own_or_r5" on public.ros6_user_profiles;

create policy "ros6_profiles_insert_own"
  on public.ros6_user_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- (Les inserts « pour un autre user_id » passent par ros6_admin_create_profile SECURITY DEFINER)
