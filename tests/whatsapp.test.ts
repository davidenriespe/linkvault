import { describe, expect, it, vi } from "vitest";
import {
  hmacSha256Hex,
  parseWebhookPayload,
  sendTextReply,
  timingSafeEqual,
  verifyMetaSignature,
} from "../supabase/functions/_shared/whatsapp.ts";

// Estructura real de un evento de mensaje de la Cloud API.
const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550000000", phone_number_id: "123456789" },
            contacts: [{ profile: { name: "David" }, wa_id: "593990000000" }],
            messages: [
              {
                from: "593990000000",
                id: "wamid.HBgMNTkzOTkwMDAwMDAwFQIAEhgg",
                timestamp: "1760900000",
                type: "text",
                text: { body: "Mira https://qgis.org/es/site/" },
              },
              {
                from: "593990000000",
                id: "wamid.IMG",
                timestamp: "1760900001",
                type: "image",
                image: { id: "media1", caption: "Captura de https://ejemplo.com/x" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parseWebhookPayload", () => {
  it("extrae texto y leyendas de los mensajes entrantes", () => {
    const msgs = parseWebhookPayload(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      id: "wamid.HBgMNTkzOTkwMDAwMDAwFQIAEhgg",
      from: "593990000000",
      type: "text",
      phoneNumberId: "123456789",
    });
    expect(msgs[0].text).toContain("qgis.org");
    expect(msgs[1].text).toContain("ejemplo.com");
  });

  it("ignora eventos de estado y payloads ajenos", () => {
    const statuses = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "x", status: "read" }] } }] }],
    };
    expect(parseWebhookPayload(statuses)).toEqual([]);
    expect(parseWebhookPayload({ object: "page" })).toEqual([]);
    expect(parseWebhookPayload(null)).toEqual([]);
  });
});

describe("verifyMetaSignature", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify(payload);

  it("acepta una firma correcta", async () => {
    const sig = `sha256=${await hmacSha256Hex(secret, body)}`;
    expect(await verifyMetaSignature(body, sig, secret)).toBe(true);
  });

  it("rechaza firmas alteradas, ausentes o de otro algoritmo", async () => {
    const sig = `sha256=${await hmacSha256Hex(secret, body)}`;
    expect(await verifyMetaSignature(`${body} `, sig, secret)).toBe(false);
    expect(await verifyMetaSignature(body, null, secret)).toBe(false);
    expect(await verifyMetaSignature(body, sig.replace("sha256", "sha1"), secret)).toBe(false);
    expect(await verifyMetaSignature(body, sig, "")).toBe(false);
  });

  it("comparación en tiempo constante", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("sendTextReply", () => {
  it("construye la llamada a la Graph API sin exponer el token en la URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await sendTextReply(
      {
        accessToken: "TOKEN",
        phoneNumberId: "123",
        apiVersion: "v23.0",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      "593990000000",
      "Hola",
      "wamid.1",
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect(url).not.toContain("TOKEN");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: "593990000000",
      type: "text",
      context: { message_id: "wamid.1" },
    });
  });
});
