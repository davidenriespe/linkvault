-- =====================================================================
-- LinkVault · Migración 0004 · Endurecimiento tras los avisos de Supabase
-- =====================================================================

-- Las funciones de disparador no deben poder llamarse por /rest/v1/rpc.
-- Revocar EXECUTE no impide que se ejecuten como disparadores.
revoke execute on function public.set_updated_at()                  from public, anon, authenticated;
revoke execute on function public.links_before_write()              from public, anon, authenticated;
revoke execute on function public.links_after_write()               from public, anon, authenticated;
revoke execute on function public.job_details_before_write()        from public, anon, authenticated;
revoke execute on function public.job_details_after_write()         from public, anon, authenticated;
revoke execute on function public.settings_after_retention_change() from public, anon, authenticated;

-- Índice que cubre la clave foránea links.category_id
-- (acelera el ON DELETE SET NULL al borrar una categoría).
create index if not exists links_category_fk_idx on public.links (category_id);

-- Notas:
-- * get_system_status() sigue disponible para «authenticated» a propósito:
--   comprueba auth.uid() y sólo devuelve marcas de tiempo y contadores propios.
-- * integration_state tiene RLS sin políticas a propósito: sólo service_role accede.
