-- =====================================================================
-- LinkVault · Migración 0002 · Funciones y disparadores
-- Toda función SECURITY DEFINER fija search_path = '' y usa nombres
-- calificados para evitar secuestro de search_path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- updated_at genérico
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- links: reglas de estado, retención y texto de búsqueda
-- ---------------------------------------------------------------------
create or replace function public.links_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention integer;
  v_company text;
  v_job_title text;
  v_category text;
begin
  select s.retention_days into v_retention
  from public.settings s where s.user_id = new.user_id;
  v_retention := coalesce(v_retention, 7);

  if tg_op = 'INSERT' then
    new.expires_at := new.last_shared_at + make_interval(days => v_retention);
    if new.status = 'visto' and new.reviewed_at is null then
      new.reviewed_at := now();
    end if;
  else
    -- El propietario de un registro nunca cambia.
    new.user_id := old.user_id;
    new.updated_at := now();

    if new.status is distinct from old.status then
      -- Visto: se registra la fecha de revisión (confirmación explícita).
      if new.status = 'visto' then
        new.reviewed_at := now();
      end if;

      -- Entrada al archivo o a descartados: se guarda el estado previo.
      if new.status = 'archivado' then
        new.archived_at := now();
        new.status_before_archive := case
          when old.status in ('archivado', 'descartado') then coalesce(old.status_before_archive, 'pendiente')
          else old.status end;
      elsif new.status = 'descartado' then
        new.discarded_at := now();
        new.status_before_archive := case
          when old.status in ('archivado', 'descartado') then coalesce(old.status_before_archive, 'pendiente')
          else old.status end;
      end if;

      -- Restauración: se limpian marcas y se renueva el plazo si ya venció.
      if old.status in ('archivado', 'descartado')
         and new.status not in ('archivado', 'descartado') then
        new.archived_at := null;
        new.discarded_at := null;
        new.status_before_archive := null;
        if new.expires_at <= now() + interval '1 hour' then
          new.expires_at := now() + make_interval(days => v_retention);
        end if;
      end if;
    end if;
  end if;

  select j.company, j.job_title into v_company, v_job_title
  from public.job_details j where j.link_id = new.id;

  select c.name into v_category
  from public.categories c where c.id = new.category_id;

  new.search_text := lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    concat_ws(' ',
      new.title, new.description, new.summary, new.original_url, new.domain,
      new.site_name, new.notes, array_to_string(new.tags, ' '),
      v_company, v_job_title, v_category)
  ));

  return new;
end;
$$;

create trigger links_before_write
  before insert or update on public.links
  for each row execute function public.links_before_write();

-- Historial de cambios relevantes
create or replace function public.links_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.link_history (link_id, user_id, action, to_status, details)
    values (new.id, new.user_id, 'recibido', new.status, jsonb_build_object('source', new.source));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.link_history (link_id, user_id, action, from_status, to_status)
    values (new.id, new.user_id, 'cambio_estado', old.status, new.status);
  end if;

  if new.share_count > old.share_count then
    insert into public.link_history (link_id, user_id, action, details)
    values (new.id, new.user_id, 'recompartido', jsonb_build_object('share_count', new.share_count));
  end if;

  if new.favorite is distinct from old.favorite then
    insert into public.link_history (link_id, user_id, action, details)
    values (new.id, new.user_id, case when new.favorite then 'favorito_on' else 'favorito_off' end, '{}'::jsonb);
  end if;

  if new.category_id is distinct from old.category_id then
    insert into public.link_history (link_id, user_id, action, details)
    values (new.id, new.user_id, 'cambio_categoria',
            jsonb_build_object('source', new.category_source));
  end if;

  return new;
end;
$$;

create trigger links_after_write
  after insert or update on public.links
  for each row execute function public.links_after_write();

-- ---------------------------------------------------------------------
-- job_details: coherencia de propietario y fechas
-- ---------------------------------------------------------------------
create or replace function public.job_details_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El propietario se toma siempre del enlace; RLS valida el resultado.
  select l.user_id into new.user_id from public.links l where l.id = new.link_id;
  if new.user_id is null then
    raise exception 'Enlace inexistente';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.application_status is distinct from old.application_status
       and old.application_status = 'pendiente_revisar'
       and new.reviewed_at is null then
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger job_details_before_write
  before insert or update on public.job_details
  for each row execute function public.job_details_before_write();

-- Recalcula el texto de búsqueda del enlace cuando cambian empresa/cargo.
create or replace function public.job_details_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.links set search_text = search_text where id = new.link_id;
  return new;
end;
$$;

create trigger job_details_after_write
  after insert or update of company, job_title on public.job_details
  for each row execute function public.job_details_after_write();

-- ---------------------------------------------------------------------
-- settings: al cambiar la retención se desplaza el vencimiento
-- de los enlaces activos en la misma diferencia de días.
-- ---------------------------------------------------------------------
create or replace function public.settings_after_retention_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retention_days is distinct from old.retention_days then
    update public.links
       set expires_at = expires_at + make_interval(days => new.retention_days - old.retention_days)
     where user_id = new.user_id
       and status in ('nuevo', 'pendiente', 'visto');
  end if;
  return new;
end;
$$;

