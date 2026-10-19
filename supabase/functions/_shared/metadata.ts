// Extracción de metadatos (Open Graph, Twitter Cards, <title>, JSON-LD).
// No ejecuta JavaScript ni descarga recursos de la página: sólo analiza texto.

export interface JobPostingData {
  company?: string;
  job_title?: string;
  location?: string;
  work_mode?: "presencial" | "remoto" | "hibrido";
  published_at?: string; // YYYY-MM-DD
  deadline?: string; // YYYY-MM-DD
  salary?: string;
  extracted_fields: string[];
}

export interface PageMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  canonical?: string;
  type?: string;
  keywords?: string;
  lang?: string;
  textSample?: string;
  job?: JobPostingData;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  uuml: "ü",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  Uuml: "Ü",
  iexcl: "¡",
  iquest: "¿",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

/** Limpia texto: decodifica entidades, quita etiquetas y caracteres de control, colapsa espacios. */
export function cleanText(input: string | undefined | null, max = 500): string | undefined {
  if (!input) return undefined;
  const text = decodeEntities(input.replace(/<[^>]*>/g, " "))
    // Caracteres de control (Cc) y de formato invisibles (Cf: ancho cero, bidi).
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const m of tag.matchAll(re)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

function safeHttpUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(decodeEntities(value.trim()), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    const s = u.toString();
    return s.length <= 2048 ? s : undefined;
  } catch {
    return undefined;
  }
}

export function parseHtmlMetadata(html: string, baseUrl: string): PageMetadata {
  // Sólo se analiza la parte inicial del documento (metadatos en <head>).
  const head = html.slice(0, 400_000);
  const meta: Record<string, string> = {};

  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (key && a.content !== undefined && meta[key] === undefined) meta[key] = a.content;
  }

  let canonical: string | undefined;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
      canonical = safeHttpUrl(a.href, baseUrl);
      break;
    }
  }

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const lang = head.match(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]{2,10})/i)?.[1];

  const result: PageMetadata = {
    title: cleanText(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, 300),
    description: cleanText(meta["og:description"] ?? meta["twitter:description"] ?? meta["description"], 600),
    image: safeHttpUrl(
      meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["twitter:image"] ?? meta["twitter:image:src"],
      baseUrl,
    ),
    siteName: cleanText(meta["og:site_name"] ?? meta["application-name"], 120),
    type: cleanText(meta["og:type"], 60),
    keywords: cleanText(meta["keywords"], 300),
    canonical,
    lang: lang?.toLowerCase(),
  };

  result.textSample = extractTextSample(html);
  const job = extractJobPosting(head);
  if (job) result.job = job;
  return result;
}

/** Texto visible aproximado de los primeros párrafos (para resúmenes con IA). */
export function extractTextSample(html: string, max = 2500): string | undefined {
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  const paragraphs: string[] = [];
  let total = 0;
  for (const m of body.matchAll(/<(p|h1|h2|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = cleanText(m[2], 600);
    if (t && t.length > 30) {
      paragraphs.push(t);
      total += t.length;
      if (total > max) break;
    }
  }
  const text = paragraphs.join("\n");
  return text ? text.slice(0, max) : undefined;
}

// ---------------------------------------------------------------------------
// JSON-LD JobPosting (schema.org). Sólo se usa lo que la página declara.
// ---------------------------------------------------------------------------

type Json = unknown;

function* walkJsonLd(node: Json): Generator<Record<string, Json>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJsonLd(n);
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, Json>;
    yield obj;
    if (obj["@graph"]) yield* walkJsonLd(obj["@graph"]);
  }
}

function isType(obj: Record<string, Json>, type: string): boolean {
  const t = obj["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function str(v: Json): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function toIsoDate(v: Json): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : `${m[1]}-${m[2]}-${m[3]}`;
}

function formatLocation(loc: Json): string | undefined {
  const items = Array.isArray(loc) ? loc : [loc];
  const parts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const address = (item as Record<string, Json>).address;
    if (typeof address === "string") {
      parts.push(address);
      continue;
    }
    if (address && typeof address === "object") {
      const a = address as Record<string, Json>;
      const country =
        typeof a.addressCountry === "object" && a.addressCountry
          ? str((a.addressCountry as Record<string, Json>).name)
          : str(a.addressCountry);
      const p = [str(a.addressLocality), str(a.addressRegion), country].filter(Boolean);
      if (p.length) parts.push(p.join(", "));
    }
  }
  const unique = [...new Set(parts)];
  return unique.length ? cleanText(unique.join(" · "), 300) : undefined;
}

function formatSalary(s: Json): string | undefined {
  if (!s || typeof s !== "object") return cleanText(str(s), 200);
  const o = s as Record<string, Json>;
  const currency = str(o.currency) ?? "";
  const value = o.value;
  let amount: string | undefined;
  let unit: string | undefined;
  if (value && typeof value === "object") {
    const v = value as Record<string, Json>;
    const min = str(v.minValue);
    const max = str(v.maxValue);
    const val = str(v.value);
    amount = min && max ? `${min} – ${max}` : (val ?? min ?? max);
    unit = str(v.unitText);
  } else {
    amount = str(value);
  }
  if (!amount) return undefined;
  const unitEs: Record<string, string> = { HOUR: "hora", DAY: "día", WEEK: "semana", MONTH: "mes", YEAR: "año" };
  return cleanText(`${currency} ${amount}${unit ? ` / ${unitEs[unit] ?? unit.toLowerCase()}` : ""}`.trim(), 200);
}

export function extractJobPosting(html: string): JobPostingData | undefined {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: Json;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const obj of walkJsonLd(data)) {
      if (!isType(obj, "JobPosting")) continue;
      const job: JobPostingData = { extracted_fields: [] };
      const set = <K extends keyof JobPostingData>(k: K, v: JobPostingData[K] | undefined) => {
        if (v !== undefined && v !== "") {
          job[k] = v;
          job.extracted_fields.push(k);
        }
      };
      const org = obj.hiringOrganization;
      set(
        "company",
        cleanText(typeof org === "object" && org ? str((org as Record<string, Json>).name) : str(org), 200),
      );
      set("job_title", cleanText(str(obj.title), 300));
      set("location", formatLocation(obj.jobLocation));
      const lt = (str(obj.jobLocationType) ?? "").toUpperCase();
      // schema.org sólo declara explícitamente el trabajo remoto (TELECOMMUTE);
      // presencial/híbrido no se deducen para no inventar información.
      if (lt.includes("TELECOMMUTE")) set("work_mode", "remoto");
      set("published_at", toIsoDate(obj.datePosted));
      set("deadline", toIsoDate(obj.validThrough));
      set("salary", formatSalary(obj.baseSalary));
      return job;
    }
  }
  return undefined;
}
