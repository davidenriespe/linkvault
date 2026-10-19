// Tipos que reflejan el esquema de Supabase (supabase/migrations).

export type LinkStatus = "nuevo" | "pendiente" | "visto" | "seguimiento" | "archivado" | "descartado";
export type LinkPriority = "baja" | "media" | "alta";
export type MetadataStatus = "pendiente" | "ok" | "parcial" | "fallido" | "omitido";
export type ApplicationStatus =
  "pendiente_revisar" | "interesante" | "postulacion_iniciada" | "postulado" | "descartado" | "cerrado";
export type WorkMode = "presencial" | "remoto" | "hibrido";
export type LinkSource = "whatsapp" | "simulacion" | "manual" | "demo";

export interface Category {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  is_default: boolean;
  sort_order: number;
}

export interface Link {
  id: string;
  user_id: string;
  original_url: string;
  normalized_url: string;
  domain: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  preview_image: string | null;
  site_name: string | null;
  category_id: string | null;
  category_source: "reglas" | "ia" | "manual" | "por_defecto";
  status: LinkStatus;
  status_before_archive: LinkStatus | null;
  priority: LinkPriority;
  notes: string | null;
  tags: string[];
  source: LinkSource;
  is_demo: boolean;
  share_count: number;
  received_at: string;
  last_shared_at: string;
  reviewed_at: string | null;
  archived_at: string | null;
  discarded_at: string | null;
  expires_at: string;
  favorite: boolean;
  metadata_status: MetadataStatus;
  metadata_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobDetails {
  link_id: string;
  user_id: string;
  company: string | null;
  job_title: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  published_at: string | null;
  deadline: string | null;
  salary: string | null;
  opportunity_status: "abierta" | "cerrada" | "desconocida";
  application_status: ApplicationStatus;
  reviewed_at: string | null;
  observations: string | null;
  extracted_fields: string[];
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: string;
  user_id: string;
  retention_days: number;
  stale_after_days: number;
  theme: "light" | "dark" | "system";
  notification_preferences: { whatsapp_ack?: boolean; digest_in_app?: boolean };
}

export interface WhatsAppSender {
  id: string;
  user_id: string;
  phone: string;
  label: string | null;
  last_inbound_at: string | null;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  provider: "whatsapp" | "whatsapp_test";
  provider_message_id: string;
  sender_suffix: string | null;
  processing_status: "recibido" | "procesando" | "procesado" | "ignorado" | "error";
  attempts: number;
  urls_found: number;
  links_created: number;
  links_updated: number;
  received_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface LinkHistory {
  id: number;
  link_id: string;
  action: string;
  from_status: LinkStatus | null;
  to_status: LinkStatus | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SystemStatus {
  archive_job_scheduled: boolean;
  archive_job_schedule: string | null;
  archive_last_run: { archived: number; at: string } | null;
  whatsapp_webhook_verified_at: string | null;
  whatsapp_last_real_event_at: string | null;
  whatsapp_last_test_event_at: string | null;
  metadata_last_ok_at: string | null;
  metadata_ok_count: number;
  metadata_failed_count: number;
  senders_count: number;
}

export interface FunctionStatus {
  whatsapp_verify_token: boolean;
  whatsapp_app_secret: boolean;
  whatsapp_access_token: boolean;
  whatsapp_phone_number_id: boolean;
  ai_provider: boolean;
  ai_model: string | null;
  webhook_url: string;
}

/** Enlace enriquecido para la interfaz (con su categoría y datos de empleo). */
export interface LinkView extends Link {
  category: Category | null;
  job: JobDetails | null;
}
