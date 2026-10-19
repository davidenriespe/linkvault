// Descarga segura de páginas externas con protección contra SSRF.
// Módulo puro: el resolvedor DNS y fetch se inyectan para poder probarlo.

export type Resolver = (hostname: string) => Promise<string[]>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "kubernetes.default"]);

/** IPv4 → número entero sin signo, o null si no es IPv4 literal. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr4(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
  return (ip & mask) >>> 0 === (b & mask) >>> 0;
}

const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4.some(([base, bits]) => inCidr4(n, base, bits));
}

/** Expande una IPv6 a 8 grupos de 16 bits. Devuelve null si no es válida. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // Sufijo IPv4 embebido (::ffff:1.2.3.4)
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

export function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return false;
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  // :: y ::1
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4 mapeada (::ffff:a.b.c.d) o compatible (::a.b.c.d)
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(v4);
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 únicas locales
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsoleta)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentación
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 descarte
  if (g[0] === 0x2002) {
    // 6to4: comprueba la IPv4 embebida
    return isPrivateIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  }
  return false;
}

export function isIpLiteral(host: string): boolean {
  return ipv4ToInt(host) !== null || expandIPv6(host) !== null;
}

export function isPrivateAddress(ip: string): boolean {
  return isPrivateIPv4(ip) || isPrivateIPv6(ip);
}

/** Valida la URL antes de cualquier conexión. Lanza BlockedUrlError si no es segura. */
export function assertSafeUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("URL inválida");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Protocolo no permitido");
  if (u.username || u.password) throw new BlockedUrlError("Credenciales en la URL");
  if (u.port && !["80", "443"].includes(u.port)) throw new BlockedUrlError("Puerto no permitido");
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) throw new BlockedUrlError("Host vacío");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BlockedUrlError("Host interno no permitido");
  }
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError("Dirección IP privada o reservada");
  } else if (!host.includes(".")) {
    throw new BlockedUrlError("Host sin dominio público");
  }
  return u;
}

/** Resuelve el host y bloquea si alguna dirección es privada. */
export async function assertPublicHost(u: URL, resolve: Resolver): Promise<void> {
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (isIpLiteral(host)) return; // ya validada en assertSafeUrlShape
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new BlockedUrlError("No se pudo resolver el dominio");
  }
  if (addresses.length === 0) throw new BlockedUrlError("El dominio no tiene direcciones");
  for (const a of addresses) {
    if (isPrivateAddress(a)) throw new BlockedUrlError("El dominio apunta a una red interna");
  }
}

export interface SafeFetchOptions {
  resolve: Resolver;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

/**
 * Descarga una página HTML siguiendo redirecciones manualmente y
 * revalidando cada salto (forma de la URL + DNS). Limita tiempo y tamaño.
 */
export async function safeFetchHtml(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const ua = opts.userAgent ?? "LinkVaultBot/1.0 (+vista previa de enlaces personal)";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const u = assertSafeUrlShape(current);
      await assertPublicHost(u, opts.resolve);

      const res = await fetchImpl(u.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "es-EC,es;q=0.9,en;q=0.7",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new BlockedUrlError("Redirección sin destino");
        current = new URL(loc, u).toString();
        continue;
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        await res.body?.cancel().catch(() => {});
        return { finalUrl: u.toString(), status: res.status, contentType, body: "", truncated: false };
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      const { text, truncated } = await readLimited(res, maxBytes, declared > maxBytes);
      return { finalUrl: u.toString(), status: res.status, contentType, body: text, truncated };
    }
    throw new BlockedUrlError("Demasiadas redirecciones");
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res: Response, maxBytes: number, forceTruncate: boolean) {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = forceTruncate;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}
