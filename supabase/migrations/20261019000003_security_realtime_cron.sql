-- =====================================================================
-- LinkVault · Migración 0003 · Seguridad (RLS + permisos),
-- Realtime y tarea programada de archivado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Row Level Security en todas las tablas
-- ---------------------------------------------------------------------
alter table public.settings          enable row level security;
alter table public.categories        enable row level security;
alter table public.links             enable row level security;
alter table public.job_details       enable row level security;
alter table public.link_history      enable row level security;
alter table public.whatsapp_senders  enable row level security;
alter table public.webhook_events    enable row level security;
alter table public.integration_state enable row level security;

-- Permisos explícitos: el rol anónimo no accede a nada.
revoke all on public.settings, public.categories, public.links, public.job_details,
              public.link_history, public.whatsapp_senders, public.webhook_events,
              public.integration_state
  from anon, authenticated;

grant select, update                  on public.settings         to authenticated;
grant select, insert, update, delete  on public.categories       to authenticated;
grant select, insert, update, delete  on public.links            to authenticated;
grant select, insert, update, delete  on public.job_details      to authenticated;
grant select                          on public.link_history     to authenticated;
grant select, insert, update, delete  on public.whatsapp_senders to authenticated;
grant select                          on public.webhook_events   to authenticated;
-- integration_state: sin permisos para clientes (sólo service_role).

grant all on public.settings, public.categories, public.links, public.job_details,
             public.link_history, public.whatsapp_senders, public.webhook_events,
             public.integration_state
  to service_role;

-- settings
create policy "settings: lectura propia" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings: edición propia" on public.settings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- categories
create policy "categories: lectura propia" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories: alta propia" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories: edición propia" on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories: borrado propio (no predeterminadas)" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id and not is_default);

-- links
create policy "links: lectura propia" on public.links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "links: alta propia" on public.links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "links: edición propia" on public.links
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "links: borrado propio" on public.links
  for delete to authenticated using ((select auth.uid()) = user_id);

-- job_details
create policy "job_details: lectura propia" on public.job_details
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "job_details: alta propia" on public.job_details
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "job_details: edición propia" on public.job_details
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "job_details: borrado propio" on public.job_details
  for delete to authenticated using ((select auth.uid()) = user_id);

-- link_history (sólo lectura; lo escriben los disparadores)
create policy "link_history: lectura propia" on public.link_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- whatsapp_senders
create policy "senders: lectura propia" on public.whatsapp_senders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "senders: alta propia" on public.whatsapp_senders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "senders: edición propia" on public.whatsapp_senders
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "senders: borrado propio" on public.whatsapp_senders
  for delete to authenticated using ((select auth.uid()) = user_id);

-- webhook_events (sólo lectura de los eventos asociados al usuario)
create policy "webhook_events: lectura propia" on public.webhook_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- Funciones: quién puede ejecutarlas
-- ---------------------------------------------------------------------
revoke execute on function public.register_shared_link(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.archive_expired_links() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.get_system_status() from public, anon;
grant execute on function public.register_shared_link(uuid, text, text, text, text) to service_role;
grant execute on function public.archive_expired_links() to service_role;
grant execute on function public.get_system_status() to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: el dashboard recibe altas y cambios al instante.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.links;
alter publication supabase_realtime add table public.job_details;

-- ---------------------------------------------------------------------
-- Tarea programada: archivado lógico cada hora (minuto 15).
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'linkvault-archive-expired',
  '15 * * * *',
  $$select public.archive_expired_links();$$
);
