-- La Muse : autorise uniquement le store ros6_muse_v1 dans ros6_push_stores.
-- Aucune policy RLS nouvelle. Gardes joueurs, Ruche et révisions inchangées.
-- L'accès reste réservé aux R4/R5 actifs via ros6_is_active_r4_or_r5.
-- À exécuter manuellement dans le SQL Editor Supabase. Ne pas déployer automatiquement.

begin;

create or replace function public.ros6_push_stores(
  p_stores jsonb,
  p_base_revisions jsonb,
  p_client_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.ros6_state%rowtype;
  v_allowed text[] := array[
    'ros6_command_center_v1',
    'ros6_train_v1',
    'ros6_ruche_v1',
    'ros6_tempete_v1',
    'ros6_muse_v1'
  ];
  v_key text;
  v_current integer;
  v_base integer;
  v_data jsonb;
  v_revisions jsonb;
  v_stored jsonb;
  v_incoming jsonb;
  v_status jsonb;
  v_control jsonb;
  v_client text := nullif(left(coalesce(p_client_id, ''), 80), '');
  v_old integer;
  v_new integer;
  v_action text;
  v_detail jsonb;
  v_store_count integer := 0;
  v_ready jsonb := '{}'::jsonb;
  v_guard jsonb;
  v_delete_log jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.ros6_is_active_r4_or_r5() then
    raise exception 'acces ROS6 refuse' using errcode = '42501';
  end if;
  if p_stores is null or jsonb_typeof(p_stores) <> 'object' then
    raise exception 'p_stores must be an object' using errcode = '22023';
  end if;
  if p_base_revisions is not null and jsonb_typeof(p_base_revisions) <> 'object' then
    raise exception 'p_base_revisions must be an object' using errcode = '22023';
  end if;

  select * into v_row
  from public.ros6_state
  where id = 'main'
  for update;
  if not found then
    raise exception 'ros6_state main missing';
  end if;

  select count(*) into v_store_count from jsonb_object_keys(p_stores);
  if v_store_count = 0 then
    raise exception 'no store to write' using errcode = '22023';
  end if;

  v_revisions := coalesce(v_row.store_revisions, '{}'::jsonb);
  if jsonb_typeof(v_revisions) <> 'object' then
    v_revisions := '{}'::jsonb;
  end if;

  for v_key in select jsonb_object_keys(p_stores) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'store not allowed' using errcode = '22023';
    end if;
    if jsonb_typeof(p_stores->v_key) <> 'object' then
      raise exception 'store payload must be a json object' using errcode = '22023';
    end if;
    v_current := coalesce((v_revisions->>v_key)::integer, 0);
    v_base := null;
    if p_base_revisions is not null and (p_base_revisions ? v_key) then
      begin
        v_base := (p_base_revisions->>v_key)::integer;
      exception
        when others then
          v_base := null;
      end;
    end if;
    if v_base is null or v_base is distinct from v_current then
      insert into public.ros6_change_log (
        user_id, store_key, old_revision, new_revision, action, client_id, detail
      ) values (
        v_uid, v_key, v_current, null, 'revision_conflict', v_client,
        jsonb_build_object('expected', v_base, 'actual', v_current)
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'revision_conflict',
        'store', v_key,
        'expected', v_base,
        'actual', v_current,
        'revisions', v_revisions,
        'version', v_row.version,
        'data', v_row.data
      );
    end if;
  end loop;

  -- Validation complète avant toute écriture de ros6_state.
  -- Un store refusé annule tout l'appel : aucun autre store du même appel n'est écrit.
  -- Tous les joueurs du centre de commandement sont examinés ; le premier conflit
  -- rejette le store entier, il n'applique pas les joueurs précédents.
  for v_key in select jsonb_object_keys(p_stores) loop
    v_stored := coalesce(v_row.data #> array['stores', v_key], '{}'::jsonb);
    if jsonb_typeof(v_stored) <> 'object' then
      v_stored := '{}'::jsonb;
    end if;
    v_incoming := p_stores->v_key;
    v_status := null;
    v_control := null;
    if v_key = 'ros6_command_center_v1' then
      v_guard := public.ros6_command_center_write(v_stored, v_incoming);
      if coalesce((v_guard->>'ok')::boolean, false) then
        v_incoming := v_guard->'store';
        if jsonb_typeof(v_guard->'deletion') = 'object' then
          v_delete_log := v_delete_log || jsonb_build_array(v_guard->'deletion');
        end if;
        v_status := null;
      else
        v_status := v_guard - 'ok' - 'store';
      end if;
    elsif v_key = 'ros6_ruche_v1' then
      v_control := public.ros6_control_write_guard(v_stored, v_incoming);
    end if;

    if v_status is not null then
      insert into public.ros6_change_log (
        user_id, store_key, old_revision, new_revision, action, client_id, detail
      ) values (
        v_uid, v_key, coalesce((v_revisions->>v_key)::integer, 0), null,
        v_status->>'code', v_client, v_status
      );
      return jsonb_build_object(
        'ok', false,
        'code', v_status->>'code',
        'store', v_key,
        'detail', v_status,
        'revisions', v_revisions,
        'version', v_row.version,
        'data', v_row.data
      );
    end if;

    if v_control is not null
      and coalesce((v_control->>'acceptReset')::boolean, false)
      and exists (
        select 1
        from public.ros6_change_log
        where action = 'reset'
          and detail->>'intentAtMs' = (public.ros6_iso_ms(v_incoming #>> '{controlIntent,at}'))::text
      ) then
      insert into public.ros6_change_log (
        user_id, store_key, old_revision, new_revision, action, client_id, detail
      ) values (
        v_uid, v_key, coalesce((v_revisions->>v_key)::integer, 0), null,
        'control_reset_required', v_client,
        jsonb_build_object(
          'reason', 'intent_reuse',
          'intentAt', v_incoming #>> '{controlIntent,at}',
          'placementCountBefore', v_control->'placementCountBefore'
        )
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'control_reset_required',
        'store', v_key,
        'detail', jsonb_build_object('reason', 'intent_reuse'),
        'revisions', v_revisions,
        'version', v_row.version,
        'data', v_row.data
      );
    end if;

    if v_control is not null and coalesce((v_control->>'acceptReset')::boolean, false) is not true then
      insert into public.ros6_change_log (
        user_id, store_key, old_revision, new_revision, action, client_id, detail
      ) values (
        v_uid, v_key, coalesce((v_revisions->>v_key)::integer, 0), null,
        'control_reset_required', v_client,
        jsonb_build_object(
          'placementCountBefore', v_control->'placementCountBefore',
          'placementCountAfter', v_control->'placementCountAfter'
        )
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'control_reset_required',
        'store', v_key,
        'detail', jsonb_build_object(
          'placementCountBefore', v_control->'placementCountBefore',
          'placementCountAfter', v_control->'placementCountAfter'
        ),
        'revisions', v_revisions,
        'version', v_row.version,
        'data', v_row.data
      );
    end if;
    v_ready := jsonb_set(v_ready, array[v_key], v_incoming, true);
  end loop;

  v_data := coalesce(v_row.data, '{}'::jsonb);
  if jsonb_typeof(v_data) <> 'object' then
    v_data := '{}'::jsonb;
  end if;
  if v_data->'stores' is null or jsonb_typeof(v_data->'stores') <> 'object' then
    v_data := jsonb_set(v_data, '{stores}', '{}'::jsonb, true);
  end if;

  for v_key in select jsonb_object_keys(p_stores) loop
    v_old := coalesce((v_revisions->>v_key)::integer, 0);
    v_new := v_old + 1;
    v_stored := coalesce(v_row.data #> array['stores', v_key], '{}'::jsonb);
    v_incoming := v_ready->v_key;
    v_control := case
      when v_key = 'ros6_ruche_v1' then public.ros6_control_write_guard(v_stored, v_incoming)
      else null
    end;
    if v_control is not null and coalesce((v_control->>'acceptReset')::boolean, false) then
      v_action := 'reset';
      v_detail := v_control || jsonb_build_object(
        'intentAt', v_incoming #>> '{controlIntent,at}',
        'intentAtMs', (public.ros6_iso_ms(v_incoming #>> '{controlIntent,at}'))::text
      );
      if octet_length(v_detail::text) > 150000 then
        v_detail := jsonb_build_object(
          'acceptReset', true,
          'placementCountBefore', v_control->'placementCountBefore',
          'placementCountAfter', v_control->'placementCountAfter',
          'intentAt', v_incoming #>> '{controlIntent,at}',
          'intentAtMs', (public.ros6_iso_ms(v_incoming #>> '{controlIntent,at}'))::text,
          'snapshotOmitted', true
        );
      end if;
    else
      v_action := 'write';
      v_detail := '{}'::jsonb;
      if v_key = 'ros6_command_center_v1' then
        v_detail := jsonb_build_object(
          'playerCountBefore', jsonb_array_length(coalesce(v_stored->'players', '[]'::jsonb)),
          'playerCountAfter', jsonb_array_length(coalesce(v_incoming->'players', '[]'::jsonb))
        );
      end if;
    end if;

    v_revisions := jsonb_set(v_revisions, array[v_key], to_jsonb(v_new), true);
    v_data := jsonb_set(v_data, array['stores', v_key], v_incoming, true);
    insert into public.ros6_change_log (
      user_id, store_key, old_revision, new_revision, action, client_id, detail
    ) values (
      v_uid, v_key, v_old, v_new, v_action, v_client, v_detail
    );
    if v_key = 'ros6_command_center_v1'
      and jsonb_typeof(v_delete_log) = 'array'
      and jsonb_array_length(v_delete_log) > 0 then
      insert into public.ros6_change_log (
        user_id, store_key, old_revision, new_revision, action, client_id, detail
      ) values (
        v_uid, v_key, v_old, v_new, 'player_delete', v_client, v_delete_log->0
      );
    end if;
  end loop;

  -- version globale volontairement figée : elle ne doit plus rendre un autre store « plus récent ».
  update public.ros6_state
  set data = v_data,
      store_revisions = v_revisions,
      updated_at = now(),
      updated_by = v_uid
  where id = 'main';

  return jsonb_build_object(
    'ok', true,
    'code', 'applied',
    'revisions', v_revisions,
    'version', v_row.version,
    'data', v_data
  );
end;
$fn$;

revoke all on function public.ros6_command_center_write(jsonb, jsonb) from public;
revoke all on function public.ros6_players_status_conflict(jsonb, jsonb) from public;
revoke all on function public.ros6_push_stores(jsonb, jsonb, text) from public;
grant execute on function public.ros6_push_stores(jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
