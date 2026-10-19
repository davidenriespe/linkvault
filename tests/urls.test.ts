import { describe, expect, it } from "vitest";
import { extractUrls, normalizeUrl } from "../supabase/functions/_shared/urls.ts";

describe("extractUrls", () => {
  it("extrae varias URLs de un texto y limpia la puntuación final", () => {
    const text = "Mira esto: https://ejemplo.com/a, y también (https://otro.org/b). ¡Genial!";
    expect(extractUrls(text)).toEqual(["https://ejemplo.com/a", "https://otro.org/b"]);
  });

  it("conserva paréntesis equilibrados (estilo Wikipedia)", () => {
    expect(extractUrls("https://es.wikipedia.org/wiki/SIG_(geografía)")).toEqual([
      "https://es.wikipedia.org/wiki/SIG_(geografía)",
    ]);
  });

  it("acepta URLs sin protocolo que empiezan por www.", () => {
    expect(extractUrls("revisa www.qgis.org/es/site/ hoy")).toEqual(["https://www.qgis.org/es/site/"]);
  });

  it("formato típico del menú Compartir de Android", () => {
    const text = "Analista SIG Junior - Quito | LinkedIn\nhttps://www.linkedin.com/jobs/view/4012345678/?trk=share";
    expect(extractUrls(text)).toEqual(["https://www.linkedin.com/jobs/view/4012345678/?trk=share"]);
  });

  it("devuelve lista vacía si no hay URLs", () => {
    expect(extractUrls("hola, ¿cómo estás?")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });

  it("elimina duplicados exactos y limita a 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => `https://e.com/${i}`).join(" ");
    expect(extractUrls(`${many} https://e.com/0`)).toHaveLength(10);
  });

  it("ignora protocolos peligrosos", () => {
    expect(extractUrls("javascript:alert(1) file:///etc/passwd")).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("quita parámetros de seguimiento, fragmento, www y barra final", () => {
    const n = normalizeUrl("https://WWW.Ejemplo.com/Ruta/?utm_source=wa&b=2&a=1&fbclid=xyz#seccion");
    expect(n?.normalized).toBe("https://ejemplo.com/Ruta?a=1&b=2");
    expect(n?.domain).toBe("ejemplo.com");
  });

  it("http y https producen la misma clave", () => {
    expect(normalizeUrl("http://ejemplo.com/a")?.normalized).toBe(normalizeUrl("https://ejemplo.com/a")?.normalized);
  });

  it("youtu.be se convierte a youtube.com/watch", () => {
    expect(normalizeUrl("https://youtu.be/dQw4w9WgXcQ?si=abc")?.normalized).toBe(
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("rechaza protocolos no web, credenciales y hosts sin dominio", () => {
    expect(normalizeUrl("ftp://ejemplo.com/a")).toBeNull();
    expect(normalizeUrl("https://user:pass@ejemplo.com/")).toBeNull();
    expect(normalizeUrl("https://localhost/")).toBeNull();
    expect(normalizeUrl("no es una url")).toBeNull();
  });

  it("conserva puertos no estándar", () => {
    expect(normalizeUrl("https://ejemplo.com:8443/x")?.normalized).toBe("https://ejemplo.com:8443/x");
  });
});
