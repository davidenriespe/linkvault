# Conectar WhatsApp a LinkVault

LinkVault usa la integración **oficial** de Meta: _WhatsApp Business Platform (Cloud API)_ con webhooks.
No usa WhatsApp Web, automatización de navegador ni nada que ponga en riesgo tu cuenta personal.

## Cómo funciona (y qué no hace)

```
Tu WhatsApp personal ──(compartir enlace)──▶ Número de LinkVault (Cloud API)
                                                  │  Meta firma el evento (HMAC)
                                                  ▼
                       Supabase Edge Function  whatsapp-webhook
                         1. verifica la firma X-Hub-Signature-256
                         2. idempotencia por id de mensaje
                         3. remitente autorizado (tabla whatsapp_senders)
                         4. extrae URLs → metadatos → clasifica → guarda
                                                  │
                                                  ▼
                        Supabase PostgreSQL ──Realtime──▶ Dashboard
```

- La API **no puede leer tus chats privados**. Sólo recibe los mensajes que envías **al número de LinkVault**.
- Ese número debe ser un número registrado en WhatsApp Business Platform. **No puede ser tu número personal**
  mientras lo uses en la app de WhatsApp. Opciones:
  - **Número de prueba de Meta** (gratis, para empezar): Meta lo crea al configurar la app. Sólo puede escribir a
    números que añadas como destinatarios de prueba (hasta 5).
  - **Un número propio** (una segunda SIM o una línea fija/virtual que reciba SMS o llamada) para uso permanente.
- Sólo se guardan los mensajes enviados desde los números que registres en **Ajustes → Números autorizados**.

## Costes (octubre de 2026)

- **Recibir** mensajes no tiene coste.
- Las **respuestas de confirmación** («✅ Guardado…») son _mensajes de servicio_ dentro de la ventana de 24 h.
  Desde el 1-oct-2026 Meta da **1.000 mensajes de servicio gratis al mes por número**; a partir del 1.001 se cobran.
  Sin método de pago registrado, Meta sólo entrega los del tramo gratuito. Para un uso personal sobra.
  Si quieres cero riesgo de coste, desactiva _Responder por WhatsApp_ en Ajustes.
- LinkVault **no envía plantillas** ni mensajes fuera de la ventana de 24 h (por eso el resumen diario se muestra en el dashboard).
- Fuente: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>

---

## Paso 1 · Crear la app en Meta for Developers

1. Entra en <https://developers.facebook.com/apps> con tu cuenta de Facebook y pulsa **Crear app**.
2. Caso de uso: **Conectar con clientes a través de WhatsApp** (o tipo _Business_ en la vista clásica).
3. Asóciala a un portafolio comercial (Business Manager). Si no tienes uno, el asistente lo crea.
4. En el panel de la app aparece el producto **WhatsApp → Configuración de la API (API Setup)**.

## Paso 2 · Obtener el número y su Phone Number ID

1. En **WhatsApp → API Setup** verás un **número de prueba** y su **Phone number ID** (un número largo).
   Cópialo: será `WHATSAPP_PHONE_NUMBER_ID`.
2. En **To / Destinatario**, añade **tu número personal** y confírmalo con el código que te llega por WhatsApp.
3. Guarda el número de prueba de LinkVault en tus contactos del teléfono (p. ej. «LinkVault»).
4. Para un número propio permanente: **API Setup → Add phone number**, verifícalo por SMS/llamada y usa su nuevo Phone Number ID.

## Paso 3 · Token de acceso permanente

El token temporal del panel caduca en 24 h. Para producción crea uno permanente:

1. <https://business.facebook.com/settings> → **Usuarios → Usuarios del sistema → Añadir** (rol _Administrador_).
2. **Asignar activos** → tu app y tu cuenta de WhatsApp (control total).
3. **Generar token** → selecciona la app, caducidad **Nunca**, permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copia el token: será `WHATSAPP_ACCESS_TOKEN`. **Nunca** lo pegues en el frontend ni en el repositorio.

## Paso 4 · Guardar los secretos en Supabase

En <https://supabase.com/dashboard/project/jmtglvtvfikiqfomrqgp/functions/secrets> añade:

