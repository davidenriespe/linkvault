// Webhook oficial de WhatsApp Business Platform (Cloud API) para LinkVault.
//
// GET  → verificación del webhook (hub.mode / hub.verify_token / hub.challenge)
// POST → eventos de Meta, firmados con X-Hub-Signature-256
// POST ?mode=test → MODO DE PRUEBA: el usuario autenticado envía un payload
//        con el mismo formato que Meta; se procesa igual pero se marca como
//        «simulación». No implica que WhatsApp esté conectado.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { extractUrls } from "../_shared/urls.ts";
import {
  markAsRead,
  parseWebhookPayload,
  sendTextReply,
  verifyMetaSignature,
  type IncomingMessage,
} from "../_shared/whatsapp.ts";
import {
  CORS_HEADERS,
  env,
  ingestUrl,
  json,
  rateLimited,
  serviceClient,
  userFromRequest,
  type IngestResult,
} from "../_shared/pipeline.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const isTest = url.searchParams.get("mode") === "test";

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // -------------------------------------------------------------------------
  // 1. Verificación del webhook (Meta la hace una vez al configurarlo)
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expected = env("WHATSAPP_VERIFY_TOKEN");
    if (mode === "subscribe" && expected && token === expected && /^[A-Za-z0-9_-]{1,128}$/.test(challenge)) {
      try {
        await serviceClient()
          .from("integration_state")
          .upsert({
            key: "whatsapp_webhook_verified",
            value: { at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          });
      } catch {
        // la verificación no debe fallar por un error de registro
      }
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // -------------------------------------------------------------------------
  // 2. Lectura del cuerpo con límite de tamaño
  // -------------------------------------------------------------------------
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("Payload Too Large", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("Payload Too Large", { status: 413 });

  // -------------------------------------------------------------------------
  // 3a. Modo de prueba: requiere sesión del usuario
  // -------------------------------------------------------------------------
  if (isTest) {
    const user = await userFromRequest(req);
    if (!user) return json({ error: "No autenticado" }, 401, CORS_HEADERS);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "JSON inválido" }, 400, CORS_HEADERS);
    }
    const messages = parseWebhookPayload(payload);
    if (messages.length === 0) return json({ error: "El payload no contiene mensajes" }, 400, CORS_HEADERS);
    const sb = serviceClient();
    const results = [];
    for (const m of messages.slice(0, 5)) {
      results.push(await processMessage(sb, m, { provider: "whatsapp_test", forcedUserId: user.id }));
    }
    return json({ mode: "simulacion", results }, 200, CORS_HEADERS);
  }

  // -------------------------------------------------------------------------
  // 3b. Evento real de Meta: la firma es obligatoria
  // -------------------------------------------------------------------------
  const appSecret = env("WHATSAPP_APP_SECRET");
  if (!appSecret) {
    console.warn("[webhook] WHATSAPP_APP_SECRET no configurado: evento rechazado");
    return new Response("Webhook not configured", { status: 503 });
  }
  const valid = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret);
  if (!valid) {
    console.warn("[webhook] firma inválida");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const messages = parseWebhookPayload(payload);

  // Se responde 200 de inmediato; el procesamiento continúa en segundo plano
  // para que Meta no reintente por tiempo de espera.
  if (messages.length) {
    const sb = serviceClient();
    const work = (async () => {
      for (const m of messages) {
        try {
          await processMessage(sb, m, { provider: "whatsapp" });
        } catch (e) {
          console.error("[webhook] error procesando mensaje", m.id, e instanceof Error ? e.message : "desconocido");
        }
      }
    })();
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work);
    else await work;
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});

interface ProcessOptions {
  provider: "whatsapp" | "whatsapp_test";
  forcedUserId?: string;
}

interface ProcessResult {
  messageId: string;
  status: "procesado" | "ignorado" | "duplicado" | "error";
  detail?: string;
  links?: IngestResult[];
  ackSent?: boolean;
}

