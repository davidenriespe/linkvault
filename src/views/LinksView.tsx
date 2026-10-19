import { useMemo, useState } from "react";
import { Download, Filter, Inbox, Plus, RotateCcw, X } from "lucide-react";
import type { LinkPriority, LinkStatus, LinkView } from "../lib/types.ts";
import {
  EMPTY_FILTERS,
  PRIORITY_LABEL,
  SORT_LABEL,
  STATUS_LABEL,
  VIEW_LABEL,
  applyFilters,
  countActiveFilters,
  matchesSearch,
  matchesView,
  sortLinks,
  toCsv,
  type Filters,
  type SortKey,
  type ViewKey,
} from "../lib/logic.ts";
import { downloadFile } from "../lib/format.ts";
import { Button, Field, inputCls } from "../components/ui.tsx";
import { LinkCard } from "../components/LinkCard.tsx";
import type { Category } from "../lib/types.ts";

const EMPTY_MESSAGES: Partial<Record<ViewKey, string>> = {
  bandeja: "No hay enlaces nuevos. Comparte uno por WhatsApp y aparecerá aquí al instante.",
  "por-revisar": "¡Todo revisado! No tienes enlaces pendientes.",
  empleo: "Todavía no hay ofertas laborales. Las URLs de portales de empleo se clasifican aquí automáticamente.",
  aprendizaje: "Aquí aparecerán cursos, tutoriales e investigaciones.",
  "tecnologia-ia": "Aquí aparecerán enlaces de IA, programación y tecnología.",
  favoritos: "Marca un enlace con la estrella para protegerlo del archivado y verlo aquí.",
  seguimiento: "Pon enlaces «En seguimiento» desde el menú ⋯ para no perderlos de vista.",
  archivados: "El archivo está vacío. Los enlaces sin revisar se archivan solos al vencer su plazo.",
  descartados: "No hay enlaces descartados.",
};

