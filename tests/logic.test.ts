import { describe, expect, it } from "vitest";
import {
  BOM,
  EMPTY_FILTERS,
  applyFilters,
  buildDigest,
  computeStats,
  csvCell,
  isExpiringSoon,
  isProtected,
  matchesSearch,
  matchesView,
  msUntilArchive,
  reviewToday,
  sortLinks,
  staleDays,
  toCsv,
} from "../src/lib/logic.ts";
import type { Category, JobDetails, LinkView } from "../src/lib/types.ts";

const NOW = new Date("2026-10-19T12:00:00Z").getTime();
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const cat = (slug: string, name = slug): Category => ({
  id: `cat-${slug}`,
  user_id: "u",
  name,
  slug,
  color: "#000000",
  icon: "tag",
  is_default: true,
  sort_order: 1,
});

let seq = 0;
function link(p: Partial<LinkView> = {}): LinkView {
  seq++;
  return {
    id: `l${seq}`,
    user_id: "u",
    original_url: `https://ejemplo.com/${seq}`,
    normalized_url: `https://ejemplo.com/${seq}`,
    domain: "ejemplo.com",
    title: `Enlace ${seq}`,
    description: null,
    summary: null,
    preview_image: null,
    site_name: null,
    category_id: null,
    category_source: "reglas",
    status: "nuevo",
    status_before_archive: null,
    priority: "media",
    notes: null,
    tags: [],
    source: "whatsapp",
    is_demo: false,
    share_count: 1,
    received_at: iso(-1),
    last_shared_at: iso(-1),
    reviewed_at: null,
    archived_at: null,
    discarded_at: null,
    expires_at: iso(6),
    favorite: false,
    metadata_status: "ok",
    metadata_error: null,
    created_at: iso(-1),
    updated_at: iso(-1),
    category: null,
    job: null,
    ...p,
  };
}

const job = (p: Partial<JobDetails>): JobDetails => ({
  link_id: "x",
  user_id: "u",
  company: null,
  job_title: null,
  location: null,
  work_mode: null,
  published_at: null,
  deadline: null,
  salary: null,
  opportunity_status: "desconocida",
  application_status: "pendiente_revisar",
  reviewed_at: null,
  observations: null,
  extracted_fields: [],
  created_at: iso(0),
  updated_at: iso(0),
  ...p,
});

describe("vistas", () => {
  it("separa bandeja, archivo y descartados", () => {
    const n = link();
    const a = link({ status: "archivado" });
    const d = link({ status: "descartado" });
    expect(matchesView(n, "bandeja")).toBe(true);
    expect(matchesView(a, "bandeja")).toBe(false);
    expect(matchesView(a, "archivados")).toBe(true);
    expect(matchesView(d, "descartados")).toBe(true);
    expect(matchesView(d, "todo")).toBe(true);
  });
  it("agrupa temas por categoría y excluye archivados", () => {
    const ia = link({ category: cat("ia") });
    const curso = link({ category: cat("formacion") });
    const empleoArch = link({ category: cat("empleo"), status: "archivado" });
    expect(matchesView(ia, "tecnologia-ia")).toBe(true);
    expect(matchesView(curso, "aprendizaje")).toBe(true);
    expect(matchesView(empleoArch, "empleo")).toBe(false);
  });
});

describe("retención", () => {
  it("protege favoritos, seguimiento y postulaciones activas", () => {
    expect(isProtected(link({ favorite: true }))).toBe(true);
    expect(isProtected(link({ status: "seguimiento" }))).toBe(true);
    expect(isProtected(link({ job: job({ application_status: "postulado" }) }))).toBe(true);
    expect(isProtected(link({ job: job({ application_status: "interesante" }) }))).toBe(false);
  });
  it("calcula el tiempo restante y «vence pronto»", () => {
    const soon = link({ expires_at: iso(1) });
    const later = link({ expires_at: iso(5) });
    expect(isExpiringSoon(soon, NOW)).toBe(true);
    expect(isExpiringSoon(later, NOW)).toBe(false);
    expect(msUntilArchive(link({ favorite: true, expires_at: iso(1) }), NOW)).toBeNull();
    expect(msUntilArchive(link({ status: "archivado" }), NOW)).toBeNull();
  });
  it("detecta pendientes antiguos", () => {
    expect(staleDays(link({ received_at: iso(-4) }), 3, NOW)).toBe(4);
    expect(staleDays(link({ received_at: iso(-1) }), 3, NOW)).toBeNull();
    expect(staleDays(link({ received_at: iso(-9), status: "visto" }), 3, NOW)).toBeNull();
  });
});

