-- ROLLBACK de 20261005_ros6_store_revisions.sql
-- Ne pas exécuter par erreur : ceci retire la protection et rouvre l'UPDATE direct.
-- Ne modifie pas data, version, joueurs, Ruche, ni train_history_*.
-- Les révisions et le journal sont supprimés. Les stores restent dans ros6_state.data.

drop trigger if exists ros6_change_log_no_truncate on public.ros6_change_log;
drop trigger if exists ros6_change_log_no_update on public.ros6_change_log;
drop function if exists public.ros6_change_log_append_only();
drop table if exists public.ros6_change_log;

drop function if exists public.ros6_push_stores(jsonb, jsonb, text);
drop function if exists public.ros6_control_write_guard(jsonb, jsonb);
drop function if exists public.ros6_players_status_conflict(jsonb, jsonb);
drop function if exists public.ros6_control_placement_count(jsonb);
drop function if exists public.ros6_iso_ms(text);

alter table public.ros6_state
  drop column if exists store_revisions;

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

grant select, insert, update on table public.ros6_state to authenticated;

notify pgrst, 'reload schema';