export function LinksView({
  view,
  links,
  categories,
  search,
  staleAfter,
  onAdd,
  initialFilters,
}: {
  initialFilters?: Partial<Filters>;
  view: ViewKey;
  links: LinkView[];
  categories: Category[];
  search: string;
  staleAfter: number;
  onAdd: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, ...initialFilters }));
  const [sort, setSort] = useState<SortKey>(view === "empleo" ? "deadline_asc" : "received_desc");
  const [showFilters, setShowFilters] = useState(Boolean(initialFilters && Object.keys(initialFilters).length));
  const [exportOpen, setExportOpen] = useState(false);

  // Con una búsqueda activa se busca en todo, incluido el archivo.
  const scope = search.trim() && view === "todo" ? links : links.filter((l) => matchesView(l, view));
  const result = useMemo(
    () =>
      sortLinks(
        scope.filter((l) => matchesSearch(l, search) && applyFilters(l, filters)),
        sort,
      ),
    [scope, search, filters, sort],
  );
  const domains = useMemo(() => [...new Set(links.map((l) => l.domain))].sort(), [links]);
  const tags = useMemo(() => [...new Set(links.flatMap((l) => l.tags))].sort(), [links]);
  const active = countActiveFilters(filters);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const doExport = (kind: "csv" | "json") => {
    setExportOpen(false);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `linkvault-${view}-${stamp}.${kind}`;
    if (kind === "csv") downloadFile(name, toCsv(result), "text/csv;charset=utf-8");
    else
      downloadFile(
        name,
        JSON.stringify(
          { exported_at: new Date().toISOString(), view, search, filters, count: result.length, links: result },
          null,
          2,
        ),
        "application/json",
      );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold tracking-tight">{VIEW_LABEL[view]}</h1>
          <p className="text-[13px] text-[var(--ink-3)]">
            {result.length} enlace{result.length === 1 ? "" : "s"}
            {search.trim() && ` para «${search.trim()}»`}
          </p>
        </div>
        <select
          aria-label="Ordenar"
          className={`${inputCls} h-9 w-auto text-[13px]`}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <Button size="sm" className="h-9" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <Filter size={14} /> Filtros{active ? ` (${active})` : ""}
        </Button>
        <div className="relative">
          <Button size="sm" className="h-9" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
            <Download size={14} /> Exportar
          </Button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="lv-pop absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 text-sm shadow-xl">
                <p className="px-2.5 py-1.5 text-[12px] text-[var(--ink-3)]">
                  Exporta los {result.length} enlaces visibles
                </p>
                <button
                  className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[var(--panel-2)]"
                  onClick={() => doExport("csv")}
                >
                  CSV (Excel / Sheets)
                </button>
                <button
                  className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[var(--panel-2)]"
                  onClick={() => doExport("json")}
                >
                  JSON
                </button>
              </div>
            </>
          )}
        </div>
        <Button size="sm" variant="primary" className="h-9" onClick={onAdd}>
          <Plus size={14} /> Añadir
        </Button>
      </div>

      {showFilters && (
        <div className="lv-pop mb-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Categoría">
              <select
                className={inputCls}
                value={filters.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">Todas</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estado">
              <select
                className={inputCls}
                value={filters.status}
                onChange={(e) => set("status", e.target.value as LinkStatus | "")}
              >
                <option value="">Todos</option>
                {(Object.keys(STATUS_LABEL) as LinkStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioridad">
              <select
                className={inputCls}
                value={filters.priority}
                onChange={(e) => set("priority", e.target.value as LinkPriority | "")}
              >
                <option value="">Todas</option>
                {(Object.keys(PRIORITY_LABEL) as LinkPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dominio">
              <select className={inputCls} value={filters.domain} onChange={(e) => set("domain", e.target.value)}>
                <option value="">Todos</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recibido desde">
              <input
                type="date"
                className={inputCls}
                value={filters.receivedFrom}
                onChange={(e) => set("receivedFrom", e.target.value)}
              />
            </Field>
            <Field label="Recibido hasta">
              <input
                type="date"
                className={inputCls}
                value={filters.receivedTo}
                onChange={(e) => set("receivedTo", e.target.value)}
              />
            </Field>
            <Field label="Revisado desde">
              <input
                type="date"
                className={inputCls}
                value={filters.reviewedFrom}
                onChange={(e) => set("reviewedFrom", e.target.value)}
              />
            </Field>
            <Field label="Revisado hasta">
              <input
                type="date"
                className={inputCls}
                value={filters.reviewedTo}
                onChange={(e) => set("reviewedTo", e.target.value)}
              />
            </Field>
            {tags.length > 0 && (
              <Field label="Etiqueta">
                <select className={inputCls} value={filters.tag} onChange={(e) => set("tag", e.target.value)}>
                  <option value="">Todas</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      #{t}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {(
              [
                ["favoritesOnly", "Sólo favoritos"],
                ["pendingOnly", "Sólo pendientes"],
                ["expiringOnly", "Próximos a archivarse (48 h)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={filters[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {label}
              </label>
            ))}
            {active > 0 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setFilters(EMPTY_FILTERS)}>
                <RotateCcw size={14} /> Limpiar filtros
              </Button>
            )}
          </div>
        </div>
      )}

      {result.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 py-16 text-center">
          <Inbox size={28} className="mb-3 text-[var(--ink-3)]" />
          <p className="max-w-sm text-sm text-[var(--ink-2)]">
            {search.trim() || active
              ? "Ningún enlace coincide con la búsqueda o los filtros."
              : (EMPTY_MESSAGES[view] ??
                "No hay enlaces todavía. Compártelos por WhatsApp o añádelos con el botón «Añadir».")}
          </p>
          {active > 0 && (
            <Button size="sm" className="mt-3" onClick={() => setFilters(EMPTY_FILTERS)}>
              <X size={14} /> Quitar filtros
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {result.map((l, i) => (
            <LinkCard key={l.id} link={l} staleAfter={staleAfter} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