| Secreto                    | Valor                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `WHATSAPP_VERIFY_TOKEN`    | Una cadena larga que **tú inventas** (p. ej. genera 32 caracteres aleatorios). La usarás en el paso 5. |
| `WHATSAPP_APP_SECRET`      | Meta for Developers → tu app → **Configuración de la app → Básica → Clave secreta de la app**.         |
| `WHATSAPP_ACCESS_TOKEN`    | El token permanente del paso 3.                                                                        |
| `WHATSAPP_PHONE_NUMBER_ID` | El Phone Number ID del paso 2.                                                                         |
| `WHATSAPP_API_VERSION`     | Opcional. Versión de Graph API (por defecto `v23.0`; puedes usar la más reciente, p. ej. `v25.0`).     |

Con la CLI sería: `supabase secrets set WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=...`

Los secretos se aplican a las funciones sin volver a desplegarlas.

## Paso 5 · Configurar el webhook en Meta

1. Meta for Developers → tu app → **WhatsApp → Configuración (Configuration) → Webhook → Editar**.
2. **URL de devolución de llamada (Callback URL)**:
   `https://jmtglvtvfikiqfomrqgp.supabase.co/functions/v1/whatsapp-webhook`
   (también la ves y copias en **LinkVault → Ajustes → Estado del sistema**).
3. **Token de verificación**: el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`.
4. Pulsa **Verificar y guardar**. Meta hace un `GET` y la función responde el _challenge_.
   En Ajustes, «Webhook configurado» pasará a verde con la fecha de verificación.
5. En **Campos del webhook**, suscríbete a **`messages`**.

## Paso 6 · Autorizar tu número y probar

1. En LinkVault → **Ajustes → Números autorizados**, añade tu número personal con código de país y sin «+»
   (Ecuador: `5939XXXXXXXX`).
2. Desde el teléfono: abre una página → **Compartir → WhatsApp → LinkVault** → enviar.
3. En segundos el enlace aparece en la **Bandeja de entrada** (sin recargar). Si activaste las confirmaciones,
   recibirás «✅ Guardado: …».
4. En Ajustes, «WhatsApp Business API conectado» pasará a verde con la hora del último mensaje real.

> El primer mensaje lo debes enviar **tú** al número de LinkVault: así se abre la ventana de atención de 24 h
> que permite a LinkVault responder sin plantillas.

## Solución de problemas

| Síntoma                                   | Causa probable / solución                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Meta dice «No se pudo validar la URL»     | `WHATSAPP_VERIFY_TOKEN` no coincide o no está guardado. Revisa el secreto y vuelve a verificar.               |
| El evento llega pero no se guarda nada    | Tu número no está en **Números autorizados** (el evento aparece como «Remitente no autorizado» en Ajustes).   |
| Ningún evento aparece en Ajustes          | No te suscribiste al campo `messages`, o falta `WHATSAPP_APP_SECRET` (la función responde 503 y lo registra). |
| «Invalid signature» en los registros      | `WHATSAPP_APP_SECRET` no es la clave secreta de **esta** app.                                                 |
| Se guarda pero no llega la confirmación   | Falta `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`, el token caducó o desactivaste las confirmaciones.  |
| Con número de prueba no llegan respuestas | Tu número no está en la lista de destinatarios de prueba (paso 2.2).                                          |

Registros de la función: <https://supabase.com/dashboard/project/jmtglvtvfikiqfomrqgp/functions/whatsapp-webhook/logs>

## Detalles técnicos

- **Verificación GET**: `hub.mode=subscribe`, `hub.verify_token` debe coincidir; se devuelve `hub.challenge`.
- **Firma**: `X-Hub-Signature-256 = sha256=HMAC_SHA256(cuerpo_crudo, App Secret)`, comparada en tiempo constante.
- **Respuesta rápida**: la función responde `200 EVENT_RECEIVED` y procesa en segundo plano (`EdgeRuntime.waitUntil`)
  para que Meta no reintente por tiempo de espera.
- **Idempotencia**: `webhook_events (provider, provider_message_id)` es único. Un reintento de Meta con el mismo
  `wamid` no se procesa dos veces; sólo se reintenta si el intento anterior terminó en `error` (máx. 3).
- **Duplicados de URL**: la URL normalizada (sin `utm_*`, `fbclid`, `www.`, fragmento…) es única por usuario.
  Compartir de nuevo actualiza `last_shared_at`, suma `share_count` y, si estaba archivado o descartado, lo devuelve a la bandeja.
- **Modo de prueba**: `POST /whatsapp-webhook?mode=test` con la sesión del usuario procesa un payload con el formato de
  Meta y lo marca como _Simulación_ (`provider = whatsapp_test`). Lo usa el simulador de Ajustes. No demuestra que
  WhatsApp esté conectado.
