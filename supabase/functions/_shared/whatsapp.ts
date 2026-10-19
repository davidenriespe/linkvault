// Utilidades de WhatsApp Business Platform (Cloud API).
// Módulo puro: usa Web Crypto y fetch estándar.

export interface IncomingMessage {
  id: string;
  from: string; // número del remitente (wa_id), sólo dígitos
  timestamp: number; // segundos Unix
  type: string;
  text: string; // texto o leyenda donde puede venir la URL
  phoneNumberId?: string; // número receptor de LinkVault
}

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante para evitar ataques de temporización. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
}

/**
 * Verifica la cabecera X-Hub-Signature-256 que Meta añade a cada evento:
 * "sha256=" + HMAC-SHA256(cuerpo crudo, App Secret).
 */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false;
  const [algo, received] = header.split("=", 2);
  if (algo !== "sha256" || !received || !/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(expected, received.toLowerCase());
}

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
}

/** Extrae los mensajes entrantes (ignora estados de entrega/lectura). */
export function parseWebhookPayload(payload: unknown): IncomingMessage[] {
  const root = asObj(payload);
  if (!root || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return [];
  const out: IncomingMessage[] = [];
  for (const entry of root.entry) {
    const changes = asObj(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = asObj(change);
      if (c?.field !== "messages") continue;
      const value = asObj(c.value);
      const messages = value?.messages;
      const phoneNumberId = String(asObj(value?.metadata)?.phone_number_id ?? "") || undefined;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = asObj(m);
        if (!msg || typeof msg.id !== "string" || typeof msg.from !== "string") continue;
        const type = String(msg.type ?? "unknown");
        let text = "";
        if (type === "text") text = String(asObj(msg.text)?.body ?? "");
        else if (["image", "video", "document"].includes(type)) text = String(asObj(msg[type])?.caption ?? "");
        else if (type === "button") text = String(asObj(msg.button)?.text ?? "");
        else if (type === "interactive") {
          const i = asObj(msg.interactive);
          text = String(asObj(i?.button_reply)?.title ?? asObj(i?.list_reply)?.title ?? "");
        }
        out.push({
          id: msg.id.slice(0, 255),
          from: msg.from.replace(/\D/g, "").slice(0, 15),
          timestamp: Number(msg.timestamp ?? 0) || Math.floor(Date.now() / 1000),
          type,
          text: text.slice(0, 8000),
          phoneNumberId,
        });
      }
    }
  }
  return out;
}

export interface SendConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Responde con un texto libre. Sólo es válido dentro de la ventana de
 * atención de 24 h abierta por el mensaje del usuario (no requiere plantilla).
 */
export async function sendTextReply(cfg: SendConfig, to: string, body: string, replyToId?: string): Promise<boolean> {
  const f = cfg.fetchImpl ?? fetch;
  const version = cfg.apiVersion ?? "v23.0";
  const res = await f(`https://graph.facebook.com/${version}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
      ...(replyToId ? { context: { message_id: replyToId } } : {}),
    }),
  });
  await res.body?.cancel().catch(() => {});
  return res.ok;
}

/** Marca el mensaje como leído (doble check azul). */
export async function markAsRead(cfg: SendConfig, messageId: string): Promise<boolean> {
  const f = cfg.fetchImpl ?? fetch;
  const version = cfg.apiVersion ?? "v23.0";
  const res = await f(`https://graph.facebook.com/${version}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  });
  await res.body?.cancel().catch(() => {});
  return res.ok;
}
