// Lógica pura del dashboard: vistas, filtros, orden, indicadores,
// recomendaciones y exportación. Sin dependencias de React ni de red,
// para poder probarla con Vitest (tests/logic.test.ts).

import type { ApplicationStatus, LinkPriority, LinkStatus, LinkView } from "./types.ts";

export const DAY_MS = 86_400_000;
export const EXPIRING_SOON_MS = 2 * DAY_MS;

export const STATUS_LABEL: Record<LinkStatus, string> = {
  nuevo: "Nuevo",
  pendiente: "Pendiente de revisar",
  visto: "Visto",
  seguimiento: "En seguimiento",
  archivado: "Archivado",
  descartado: "Descartado",
};

export const PRIORITY_LABEL: Record<LinkPriority, string> = { baja: "Baja", media: "Media", alta: "Alta" };
export const PRIORITY_RANK: Record<LinkPriority, number> = { alta: 3, media: 2, baja: 1 };

export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  pendiente_revisar: "Pendiente de revisar",
  interesante: "Interesante",
  postulacion_iniciada: "Postulación iniciada",
  postulado: "Postulado",
  descartado: "Descartado",
  cerrado: "Cerrado",
};

export const ACTIVE_APPLICATION: ApplicationStatus[] = ["postulacion_iniciada", "postulado"];
export const ACTIVE_STATUSES: LinkStatus[] = ["nuevo", "pendiente", "visto", "seguimiento"];
const ARCHIVABLE: LinkStatus[] = ["nuevo", "pendiente", "visto"];

// ---------------------------------------------------------------------------
// Vistas de la barra lateral
// ---------------------------------------------------------------------------
export type ViewKey =
  | "inicio"
  | "todo"
  | "bandeja"
  | "por-revisar"
  | "empleo"
  | "aprendizaje"
  | "tecnologia-ia"
  | "favoritos"
  | "seguimiento"
  | "archivados"
  | "descartados"
  | "ajustes";

export const VIEW_LABEL: Record<ViewKey, string> = {
  inicio: "Inicio",
  todo: "Todo",
  bandeja: "Bandeja de entrada",
  "por-revisar": "Por revisar",
  empleo: "Empleo",
  aprendizaje: "Aprendizaje",
  "tecnologia-ia": "Tecnología e IA",
  favoritos: "Favoritos",
  seguimiento: "En seguimiento",
  archivados: "Archivados",
  descartados: "Descartados",
  ajustes: "Ajustes",
};

const isActive = (l: LinkView) => ACTIVE_STATUSES.includes(l.status);
const slugIn = (l: LinkView, slugs: string[]) => Boolean(l.category && slugs.includes(l.category.slug));

export function matchesView(l: LinkView, view: ViewKey): boolean {
  switch (view) {
    case "todo":
      return true;
    case "bandeja":
      return l.status === "nuevo";
    case "por-revisar":
      return l.status === "nuevo" || l.status === "pendiente";
    case "empleo":
      return isActive(l) && slugIn(l, ["empleo"]);
    case "aprendizaje":
      return isActive(l) && slugIn(l, ["formacion", "investigacion"]);
    case "tecnologia-ia":
      return isActive(l) && slugIn(l, ["ia", "programacion", "tecnologia"]);
    case "favoritos":
      return l.favorite && l.status !== "descartado";
    case "seguimiento":
      return l.status === "seguimiento";
    case "archivados":
      return l.status === "archivado";
    case "descartados":
      return l.status === "descartado";
    default:
      return isActive(l);
  }
}

// ---------------------------------------------------------------------------
// Reglas de retención (espejo de public.archive_expired_links)
// ---------------------------------------------------------------------------
export function isProtected(l: LinkView): boolean {
  return (
    l.favorite || l.status === "seguimiento" || Boolean(l.job && ACTIVE_APPLICATION.includes(l.job.application_status))
  );
}

export function willAutoArchive(l: LinkView): boolean {
  return ARCHIVABLE.includes(l.status) && !isProtected(l);
}