async function processMessage(sb: SupabaseClient, m: IncomingMessage, opts: ProcessOptions): Promise<ProcessResult> {
  const suffix = m.from.slice(-4);

  // --- Idempotencia: un mismo id de mensaje sólo se procesa una vez ---------
  const { data: inserted } = await sb
    .from("webhook_events")
    .upsert(
      { provider: opts.provider, provider_message_id: m.id, sender_suffix: suffix, processing_status: "procesando" },
      { onConflict: "provider,provider_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  let eventId = inserted?.id as string | undefined;
  if (!eventId) {
    const { data: existing } = await sb
      .from("webhook_events")
      .select("id, processing_status, attempts")
      .eq("provider", opts.provider)
      .eq("provider_message_id", m.id)
      .single();
    // Sólo se reintenta si el intento anterior terminó en error.
    if (!existing || existing.processing_status !== "error" || existing.attempts >= MAX_ATTEMPTS) {
      return { messageId: m.id, status: "duplicado", detail: "Mensaje ya recibido" };
    }
    eventId = existing.id;
    await sb
      .from("webhook_events")
      .update({ processing_status: "procesando", attempts: existing.attempts + 1, error_message: null })
      .eq("id", eventId);
  }

  const finish = (fields: Record<string, unknown>) =>
    sb
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString(), ...fields })
      .eq("id", eventId);

  try {
    // --- Remitente autorizado ------------------------------------------------
    let userId = opts.forcedUserId;
    if (!userId) {
      const { data: sender } = await sb.from("whatsapp_senders").select("user_id").eq("phone", m.from).maybeSingle();
      if (!sender) {
        await finish({ processing_status: "ignorado", error_message: "Remitente no autorizado" });
        return { messageId: m.id, status: "ignorado", detail: "Remitente no autorizado" };
      }
      userId = sender.user_id as string;
      await sb.from("whatsapp_senders").update({ last_inbound_at: new Date().toISOString() }).eq("phone", m.from);
    }
    await sb.from("webhook_events").update({ user_id: userId }).eq("id", eventId);

    const sendCfg = opts.provider === "whatsapp" ? whatsappSendConfig(m) : null;
    if (sendCfg) markAsRead(sendCfg, m.id).catch(() => {});

    // --- URLs del mensaje ----------------------------------------------------
    const urls = extractUrls(m.text);
    if (urls.length === 0) {
      await finish({ processing_status: "ignorado", urls_found: 0, error_message: "Mensaje sin enlaces" });
      const ackSent = await maybeAck(
        sb,
        userId,
        sendCfg,
        m,
        "🤔 No encontré ningún enlace en tu mensaje. Compárteme una URL y la guardo en LinkVault.",
      );
      return { messageId: m.id, status: "ignorado", detail: "Mensaje sin enlaces", ackSent };
    }

    if (await rateLimited(sb, userId)) {
      await finish({
        processing_status: "error",
        urls_found: urls.length,
        error_message: "Límite de frecuencia alcanzado",
      });
      return { messageId: m.id, status: "error", detail: "Límite de 30 enlaces por minuto" };
    }

    const source = opts.provider === "whatsapp" ? "whatsapp" : "simulacion";
    const results: IngestResult[] = [];
    for (const u of urls) results.push(await ingestUrl(sb, userId, u, source));

    const created = results.filter((r) => r.ok && r.isNew).length;
    const updated = results.filter((r) => r.ok && !r.isNew).length;
    const failed = results.filter((r) => !r.ok);
    await finish({
      processing_status: failed.length === results.length ? "error" : "procesado",
      urls_found: urls.length,
      links_created: created,
      links_updated: updated,
      error_message: failed.length
        ? failed
            .map((f) => f.error)
            .join("; ")
            .slice(0, 500)
        : null,
    });

    const ackSent = await maybeAck(sb, userId, sendCfg, m, buildAck(results));
    return { messageId: m.id, status: "procesado", links: results, ackSent };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "Error desconocido";
    await finish({ processing_status: "error", error_message: msg });
    return { messageId: m.id, status: "error", detail: msg };
  }
}

function whatsappSendConfig(m: IncomingMessage) {
  const accessToken = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID") ?? m.phoneNumberId;
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId, apiVersion: env("WHATSAPP_API_VERSION") };
}

async function maybeAck(
  sb: SupabaseClient,
  userId: string,
  cfg: ReturnType<typeof whatsappSendConfig>,
  m: IncomingMessage,
  body: string,
): Promise<boolean> {
  if (!cfg) return false;
  const { data: settings } = await sb
    .from("settings")
    .select("notification_preferences")
    .eq("user_id", userId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const prefs = (settings?.notification_preferences ?? {}) as any;
  if (prefs.whatsapp_ack === false) return false;
  // Respuesta de texto libre: permitida porque el usuario acaba de escribir
  // (ventana de atención de 24 h). No se usan plantillas.
  try {
    return await sendTextReply(cfg, m.from, body, m.id);
  } catch {
    return false;
  }
}

function buildAck(results: IngestResult[]): string {
  const lines = results.map((r) => {
    if (!r.ok) return `⚠️ ${r.url} — ${r.error}`;
    const name = r.title ? truncate(r.title, 70) : truncate(r.url, 70);
    return `${r.isNew ? "✅ Guardado" : "♻️ Ya lo tenías (actualizado)"}: ${name}${r.category ? ` · ${r.category}` : ""}`;
  });
  return `LinkVault\n${lines.join("\n")}`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
