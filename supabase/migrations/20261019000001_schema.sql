-- =====================================================================
-- LinkVault · Migración 0001 · Esquema base
-- Tablas, tipos, índices y restricciones.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type public.link_status as enum (
  'nuevo', 'pendiente', 'visto', 'seguimiento', 'archivado', 'descartado'
);

create type public.link_priority as enum ('baja', 'media', 'alta');

create type public.metadata_status as enum (
  'pendiente', 'ok', 'parcial', 'fallido', 'omitido'
);

create type public.application_status as enum (
  'pendiente_revisar', 'interesante', 'postulacion_iniciada',
  'postulado', 'descartado', 'cerrado'
);

create type public.webhook_status as enum (
  'recibido', 'procesando', 'procesado', 'ignorado', 'error'
);

-- ---------------------------------------------------------------------
-- settings: preferencias por usuario
-- ---------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  retention_days integer not null default 7 check (retention_days between 1 and 365),
  stale_after_days integer not null default 3 check (stale_after_days between 1 and 60),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  notification_preferences jsonb not null default
    '{"whatsapp_ack": true, "digest_in_app": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default 'tag' check (char_length(icon) <= 40),
  is_default boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index categories_user_idx on public.categories (user_id, sort_order);

-- ---------------------------------------------------------------------
-- links: registro principal
-- ---------------------------------------------------------------------
create table public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_url text not null
    check (char_length(original_url) <= 4096 and original_url ~* '^https?://'),
  normalized_url text not null check (char_length(normalized_url) <= 4096),
  domain text not null check (char_length(domain) <= 255),
  title text check (char_length(title) <= 500),
  description text check (char_length(description) <= 2000),
  summary text check (char_length(summary) <= 2000),
  preview_image text
    check (preview_image is null or (char_length(preview_image) <= 2048 and preview_image ~* '^https?://')),
  site_name text check (char_length(site_name) <= 200),
  category_id uuid references public.categories (id) on delete set null,
  category_source text not null default 'por_defecto'
    check (category_source in ('reglas', 'ia', 'manual', 'por_defecto')),
  status public.link_status not null default 'nuevo',
  status_before_archive public.link_status,
  priority public.link_priority not null default 'media',
  notes text check (char_length(notes) <= 5000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  source text not null default 'whatsapp'
    check (source in ('whatsapp', 'simulacion', 'manual', 'demo')),
  is_demo boolean not null default false,
  share_count integer not null default 1 check (share_count >= 1),
  received_at timestamptz not null default now(),
  last_shared_at timestamptz not null default now(),
  reviewed_at timestamptz,
  archived_at timestamptz,
  discarded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  favorite boolean not null default false,
  metadata_status public.metadata_status not null default 'pendiente',
  metadata_error text check (char_length(metadata_error) <= 500),
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_url)
);

create index links_user_status_idx on public.links (user_id, status, received_at desc);
create index links_user_received_idx on public.links (user_id, received_at desc);
create index links_user_category_idx on public.links (user_id, category_id);
create index links_expiry_idx on public.links (expires_at)
  where status in ('nuevo', 'pendiente', 'visto') and favorite = false;
create index links_favorite_idx on public.links (user_id) where favorite;
create index links_search_trgm_idx on public.links using gin (search_text extensions.gin_trgm_ops);
create index links_tags_idx on public.links using gin (tags);

-- ---------------------------------------------------------------------
-- job_details: campos adicionales para la categoría Empleo
-- ---------------------------------------------------------------------
create table public.job_details (
  link_id uuid primary key references public.links (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company text check (char_length(company) <= 200),
  job_title text check (char_length(job_title) <= 300),
  location text check (char_length(location) <= 300),
  work_mode text check (work_mode in ('presencial', 'remoto', 'hibrido')),
  published_at date,
  deadline date,
  salary text check (char_length(salary) <= 200),
  opportunity_status text not null default 'desconocida'
    check (opportunity_status in ('abierta', 'cerrada', 'desconocida')),
  application_status public.application_status not null default 'pendiente_revisar',
  reviewed_at timestamptz,
  observations text check (char_length(observations) <= 5000),
  extracted_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_details_user_idx on public.job_details (user_id);
create index job_details_deadline_idx on public.job_details (user_id, deadline);

-- ---------------------------------------------------------------------
-- link_history: historial de cambios de estado
-- ---------------------------------------------------------------------
create table public.link_history (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.links (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  from_status public.link_status,
  to_status public.link_status,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index link_history_link_idx on public.link_history (link_id, created_at desc);
create index link_history_user_idx on public.link_history (user_id);

-- ---------------------------------------------------------------------
-- whatsapp_senders: números autorizados para enviar enlaces
-- Sólo los mensajes de estos números se guardan.
-- ---------------------------------------------------------------------
create table public.whatsapp_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text not null unique check (phone ~ '^[0-9]{8,15}$'),
  label text check (char_length(label) <= 60),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now()
);

create index whatsapp_senders_user_idx on public.whatsapp_senders (user_id);

-- ---------------------------------------------------------------------
-- webhook_events: registro e idempotencia de eventos entrantes
-- ---------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'whatsapp' check (provider in ('whatsapp', 'whatsapp_test')),
  provider_message_id text not null check (char_length(provider_message_id) <= 255),
  user_id uuid references auth.users (id) on delete cascade,
  sender_suffix text check (char_length(sender_suffix) <= 4),
  processing_status public.webhook_status not null default 'recibido',
  attempts integer not null default 1,
  urls_found integer not null default 0,
  links_created integer not null default 0,
  links_updated integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text check (char_length(error_message) <= 500),
  unique (provider, provider_message_id)
);

create index webhook_events_user_idx on public.webhook_events (user_id, received_at desc);
create index webhook_events_received_idx on public.webhook_events (received_at desc);

-- ---------------------------------------------------------------------
-- integration_state: marcas técnicas del sistema (sin secretos)
-- Sólo accesible por el backend (service_role).
-- ---------------------------------------------------------------------
create table public.integration_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