create trigger settings_after_retention_change
  after update of retention_days on public.settings
  for each row execute function public.settings_after_retention_change();

-- ---------------------------------------------------------------------
-- Alta de usuario: ajustes y categorías predeterminadas
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.categories (user_id, name, slug, color, icon, is_default, sort_order)
  values
    (new.id, 'Empleo',                        'empleo',         '#2563eb', 'briefcase',      true, 10),
    (new.id, 'Formación',                     'formacion',      '#7c3aed', 'graduation-cap', true, 20),
    (new.id, 'Inteligencia artificial',       'ia',             '#db2777', 'sparkles',       true, 30),
    (new.id, 'Programación y desarrollo',     'programacion',   '#0891b2', 'code',           true, 40),
    (new.id, 'Tecnología e innovación',       'tecnologia',     '#4f46e5', 'cpu',            true, 50),
    (new.id, 'Geografía y SIG',               'geografia-sig',  '#059669', 'map',            true, 60),
    (new.id, 'Medio ambiente',                'medio-ambiente', '#65a30d', 'leaf',           true, 70),
    (new.id, 'Investigación científica',      'investigacion',  '#0d9488', 'flask-conical',  true, 80),
    (new.id, 'Noticias',                      'noticias',       '#ea580c', 'newspaper',      true, 90),
    (new.id, 'Videojuegos y entretenimiento', 'videojuegos',    '#c026d3', 'gamepad-2',      true, 100),
    (new.id, 'Compras y productos',           'compras',        '#ca8a04', 'shopping-bag',   true, 110),
    (new.id, 'Otros',                         'otros',          '#64748b', 'folder',         true, 120)
  on conflict (user_id, slug) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- register_shared_link: alta idempotente de un enlace compartido.
-- Si la URL normalizada ya existe para el usuario, actualiza la fecha
-- de último envío y, si estaba archivado/descartado, lo devuelve a la
-- bandeja. Sólo la usa el backend (service_role).
-- ---------------------------------------------------------------------
create or replace function public.register_shared_link(
  p_user_id uuid,
  p_original_url text,
  p_normalized_url text,
  p_domain text,
  p_source text
)
returns table (link_id uuid, is_new boolean, metadata_status public.metadata_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention integer;
begin
  select s.retention_days into v_retention from public.settings s where s.user_id = p_user_id;
  v_retention := coalesce(v_retention, 7);

  return query
  insert into public.links as l (user_id, original_url, normalized_url, domain, source)
  values (p_user_id, p_original_url, p_normalized_url, p_domain, p_source)
  on conflict (user_id, normalized_url) do update
    set last_shared_at = now(),
        share_count = l.share_count + 1,
        status = case when l.status in ('archivado', 'descartado') then 'nuevo'::public.link_status
                      else l.status end,
        expires_at = greatest(l.expires_at, now() + make_interval(days => v_retention))
  returning l.id, (l.xmax = 0), l.metadata_status;
end;
$$;

-- ---------------------------------------------------------------------
-- archive_expired_links: limpieza programada (archivado lógico)
-- Protegidos: favoritos, «En seguimiento» y postulaciones activas.
-- ---------------------------------------------------------------------
create or replace function public.archive_expired_links()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.links l
       set status = 'archivado'
     where l.status in ('nuevo', 'pendiente', 'visto')
       and l.favorite = false
       and l.expires_at <= now()
       and not exists (
         select 1 from public.job_details j
          where j.link_id = l.id
            and j.application_status in ('postulacion_iniciada', 'postulado')
       )
    returning 1
  )
  select count(*) into v_count from updated;

  insert into public.integration_state (key, value, updated_at)
  values ('archive_last_run', jsonb_build_object('archived', v_count, 'at', now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- get_system_status: indicadores reales para la pantalla de ajustes.
-- No devuelve secretos, sólo marcas de tiempo y estados.
-- ---------------------------------------------------------------------
create or replace function public.get_system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select jsonb_build_object(
    'archive_job_scheduled', exists (
      select 1 from cron.job where jobname = 'linkvault-archive-expired' and active),
    'archive_job_schedule', (
      select schedule from cron.job where jobname = 'linkvault-archive-expired' limit 1),
    'archive_last_run', (
      select value from public.integration_state where key = 'archive_last_run'),
    'whatsapp_webhook_verified_at', (
      select value ->> 'at' from public.integration_state where key = 'whatsapp_webhook_verified'),
    'whatsapp_last_real_event_at', (
      select max(received_at) from public.webhook_events
       where user_id = v_uid and provider = 'whatsapp'),
    'whatsapp_last_test_event_at', (
      select max(received_at) from public.webhook_events
       where user_id = v_uid and provider = 'whatsapp_test'),
    'metadata_last_ok_at', (
      select max(updated_at) from public.links
       where user_id = v_uid and metadata_status in ('ok', 'parcial')),
    'metadata_ok_count', (
      select count(*) from public.links
       where user_id = v_uid and metadata_status in ('ok', 'parcial')),
    'metadata_failed_count', (
      select count(*) from public.links
       where user_id = v_uid and metadata_status = 'fallido'),
    'senders_count', (
      select count(*) from public.whatsapp_senders where user_id = v_uid)
  ) into v_result;

  return v_result;
end;
$$;
