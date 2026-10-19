// Flujo de ingesta: normalizar → registrar (idempotente) → metadatos → clasificar.
// Se ejecuta en Supabase Edge Functions (Deno) con la clave service_role,
// que nunca sale del servidor.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeUrl } from "./urls.ts";
import { BlockedUrlError, safeFetchHtml, type Resolver } from "./ssrf.ts";
import { parseHtmlMetadata, cleanText, type PageMetadata } from "./metadata.ts";
import { classify, type CategorySlug } from "./classify.ts";
import { aiClassify } from "./ai.ts";

export type Source = "whatsapp" | "simulacion" | "manual";

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

export function serviceClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Devuelve el usuario dueño del token JWT (o null). */
export async function userFromRequest(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// ---------------------------------------------------------------------------
// Resolución DNS: Deno.resolveDns si está disponible; si no, DNS sobre HTTPS.
// ---------------------------------------------------------------------------
export const resolveHost: Resolver = async (host) => {
  const results: string[] = [];
  // deno-lint-ignore no-explicit-any
  const d = Deno as any;
  if (typeof d.resolveDns === "function") {
    for (const type of ["A", "AAAA"]) {
      try {
        results.push(...((await d.resolveDns(host, type)) as string[]));
      } catch {
        // sin registros de ese tipo
      }
    }
    if (results.length) return results;
  }
  for (const type of ["A", "AAAA"]) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of data.Answer ?? []) {
      if (a.type === 1 || a.type === 28) results.push(a.data);
      // Un CNAME seguido de su A también aparece en Answer.
    }
  }
  return results;
};

// ---------------------------------------------------------------------------
// Límite de frecuencia sencillo (protección frente a abuso)
// ---------------------------------------------------------------------------
export async function rateLimited(sb: SupabaseClient, userId: string, maxPerMinute = 30): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb
    .from("links")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("last_shared_at", since);
  return (count ?? 0) >= maxPerMinute;
}

export interface IngestResult {
  ok: boolean;
  url: string;
  linkId?: string;
  isNew?: boolean;
  title?: string | null;
  category?: string | null;
  error?: string;
}

export async function ingestUrl(
  sb: SupabaseClient,
  userId: string,
  rawUrl: string,
  source: Source,
): Promise<IngestResult> {
  const n = normalizeUrl(rawUrl);
  if (!n) return { ok: false, url: rawUrl, error: "URL no válida" };

  const { data, error } = await sb.rpc("register_shared_link", {
    p_user_id: userId,
    p_original_url: n.original,
    p_normalized_url: n.normalized,
    p_domain: n.domain,
    p_source: source,
  });
  if (error || !data?.[0]) return { ok: false, url: rawUrl, error: "No se pudo guardar" };
  const row = data[0] as { link_id: string; is_new: boolean; metadata_status: string };

  if (row.is_new || row.metadata_status === "pendiente" || row.metadata_status === "fallido") {
    await enrichLink(sb, row.link_id, userId, n.original, n.domain);
  }

  const { data: link } = await sb.from("links").select("title, categories(name)").eq("id", row.link_id).single();
  return {
    ok: true,
    url: n.original,
    linkId: row.link_id,
    isNew: row.is_new,
    title: link?.title ?? null,
    // deno-lint-ignore no-explicit-any
    category: (link as any)?.categories?.name ?? null,
  };
}