describe("búsqueda y filtros", () => {
  it("busca sin distinguir tildes en notas, etiquetas y empresa", () => {
    const l = link({
      title: "Teledetección aplicada",
      notes: "Revisar el viernes",
      tags: ["qgis"],
      job: job({ company: "Petroecuador" }),
    });
    expect(matchesSearch(l, "teledeteccion")).toBe(true);
    expect(matchesSearch(l, "viernes qgis")).toBe(true);
    expect(matchesSearch(l, "petroecuador")).toBe(true);
    expect(matchesSearch(l, "arcgis")).toBe(false);
  });
  it("filtra por estado, favoritos y rango de recepción", () => {
    const fav = link({ favorite: true, received_at: "2026-10-10T15:00:00Z" });
    expect(applyFilters(fav, { ...EMPTY_FILTERS, favoritesOnly: true }, NOW)).toBe(true);
    expect(applyFilters(fav, { ...EMPTY_FILTERS, status: "visto" }, NOW)).toBe(false);
    expect(applyFilters(fav, { ...EMPTY_FILTERS, receivedFrom: "2026-10-11" }, NOW)).toBe(false);
    expect(applyFilters(fav, { ...EMPTY_FILTERS, reviewedFrom: "2026-10-01" }, NOW)).toBe(false);
  });
  it("ordena por fecha límite con las ofertas sin fecha al final", () => {
    const a = link({ job: job({ deadline: "2026-10-25" }) });
    const b = link({ job: job({ deadline: "2026-10-21" }) });
    const c = link();
    expect(sortLinks([a, c, b], "deadline_asc").map((x) => x.id)).toEqual([b.id, a.id, c.id]);
  });
});

describe("indicadores y recomendaciones", () => {
  it("cuenta indicadores", () => {
    const s = computeStats(
      [
        link(),
        link({ status: "visto", reviewed_at: iso(0) }),
        link({ status: "archivado" }),
        link({ favorite: true, received_at: iso(-10) }),
      ],
      NOW,
    );
    expect(s.total).toBe(4);
    expect(s.pending).toBe(2);
    expect(s.reviewed).toBe(1);
    expect(s.archived).toBe(1);
    expect(s.favorites).toBe(1);
    expect(s.last7Days).toBe(3);
  });
  it("prioriza ofertas con fecha límite próxima", () => {
    const urgent = link({ category: cat("empleo"), job: job({ deadline: "2026-10-20" }) });
    const old = link({ received_at: iso(-5) });
    const recs = reviewToday([old, urgent], 3, NOW);
    expect(recs[0].link.id).toBe(urgent.id);
    expect(recs[0].kind).toBe("deadline");
    expect(recs.some((r) => r.link.id === old.id && r.kind === "stale")).toBe(true);
  });
  it("arma el digest diario", () => {
    const d = buildDigest(
      [link({ received_at: iso(-0.5), category: cat("empleo") }), link({ favorite: true, received_at: iso(-2) })],
      NOW,
    );
    expect(d.newToday).toBe(1);
    expect(d.jobsPending).toBe(1);
    expect(d.favoritesUnreviewed).toBe(1);
  });
});

describe("exportación CSV", () => {
  it("escapa comillas y neutraliza fórmulas", () => {
    expect(csvCell('Hola "mundo"')).toBe('"Hola ""mundo"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
  });
  it("incluye cabecera y una fila por enlace", () => {
    const csv = toCsv([link(), link()]);
    expect(csv.startsWith(`${BOM}id,titulo,url`)).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
