import { describe, expect, it } from "vitest";
import { cleanText, extractJobPosting, parseHtmlMetadata } from "../supabase/functions/_shared/metadata.ts";
import { classify } from "../supabase/functions/_shared/classify.ts";
import { parseAiJson } from "../supabase/functions/_shared/ai.ts";

const OG_PAGE = `<!doctype html><html lang="es"><head>
<title>Título de respaldo</title>
<meta property="og:title" content="Curso de QGIS &amp; Teledetección">
<meta property="og:description" content="Aprende análisis espacial con imágenes Sentinel-2.">
<meta property="og:image" content="/img/portada.jpg">
<meta property="og:site_name" content="Academia Geo">
<link rel="canonical" href="https://academia.example/qgis">
</head><body><p>Este curso cubre clasificación supervisada, NDVI y mapas temáticos con QGIS.</p></body></html>`;

describe("parseHtmlMetadata", () => {
  it("lee Open Graph, decodifica entidades y resuelve imágenes relativas", () => {
    const m = parseHtmlMetadata(OG_PAGE, "https://academia.example/cursos/qgis");
    expect(m.title).toBe("Curso de QGIS & Teledetección");
    expect(m.description).toBe("Aprende análisis espacial con imágenes Sentinel-2.");
    expect(m.image).toBe("https://academia.example/img/portada.jpg");
    expect(m.siteName).toBe("Academia Geo");
    expect(m.canonical).toBe("https://academia.example/qgis");
    expect(m.lang).toBe("es");
    expect(m.textSample).toContain("NDVI");
  });

  it("usa <title> si no hay og:title", () => {
    expect(parseHtmlMetadata("<title> Hola  mundo </title>", "https://x.example/").title).toBe("Hola mundo");
  });

  it("descarta imágenes con protocolos peligrosos", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)">`;
    expect(parseHtmlMetadata(html, "https://x.example/").image).toBeUndefined();
  });

  it("elimina etiquetas HTML en textos (defensa contra XSS)", () => {
    expect(cleanText('<img src=x onerror="alert(1)">Hola <b>mundo</b>')).toBe("Hola mundo");
  });
});

describe("extractJobPosting", () => {
  it("extrae sólo los campos declarados en JSON-LD", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Otra" },
        {
          "@type": "JobPosting",
          title: "Técnico Geógrafo",
          hiringOrganization: { "@type": "Organization", name: "Fundación Ejemplo" },
          datePosted: "2026-10-01",
          validThrough: "2026-10-30T23:59",
          jobLocation: {
            "@type": "Place",
            address: { addressLocality: "Baños", addressRegion: "Tungurahua", addressCountry: "EC" },
          },
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "USD",
            value: { "@type": "QuantitativeValue", value: 1200, unitText: "MONTH" },
          },
        },
      ],
    })}</script>`;
    const job = extractJobPosting(html)!;
    expect(job.company).toBe("Fundación Ejemplo");
    expect(job.job_title).toBe("Técnico Geógrafo");
    expect(job.location).toBe("Baños, Tungurahua, EC");
    expect(job.published_at).toBe("2026-10-01");
    expect(job.deadline).toBe("2026-10-30");
    expect(job.salary).toBe("USD 1200 / mes");
    expect(job.work_mode).toBeUndefined(); // no declarado → vacío, no inventado
    expect(job.extracted_fields).not.toContain("work_mode");
  });

  it("devuelve undefined si no hay JobPosting o el JSON es inválido", () => {
    expect(extractJobPosting(`<script type="application/ld+json">{roto</script>`)).toBeUndefined();
    expect(extractJobPosting("<p>nada</p>")).toBeUndefined();
  });
});

describe("classify", () => {
  const c = (url: string, title?: string, description?: string, hasJobPosting = false) => {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    return classify({ url, domain, title, description, hasJobPosting }).slug;
  };

  it("empleo por ruta /jobs/ de LinkedIn", () =>
    expect(c("https://www.linkedin.com/jobs/view/4012345678", "Analista SIG Junior | LinkedIn")).toBe("empleo"));
  it("empleo por JobPosting", () => expect(c("https://empresa.example/oferta-17", "Técnico", "", true)).toBe("empleo"));
  it("formación por dominio", () =>
    expect(c("https://www.coursera.org/learn/gis", "GIS Specialization")).toBe("formacion"));
  it("SIG por palabras clave", () =>
    expect(c("https://blog.example/post", "Clasificación de imágenes Sentinel-2 en QGIS")).toBe("geografia-sig"));
  it("IA por dominio", () => expect(c("https://www.anthropic.com/news/algo", "Novedades")).toBe("ia"));
  it("programación por GitHub", () => expect(c("https://github.com/vitejs/vite", "Vite")).toBe("programacion"));
  it("medio ambiente por palabras clave", () =>
    expect(c("https://revista.example/a", "Remediación de suelos contaminados con hidrocarburos")).toBe(
      "medio-ambiente",
    ));
  it("investigación por DOI", () => expect(c("https://doi.org/10.1000/xyz", "Paper")).toBe("investigacion"));
  it("noticias por dominio", () => expect(c("https://www.primicias.ec/politica/x", "Titular")).toBe("noticias"));
  it("videojuegos por Steam", () => expect(c("https://store.steampowered.com/app/1/", "Juego")).toBe("videojuegos"));
  it("compras por MercadoLibre", () =>
    expect(c("https://articulo.mercadolibre.com.ec/MEC-1", "Laptop")).toBe("compras"));
  it("otros si no hay evidencia", () => expect(c("https://desconocido.example/x", "Hola")).toBe("otros"));
  it("«sig» no coincide dentro de «siguiente»", () =>
    expect(c("https://x.example/a", "Lo siguiente es importante")).toBe("otros"));
  it("«ai» no coincide dentro de «aire»", () => expect(c("https://x.example/a", "Un día al aire libre")).toBe("otros"));
});

describe("parseAiJson", () => {
  it("acepta sólo categorías válidas y limpia etiquetas", () => {
    const r = parseAiJson('Texto previo {"category":"ia","summary":"Resumen.","tags":["LLM!","Agentes","a","b","c"]}');
    expect(r.category).toBe("ia");
    expect(r.summary).toBe("Resumen.");
    expect(r.tags).toEqual(["llm", "agentes", "a", "b"]);
  });
  it("ignora categorías inventadas", () => expect(parseAiJson('{"category":"hackeo"}').category).toBeUndefined());
  it("tolera respuestas no JSON", () => expect(parseAiJson("no sé").tags).toEqual([]));
});
