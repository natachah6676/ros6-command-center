-- SELECT uniquement. Ne modifie rien.
-- Exécuter le bloc AVANT, noter les chiffres, appliquer la migration, exécuter le bloc APRÈS.
-- data_md5, version, player_count et control_grid_cells doivent être identiques.

-- ===== AVANT MIGRATION =====
-- La colonne store_revisions et la table ros6_change_log ne doivent pas encore exister,
-- ou store_revisions est encore '{}'.

select
  id,
  version,
  updated_at,
  updated_by,
  md5(data::text) as data_md5,
  jsonb_array_length(coalesce(data #> '{stores,ros6_command_center_v1,players}', '[]'::jsonb)) as player_count
from public.ros6_state
where id = 'main';

select count(*) as control_grid_cells
from public.ros6_state s
cross join lateral jsonb_array_elements(coalesce(s.data #> '{stores,ros6_ruche_v1,control,grid}', '[]'::jsonb)) as grid_row
cross join lateral jsonb_array_elements(grid_row) as cell
where s.id = 'main'
  and jsonb_typeof(cell) = 'string'
  and (cell #>> '{}') not in ('FREE', 'MARSHAL', '');

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'ros6_state'
order by policyname;

select to_regclass('public.ros6_change_log') as change_log_table;

-- ===== APRÈS MIGRATION =====
-- Relancer les trois premiers SELECT : data_md5, version, player_count, control_grid_cells inchangés.
-- Puis :

select store_revisions
from public.ros6_state
where id = 'main';
-- Attendu à l'instant de la migration, avant toute RPC :
-- {"ros6_command_center_v1": 0, "ros6_ruche_v1": 0, "ros6_tempete_v1": 0, "ros6_train_v1": 0}

select count(*) as log_rows_at_migration
from public.ros6_change_log;
-- Attendu : 0

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'ros6_state'
order by policyname;
-- Attendu : uniquement ros6_state_select_authenticated / SELECT

select has_function_privilege('authenticated', 'public.ros6_push_stores(jsonb, jsonb, text)', 'execute') as rpc_execute,
       has_table_privilege('authenticated', 'public.ros6_state', 'update') as direct_update,
       has_table_privilege('authenticated', 'public.ros6_state', 'select') as direct_select;
-- Attendu : rpc_execute true, direct_update false, direct_select true
