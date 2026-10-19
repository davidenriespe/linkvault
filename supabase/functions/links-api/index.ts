// API autenticada para el dashboard de LinkVault.
// Acciones:
//   { action: "add", url }       → guarda un enlace a mano (mismo flujo que WhatsApp)
//   { action: "refetch", id }    → vuelve a obtener metadatos y clasificar
//   { action: "status" }         → qué integraciones están configuradas (sólo booleanos)

import {
  CORS_HEADERS,
  enrichLink,
  env,
  ingestUrl,
  json,
  rateLimited,
  serviceClient,
  userFromRequest,
} from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, CORS_HEADERS);

  const user = await userFromRequest(req);
  if (!user) return json({ error: "No autenticado" }, 401, CORS_HEADERS);

  let body: { action?: string; url?: string; id?: string };
  try {
    const raw = await req.text();
    if (raw.length > 16_384) return json({ error: "Solicitud demasiado grande" }, 413, CORS_HEADERS);
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "JSON inválido" }, 400, CORS_HEADERS);
  }

  const sb = serviceClient();

  switch (body.action) {
    case "add": {
      if (typeof body.url !== "string" || body.url.length > 4096) {
        return json({ error: "URL requerida" }, 400, CORS_HEADERS);
      }
      if (await rateLimited(sb, user.id))
        return json({ error: "Demasiadas solicitudes, espera un minuto" }, 429, CORS_HEADERS);
      const result = await ingestUrl(sb, user.id, body.url, "manual");
      return json(result, result.ok ? 200 : 400, CORS_HEADERS);
    }

    case "refetch": {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return json({ error: "id inválido" }, 400, CORS_HEADERS);
      }
      // Se comprueba la propiedad antes de usar la clave de servicio.
      const { data: link } = await sb
        .from("links")
        .select("id, original_url, domain")
        .eq("id", body.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!link) return json({ error: "Enlace no encontrado" }, 404, CORS_HEADERS);
      if (await rateLimited(sb, user.id, 60)) return json({ error: "Demasiadas solicitudes" }, 429, CORS_HEADERS);
      await enrichLink(sb, link.id, user.id, link.original_url, link.domain);
      return json({ ok: true }, 200, CORS_HEADERS);
    }

    case "status": {
      return json(
        {
          whatsapp_verify_token: Boolean(env("WHATSAPP_VERIFY_TOKEN")),
          whatsapp_app_secret: Boolean(env("WHATSAPP_APP_SECRET")),
          whatsapp_access_token: Boolean(env("WHATSAPP_ACCESS_TOKEN")),
          whatsapp_phone_number_id: Boolean(env("WHATSAPP_PHONE_NUMBER_ID")),
          ai_provider: Boolean(env("ANTHROPIC_API_KEY")),
          ai_model: env("AI_MODEL") ?? (env("ANTHROPIC_API_KEY") ? "claude-haiku-5-5" : null),
          webhook_url: `${env("SUPABASE_URL")}/functions/v1/whatsapp-webhook`,
        },
        200,
        CORS_HEADERS,
      );
    }

    default:
      return json({ error: "Acción desconocida" }, 400, CORS_HEADERS);
  }
});