export function msUntilArchive(l: LinkView, now = Date.now()): number | null {
  if (!willAutoArchive(l)) return null;
  return new Date(l.expires_at).getTime() - now;
}

export function isExpiringSoon(l: LinkView, now = Date.now()): boolean {
  const ms = msUntilArchive(l, now);
  return ms !== null && ms <= EXPIRING_SOON_MS;
}

/** Pendiente sin revisar durante más de `staleDays`. */
export function staleDays(l: LinkView, staleAfter: number, now = Date.now()): number | null {
  if (l.status !== "nuevo" && l.status !== "pendiente") return null;
  const days = Math.floor((now - new Date(l.received_at).getTime()) / DAY_MS);
  return days >= staleAfter ? days : null;
}

export function daysUntil(dateIso: string | null, now = Date.now()): number | null {
  if (!dateIso) return null;
  // Diferencia en días de calendario locales (hoy = 0, mañana = 1…).
  const target = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Búsqueda y filtros
// ---------------------------------------------------------------------------
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesSearch(l: LinkView, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  const hay = foldText(
    [
      l.title,
      l.description,
      l.summary,
      l.original_url,
      l.domain,
      l.site_name,
      l.notes,
      l.tags.join(" "),
      l.category?.name,
      l.job?.company,
      l.job?.job_title,
      l.job?.location,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export interface Filters {
  categoryId: string | "";
  status: LinkStatus | "";
  priority: LinkPriority | "";
  domain: string;
  receivedFrom: string; // YYYY-MM-DD
  receivedTo: string;
  reviewedFrom: string;
  reviewedTo: string;
  favoritesOnly: boolean;
  pendingOnly: boolean;
  expiringOnly: boolean;
  tag: string;
}

export const EMPTY_FILTERS: Filters = {
  categoryId: "",
  status: "",
  priority: "",
  domain: "",
  receivedFrom: "",
  receivedTo: "",
  reviewedFrom: "",
  reviewedTo: "",
  favoritesOnly: false,
  pendingOnly: false,
  expiringOnly: false,
  tag: "",
};

export function countActiveFilters(f: Filters): number {
  return (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter((k) => f[k] !== EMPTY_FILTERS[k]).length;
}

function inRange(iso: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const day = toLocalDay(iso);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function toLocalDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function applyFilters(l: LinkView, f: Filters, now = Date.now()): boolean {
  if (f.categoryId && l.category_id !== f.categoryId) return false;
  if (f.status && l.status !== f.status) return false;
  if (f.priority && l.priority !== f.priority) return false;
  if (f.domain && l.domain !== f.domain) return false;
  if (f.tag && !l.tags.includes(f.tag)) return false;
  if (f.favoritesOnly && !l.favorite) return false;
  if (f.pendingOnly && l.status !== "nuevo" && l.status !== "pendiente") return false;
  if (f.expiringOnly && !isExpiringSoon(l, now)) return false;
  if (!inRange(l.received_at, f.receivedFrom, f.receivedTo)) return false;
  if (!inRange(l.reviewed_at, f.reviewedFrom, f.reviewedTo)) return false;
  return true;
}

export type SortKey = "received_desc" | "received_asc" | "reviewed_desc" | "priority_desc" | "deadline_asc";

export const SORT_LABEL: Record<SortKey, string> = {
  received_desc: "Más recientes (recepción o reenvío)",
  received_asc: "Recepción (antiguos primero)",
  reviewed_desc: "Fecha de revisión",
  priority_desc: "Prioridad",
  deadline_asc: "Fecha límite de postulación",
};

export function sortLinks(list: LinkView[], key: SortKey): LinkView[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const out = [...list];
  switch (key) {
    case "received_asc":
      return out.sort((a, b) => t(a.received_at) - t(b.received_at));
    case "reviewed_desc":
      return out.sort((a, b) => t(b.reviewed_at) - t(a.reviewed_at) || t(b.received_at) - t(a.received_at));
    case "priority_desc":
      return out.sort(
        (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || t(b.received_at) - t(a.received_at),
      );
    case "deadline_asc":
      return out.sort((a, b) => {
        const da = a.job?.deadline ? t(a.job.deadline) : Infinity;
        const db = b.job?.deadline ? t(b.job.deadline) : Infinity;
        return da - db || t(b.received_at) - t(a.received_at);
      });
    default:
      return out.sort((a, b) => t(b.last_shared_at) - t(a.last_shared_at));
  }
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
export interface Stats {
  total: number;
  pending: number;
  reviewed: number;
  favorites: number;
  expiringSoon: number;
  archived: number;
  last7Days: number;
  discarded: number;
}

export function computeStats(links: LinkView[], now = Date.now()): Stats {
  const weekAgo = now - 7 * DAY_MS;
  return {
    total: links.length,
    pending: links.filter((l) => l.status === "nuevo" || l.status === "pendiente").length,
    reviewed: links.filter((l) => l.status === "visto" || (l.reviewed_at && l.status !== "descartado")).length,
    favorites: links.filter((l) => l.favorite).length,
    expiringSoon: links.filter((l) => isExpiringSoon(l, now)).length,
    archived: links.filter((l) => l.status === "archivado").length,
    last7Days: links.filter((l) => new Date(l.received_at).getTime() >= weekAgo).length,
    discarded: links.filter((l) => l.status === "descartado").length,
  };
}

export interface CategoryCount {
  id: string | null;
  name: string;
  color: string;
  count: number;
}

export function categoryDistribution(links: LinkView[]): CategoryCount[] {
  const map = new Map<string, CategoryCount>();
  for (const l of links) {
    if (l.status === "descartado") continue;
    const key = l.category?.id ?? "none";
    const cur = map.get(key) ?? {
      id: l.category?.id ?? null,
      name: l.category?.name ?? "Sin categoría",
      color: l.category?.color ?? "#94a3b8",
      count: 0,
    };
    cur.count++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Enlaces recibidos por día en los últimos `days` días (zona horaria local). */
export function dailySeries(links: LinkView[], days = 30, now = Date.now()): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const counts = new Map<string, number>();
  for (const l of links) {
    const d = toLocalDay(l.received_at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = toLocalDay(new Date(now - i * DAY_MS).toISOString());
    out.push({ day: d, count: counts.get(d) ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// «Para revisar hoy»
// ---------------------------------------------------------------------------
export interface Recommendation {
  link: LinkView;
  reason: string;
  kind: "deadline" | "stale" | "education" | "expiring";
}

export function reviewToday(links: LinkView[], staleAfter: number, now = Date.now(), limit = 8): Recommendation[] {
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  const push = (r: Recommendation) => {
    if (seen.has(r.link.id) || out.length >= limit) return;
    seen.add(r.link.id);
    out.push(r);
  };
  const active = links.filter((l) => ACTIVE_STATUSES.includes(l.status));

  // 1. Ofertas con fecha límite próxima (≤ 7 días) y sin postulación cerrada.
  active
    .filter((l) => l.job?.deadline && !["postulado", "descartado", "cerrado"].includes(l.job.application_status))
    .map((l) => ({ l, d: daysUntil(l.job!.deadline, now)! }))
    .filter(({ d }) => d >= 0 && d <= 7)
    .sort((a, b) => a.d - b.d)
    .forEach(({ l, d }) =>
      push({
        link: l,
        kind: "deadline",
        reason: d === 0 ? "La postulación cierra hoy" : `La postulación cierra en ${d} día${d === 1 ? "" : "s"}`,
      }),
    );

  // 2. Pendientes que llevan más tiempo sin revisión.
  active
    .filter((l) => staleDays(l, staleAfter, now) !== null)
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
    .slice(0, 3)
    .forEach((l) => push({ link: l, kind: "stale", reason: `Sin revisar hace ${staleDays(l, staleAfter, now)} días` }));

  // 3. Recursos educativos marcados como importantes.
  active
    .filter((l) => l.priority === "alta" && l.category?.slug === "formacion" && l.status !== "visto")
    .slice(0, 2)
    .forEach((l) => push({ link: l, kind: "education", reason: "Recurso educativo de prioridad alta" }));

  // 4. Enlaces que se archivarán pronto.
  active
    .filter((l) => isExpiringSoon(l, now))
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    .forEach((l) =>
      push({ link: l, kind: "expiring", reason: `Se archivará ${formatRelativeFuture(msUntilArchive(l, now)!)}` }),
    );

  return out;
}

export function formatRelativeFuture(ms: number): string {
  if (ms <= 0) return "en la próxima limpieza";
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return "en menos de una hora";
  if (h < 48) return `en ${h} h`;
  return `en ${Math.round(h / 24)} días`;
}

// ---------------------------------------------------------------------------
// Digest diario (dentro del dashboard)
// ---------------------------------------------------------------------------
export interface Digest {
  newToday: number;
  jobsPending: number;
  educationSaved: number;
  expiringSoon: number;
  favoritesUnreviewed: number;
}

export function buildDigest(links: LinkView[], now = Date.now()): Digest {
  const dayAgo = now - DAY_MS;
  const weekAgo = now - 7 * DAY_MS;
  const active = links.filter((l) => ACTIVE_STATUSES.includes(l.status));
  return {
    newToday: links.filter((l) => new Date(l.received_at).getTime() >= dayAgo).length,
    jobsPending: active.filter(
      (l) =>
        l.category?.slug === "empleo" &&
        (!l.job || ["pendiente_revisar", "interesante"].includes(l.job.application_status)),
    ).length,
    educationSaved: active.filter(
      (l) => l.category?.slug === "formacion" && new Date(l.received_at).getTime() >= weekAgo,
    ).length,
    expiringSoon: active.filter((l) => isExpiringSoon(l, now)).length,
    favoritesUnreviewed: active.filter((l) => l.favorite && !l.reviewed_at).length,
  };
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------
const CSV_COLUMNS: [string, (l: LinkView) => unknown][] = [
  ["id", (l) => l.id],
  ["titulo", (l) => l.title],
  ["url", (l) => l.original_url],
  ["dominio", (l) => l.domain],
  ["categoria", (l) => l.category?.name],
  ["estado", (l) => STATUS_LABEL[l.status]],
  ["prioridad", (l) => PRIORITY_LABEL[l.priority]],
  ["favorito", (l) => (l.favorite ? "sí" : "no")],
  ["etiquetas", (l) => l.tags.join("; ")],
  ["notas", (l) => l.notes],
  ["descripcion", (l) => l.description],
  ["resumen", (l) => l.summary],
  ["origen", (l) => l.source],
  ["veces_compartido", (l) => l.share_count],
  ["recibido", (l) => l.received_at],
  ["ultimo_envio", (l) => l.last_shared_at],
  ["revisado", (l) => l.reviewed_at],
  ["archivado", (l) => l.archived_at],
  ["vence", (l) => l.expires_at],
  ["empresa", (l) => l.job?.company],
  ["cargo", (l) => l.job?.job_title],
  ["ubicacion", (l) => l.job?.location],
  ["modalidad", (l) => l.job?.work_mode],
  ["fecha_publicacion", (l) => l.job?.published_at],
  ["fecha_limite", (l) => l.job?.deadline],
  ["salario", (l) => l.job?.salary],
  ["estado_postulacion", (l) => (l.job ? APPLICATION_LABEL[l.job.application_status] : "")],
  ["observaciones", (l) => l.job?.observations],
];

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Evita la inyección de fórmulas al abrir el CSV en Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Marca de orden de bytes UTF-8 para que Excel reconozca tildes y eñes. */
export const BOM = String.fromCharCode(0xfeff);

export function toCsv(links: LinkView[]): string {
  const header = CSV_COLUMNS.map(([h]) => h).join(",");
  const rows = links.map((l) => CSV_COLUMNS.map(([, f]) => csvCell(f(l))).join(","));
  // BOM para que Excel detecte UTF-8 (tildes y ñ).
  return BOM + [header, ...rows].join("\r\n");
}
