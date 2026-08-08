-- ROS6 — Puissance globale : édition autorisée pour R4 et R5 actifs (garde serveur)
-- Ne modifie aucune donnée métier. Autres permissions inchangées.

create or replace function public.ros6_is_active_r4_or_r5()
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
      and app_role in ('R4', 'R5')
      and status = 'Actif'
  )
  into ok;
  return coalesce(ok, false);
end;
$$;

revoke all on function public.ros6_is_active_r4_or_r5() from public;
grant execute on function public.ros6_is_active_r4_or_r5() to authenticated;

create or replace function public.ros6_guard_global_power_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_players jsonb;
  new_players jsonb;
begin
  -- auth.uid() null = rôle service / SQL admin (hors client navigateur)
  if auth.uid() is null or public.ros6_is_active_r4_or_r5() then
    return new;
  end if;

  old_players := coalesce(old.data #> '{stores,ros6_command_center_v1,players}', '[]'::jsonb);
  new_players := coalesce(new.data #> '{stores,ros6_command_center_v1,players}', '[]'::jsonb);

  -- Joueurs existants : la tranche de puissance globale a changé
  if exists (
    select 1
    from jsonb_array_elements(old_players) o
    join jsonb_array_elements(new_players) n
      on o->>'id' = n->>'id'
    where o->'globalPowerTierId' is distinct from n->'globalPowerTierId'
  ) then
    raise exception 'Seuls les R4 et R5 actifs peuvent modifier la puissance globale';
  end if;

  -- Nouveaux joueurs créés déjà avec une puissance globale renseignée
  if exists (
    select 1
    from jsonb_array_elements(new_players) n
    where coalesce(nullif(trim(n->>'globalPowerTierId'), ''), '') <> ''
      and not exists (
        select 1
        from jsonb_array_elements(old_players) o
        where o->>'id' = n->>'id'
      )
  ) then
    raise exception 'Seuls les R4 et R5 actifs peuvent modifier la puissance globale';
  end if;

  return new;
end;
$$;

drop trigger if exists ros6_guard_global_power_edit_trg on public.ros6_state;
create trigger ros6_guard_global_power_edit_trg
  before update on public.ros6_state
  for each row
  execute procedure public.ros6_guard_global_power_edit();
