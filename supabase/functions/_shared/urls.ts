// Extracción y normalización de URLs.
// Módulo puro (sin dependencias de Deno) para poder probarlo con Vitest.

const MAX_URLS_PER_MESSAGE = 10;

// Captura http(s)://… y también "www.dominio…" sin protocolo.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`{}|\\^]+/gi;

// Caracteres que suelen pegarse al final de una URL dentro de un texto.
const TRAILING = /[.,;:!?¡¿)\]}>»”’'"…]+$/u;

/** Parámetros de seguimiento que no cambian el contenido de la página. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref_src",
  "ref_url",
  "s_cid",
  "trk",
  "trackingid",
  "refid",
  "lipi",
  "si",
  "feature",
  "share_id",
  "mibextid",
  "rdt",
  "spm",
  "scm",
  "xmt",
  "_ga",
  "_gl",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
]);

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    let candidate = match[0];
    // Paréntesis de cierre: sólo se conserva si está equilibrado (p. ej. Wikipedia).
    candidate = trimTrailing(candidate);
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    try {
      const u = new URL(candidate);
      if (!u.hostname.includes(".")) continue;
      found.add(candidate);
    } catch {
      // URL inválida: se ignora.
    }
    if (found.size >= MAX_URLS_PER_MESSAGE) break;
  }
  return [...found];
}

function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    const m = out.match(TRAILING);
    if (!m) return out;
    const tail = m[0];
    // Si termina en ")" y hay "(" sin cerrar, se conserva uno.
    if (tail.endsWith(")")) {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (opens >= closes && tail === ")") return out;
    }
    out = out.slice(0, -1);
  }
}

export interface NormalizedUrl {
  original: string;
  normalized: string;
  domain: string;
}

/**
 * Normaliza una URL para detectar duplicados:
 * - sólo http/https, sin credenciales embebidas;
 * - host en minúsculas y sin «www.»;
 * - sin puerto por defecto, sin fragmento (#…);
 * - sin parámetros de seguimiento (utm_*, fbclid…) y con los demás ordenados;
 * - sin barra final (salvo la raíz);
 * - youtu.be/ID → youtube.com/watch?v=ID.
 * Devuelve null si la URL no es válida o usa otro protocolo.
 */
export function normalizeUrl(raw: string): NormalizedUrl | null {
  let input = raw.trim();
  if (!input) return null;
  if (/^www\./i.test(input)) input = `https://${input}`;
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  if (input.length > 4096) return null;

  const original = u.toString();

  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (host.startsWith("m.") && /^(m\.)(youtube|facebook|wikipedia)\./.test(host)) {
    host = host.slice(2);
  }

  let pathname = u.pathname;
  const params = new URLSearchParams(u.search);

  // youtu.be/ID → youtube.com/watch?v=ID
  if (host === "youtu.be" && pathname.length > 1) {
    const id = pathname.slice(1).split("/")[0];
    host = "youtube.com";
    pathname = "/watch";
    params.set("v", id);
  }

  const kept: [string, string][] = [];
  for (const [k, v] of params) {
    const key = k.toLowerCase();
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) continue;
    kept.push([k, v]);
  }
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = new URLSearchParams(kept).toString();

  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";

  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  const normalized = `https://${host}${port}${pathname}${query ? `?${query}` : ""}`;

  return { original, normalized, domain: host };
}