/** Obtiene metadatos, clasifica y actualiza el enlace. Nunca lanza: falla de forma segura. */
export async function enrichLink(
  sb: SupabaseClient,
  linkId: string,
  userId: string,
  url: string,
  domain: string,
): Promise<void> {
  let meta: PageMetadata = {};
  let metadataStatus: "ok" | "parcial" | "fallido" | "omitido" = "fallido";
  let metadataError: string | null = null;

  try {
    const page = await safeFetchHtml(url, { resolve: resolveHost });
    if (!page.body) {
      metadataStatus = "omitido";
      metadataError = page.contentType
        ? `Contenido no HTML (${page.contentType.split(";")[0]})`
        : `Respuesta ${page.status} sin contenido`;
      // Nombre de archivo como título orientativo (p. ej. PDF).
      const file = decodeURIComponent(new URL(page.finalUrl).pathname.split("/").pop() ?? "");
      if (file) meta.title = cleanText(file, 200);
    } else if (page.status >= 400) {
      metadataStatus = "fallido";
      metadataError = `La página respondió ${page.status}`;
      meta = parseHtmlMetadata(page.body, page.finalUrl);
    } else {
      meta = parseHtmlMetadata(page.body, page.finalUrl);
      metadataStatus =
        meta.title && (meta.description || meta.image) ? "ok" : meta.title || meta.description ? "parcial" : "fallido";
      if (metadataStatus === "fallido") metadataError = "La página no publica metadatos legibles";
    }
  } catch (e) {
    metadataStatus = "fallido";
    metadataError =
      e instanceof BlockedUrlError
        ? `Bloqueado por seguridad: ${e.message}`
        : e instanceof DOMException && e.name === "AbortError"
          ? "Tiempo de espera agotado"
          : "No se pudo obtener la página";
  }

  // Clasificación por reglas
  const rules = classify({
    url,
    domain,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName,
    keywords: meta.keywords,
    ogType: meta.type,
    hasJobPosting: Boolean(meta.job),
  });

  // IA opcional
  let slug: CategorySlug = rules.slug;
  let categorySource: "reglas" | "ia" | "por_defecto" = rules.slug === "otros" ? "por_defecto" : "reglas";
  let summary: string | null = null;
  let aiTags: string[] = [];
  const apiKey = env("ANTHROPIC_API_KEY");
  if (apiKey && (meta.title || meta.description || meta.textSample)) {
    const ai = await aiClassify(
      { apiKey, model: env("AI_MODEL") },
      { url, title: meta.title, description: meta.description, textSample: meta.textSample },
    );
    if (ai) {
      summary = ai.summary ?? null;
      aiTags = ai.tags;
      if (!rules.confident && ai.category) {
        slug = ai.category;
        categorySource = "ia";
      }
    }
  }

  // Estado actual: no se pisa una categoría elegida a mano ni etiquetas existentes.
  const { data: current } = await sb.from("links").select("category_source, tags").eq("id", linkId).single();

  const update: Record<string, unknown> = {
    title: meta.title ?? null,
    description: meta.description ?? null,
    preview_image: meta.image ?? null,
    site_name: meta.siteName ?? null,
    metadata_status: metadataStatus,
    metadata_error: metadataError,
  };
  if (summary) update.summary = summary;
  if (aiTags.length && (!current?.tags || current.tags.length === 0)) update.tags = aiTags;

  if (current?.category_source !== "manual") {
    const { data: cat } = await sb.from("categories").select("id").eq("user_id", userId).eq("slug", slug).maybeSingle();
    if (cat) {
      update.category_id = cat.id;
      update.category_source = categorySource;
    }
  }

  await sb.from("links").update(update).eq("id", linkId);

  // Ofertas laborales: sólo datos declarados por la página.
  if (slug === "empleo") {
    const { data: existing } = await sb.from("job_details").select("*").eq("link_id", linkId).maybeSingle();
    const job = meta.job;
    if (!existing) {
      await sb.from("job_details").insert({
        link_id: linkId,
        user_id: userId,
        company: job?.company ?? null,
        job_title: job?.job_title ?? null,
        location: job?.location ?? null,
        work_mode: job?.work_mode ?? null,
        published_at: job?.published_at ?? null,
        deadline: job?.deadline ?? null,
        salary: job?.salary ?? null,
        extracted_fields: job?.extracted_fields ?? [],
      });
    } else if (job) {
      const fill: Record<string, unknown> = {};
      for (const k of job.extracted_fields) {
        // deno-lint-ignore no-explicit-any
        if ((existing as any)[k] == null) fill[k] = (job as any)[k];
      }
      if (Object.keys(fill).length) await sb.from("job_details").update(fill).eq("link_id", linkId);
    }
  }
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
