import { describe, expect, it } from "vitest";
import {
  BlockedUrlError,
  assertSafeUrlShape,
  isPrivateIPv4,
  isPrivateIPv6,
  safeFetchHtml,
  type Resolver,
} from "../supabase/functions/_shared/ssrf.ts";

describe("rangos privados", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
  ])("IPv4 %s es privada", (ip) => expect(isPrivateIPv4(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "200.107.10.5"])("IPv4 %s es pública", (ip) =>
    expect(isPrivateIPv4(ip)).toBe(false),
  );

  it.each([
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "ff02::1",
  ])("IPv6 %s es privada", (ip) => expect(isPrivateIPv6(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])("IPv6 %s es pública", (ip) =>
    expect(isPrivateIPv6(ip)).toBe(false),
  );
});

describe("assertSafeUrlShape", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://localhost/",
    "http://servicio.internal/",
    "http://2130706433/", // 127.0.0.1 en decimal (el parser lo normaliza)
    "http://0x7f.0.0.1/",
    "https://ejemplo.com:22/",
    "file:///etc/passwd",
    "gopher://ejemplo.com/",
    "https://user:pw@ejemplo.com/",
  ])("bloquea %s", (url) => {
    expect(() => assertSafeUrlShape(url)).toThrow(BlockedUrlError);
  });

  it("permite URLs públicas normales", () => {
    expect(assertSafeUrlShape("https://ejemplo.com/ruta").hostname).toBe("ejemplo.com");
  });
});

const publicResolver: Resolver = async () => ["93.184.216.34"];

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}

describe("safeFetchHtml", () => {
  it("bloquea dominios que resuelven a IP privada (DNS rebinding)", async () => {
    await expect(
      safeFetchHtml("https://malicioso.example/", {
        resolve: async () => ["10.0.0.5"],
        fetchImpl: async () => htmlResponse("x"),
      }),
    ).rejects.toThrow(/red interna/);
  });

  it("revalida cada redirección y bloquea saltos a destinos internos", async () => {
    const fetchImpl = async (url: string) => {
      if (url.startsWith("https://publico.example")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      }
      return htmlResponse("secreto");
    };
    await expect(safeFetchHtml("https://publico.example/", { resolve: publicResolver, fetchImpl })).rejects.toThrow(
      BlockedUrlError,
    );
  });

  it("sigue redirecciones públicas", async () => {
    const fetchImpl = async (url: string) =>
      url === "https://a.example/"
        ? new Response(null, { status: 301, headers: { location: "/final" } })
        : htmlResponse("<title>Final</title>");
    const r = await safeFetchHtml("https://a.example/", { resolve: publicResolver, fetchImpl });
    expect(r.finalUrl).toBe("https://a.example/final");
    expect(r.body).toContain("Final");
  });

  it("corta las cadenas de redirección demasiado largas", async () => {
    let i = 0;
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: `/r${i++}` } });
    await expect(
      safeFetchHtml("https://bucle.example/", { resolve: publicResolver, fetchImpl, maxRedirects: 3 }),
    ).rejects.toThrow(/Demasiadas redirecciones/);
  });

  it("limita el tamaño descargado", async () => {
    const big = "a".repeat(50_000);
    const r = await safeFetchHtml("https://grande.example/", {
      resolve: publicResolver,
      fetchImpl: async () => htmlResponse(big),
      maxBytes: 1000,
    });
    expect(r.body.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  it("no descarga contenido que no es HTML", async () => {
    const r = await safeFetchHtml("https://pdf.example/doc.pdf", {
      resolve: publicResolver,
      fetchImpl: async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
    });
    expect(r.body).toBe("");
    expect(r.contentType).toContain("application/pdf");
  });
});
