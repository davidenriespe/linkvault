import { useEffect, useState } from "react";
import { Briefcase, ExternalLink, History, RefreshCw, X } from "lucide-react";
import type {
  ApplicationStatus,
  JobDetails,
  LinkHistory,
  LinkPriority,
  LinkStatus,
  LinkView,
  WorkMode,
} from "../lib/types.ts";
import { APPLICATION_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/logic.ts";
import { fmtDateTime, safeHref } from "../lib/format.ts";
import { callLinksApi, supabase } from "../lib/supabase.ts";
import { Button, Field, IconButton, inputCls, useToast } from "./ui.tsx";
import { useLinkActions } from "./actions.tsx";

const ACTION_LABEL: Record<string, string> = {
  recibido: "Recibido",
  cambio_estado: "Cambio de estado",
  recompartido: "Compartido de nuevo",
  favorito_on: "Marcado como favorito",
  favorito_off: "Quitado de favoritos",
  cambio_categoria: "Cambio de categoría",
};

export function LinkDrawer({
  link,
  onClose,
  upsertJob,
}: {
  link: LinkView | null;
  onClose: () => void;
  upsertJob: (linkId: string, patch: Partial<JobDetails>) => Promise<void>;
}) {
  const a = useLinkActions();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [job, setJob] = useState<Partial<JobDetails>>({});
  const [showJob, setShowJob] = useState(false);
  const [history, setHistory] = useState<LinkHistory[]>([]);
  const [refetching, setRefetching] = useState(false);

  const id = link?.id;
  useEffect(() => {
    if (!link) return;
    setTitle(link.title ?? "");
    setNotes(link.notes ?? "");
    setJob(link.job ?? {});
    setShowJob(Boolean(link.job) || link.category?.slug === "empleo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void supabase
      .from("link_history")
      .select("*")
      .eq("link_id", id)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => alive && setHistory((data ?? []) as LinkHistory[]));
    return () => {
      alive = false;
    };
  }, [id, link?.status, link?.favorite, link?.category_id]);

  useEffect(() => {
    if (!link) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [link, onClose]);

  if (!link) return null;

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/^#/, "").slice(0, 30);
    setTagInput("");
    if (!t || link.tags.includes(t) || link.tags.length >= 20) return;
    void a.patch(link, { tags: [...link.tags, t] }, "Etiqueta añadida");
  };

  const saveJob = async () => {
    try {
      const {
        company,
        job_title,
        location,
        work_mode,
        published_at,
        deadline,
        salary,
        opportunity_status,
        application_status,
        reviewed_at,
        observations,
      } = job;
      await upsertJob(link.id, {
        company: company || null,
        job_title: job_title || null,
        location: location || null,
        work_mode: (work_mode || null) as WorkMode | null,
        published_at: published_at || null,
        deadline: deadline || null,
        salary: salary || null,
        opportunity_status: opportunity_status ?? "desconocida",
        application_status: application_status ?? "pendiente_revisar",
        reviewed_at: reviewed_at || null,
        observations: observations || null,
      });
      toast("success", "Datos de la oferta guardados");
    } catch (e) {
      toast("error", `No se guardó: ${e instanceof Error ? e.message : "error"}`);
    }
  };

  const refetch = async () => {
    setRefetching(true);
    try {
      await callLinksApi({ action: "refetch", id: link.id });
      toast("success", "Metadatos actualizados");
    } catch (e) {
      toast("error", `No se pudo actualizar: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setRefetching(false);
    }
  };

  const setJ = <K extends keyof JobDetails>(k: K, v: JobDetails[K] | string) => setJob((j) => ({ ...j, [k]: v }));
  const extracted = new Set(link.job?.extracted_fields ?? []);
  const fromSource = (k: string) => (extracted.has(k) ? "Extraído de la página" : undefined);

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="lv-fade absolute inset-0 bg-black/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalles del enlace"
        className="lv-pop lv-scroll absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel)]/95 px-5 py-3 backdrop-blur">
          <h2 className="flex-1 truncate text-sm font-semibold">Detalles del enlace</h2>
          <a
            href={safeHref(link.original_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 text-[13px] font-medium text-[var(--accent-ink)]"
          >
            <ExternalLink size={14} /> Abrir
          </a>
          <IconButton label="Cerrar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="space-y-5 px-5 py-5">
          <p className="font-mono text-[12px] break-all text-[var(--ink-3)]">{link.original_url}</p>

          <Field label="Título">
            <div className="flex gap-2">
              <input className={inputCls} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
              <Button
                disabled={title === (link.title ?? "")}
                onClick={() => void a.patch(link, { title: title.trim() || null }, "Título actualizado")}
              >
                Guardar
              </Button>
            </div>
          </Field>

          {(link.summary || link.description) && (
            <div className="rounded-xl bg-[var(--panel-2)] p-3 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
              {link.summary && (
                <p>
                  <span className="font-semibold text-[var(--ink)]">Resumen: </span>
                  {link.summary}
                </p>
              )}
              {link.description && link.description !== link.summary && (
                <p className={link.summary ? "mt-2" : ""}>{link.description}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Estado">
              <select
                className={inputCls}
                value={link.status}
                onChange={(e) => void a.setStatus(link, e.target.value as LinkStatus)}
              >
                {(Object.keys(STATUS_LABEL) as LinkStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Categoría">
              <select
                className={inputCls}
                value={link.category_id ?? ""}
                onChange={(e) => void a.setCategory(link, e.target.value || null)}
              >
                <option value="">Sin categoría</option>
                {a.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioridad">
              <select
                className={inputCls}
                value={link.priority}
                onChange={(e) =>
                  void a.patch(link, { priority: e.target.value as LinkPriority }, "Prioridad actualizada")
                }
              >
                {(Object.keys(PRIORITY_LABEL) as LinkPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={link.favorite}
              onChange={() => void a.toggleFavorite(link)}
              className="size-4 accent-[var(--accent)]"
            />
            Favorito (protegido del archivado automático)
          </label>

          <Field label="Etiquetas">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1.5">
              {link.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--panel-2)] py-0.5 pr-1 pl-2 text-[12.5px]"
                >
                  #{t}
                  <button
                    aria-label={`Quitar etiqueta ${t}`}
                    className="rounded p-0.5 hover:bg-[var(--line)]"
                    onClick={() => void a.patch(link, { tags: link.tags.filter((x) => x !== t) }, "Etiqueta quitada")}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="Añadir etiqueta y Enter"
                className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-[var(--ink-3)]"
              />
            </div>
          </Field>

          <Field label="Nota personal">
            <textarea
              className={`${inputCls} h-24 py-2`}
              value={notes}
              maxLength={5000}
              placeholder="Ej.: Revisar requisitos de postulación"
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                disabled={notes === (link.notes ?? "")}
                onClick={() => void a.patch(link, { notes: notes.trim() || null }, "Nota guardada")}
              >
                Guardar nota
              </Button>
            </div>
          </Field>

          {/* Oferta laboral */}
          <section className="rounded-2xl border border-[var(--line)] p-4">
            <div className="flex items-center gap-2">
              <Briefcase size={16} className="text-[#2563eb]" />
              <h3 className="flex-1 text-sm font-semibold">Oferta laboral</h3>
              {!showJob && (
                <Button size="sm" onClick={() => setShowJob(true)}>
                  Añadir datos
                </Button>
              )}
            </div>
            {showJob && (
              <div className="mt-3 space-y-3">
                <p className="text-[12px] text-[var(--ink-3)]">
                  Sólo se rellenan automáticamente los datos que la página declara (schema.org JobPosting). Lo demás
                  queda vacío para que lo completes tú.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Empresa" hint={fromSource("company")}>
                    <input
                      className={inputCls}
                      value={job.company ?? ""}
                      onChange={(e) => setJ("company", e.target.value)}
                    />
                  </Field>
                  <Field label="Cargo" hint={fromSource("job_title")}>
                    <input
                      className={inputCls}
                      value={job.job_title ?? ""}
                      onChange={(e) => setJ("job_title", e.target.value)}
                    />
                  </Field>
                  <Field label="Ubicación" hint={fromSource("location")}>
                    <input
                      className={inputCls}
                      value={job.location ?? ""}
                      onChange={(e) => setJ("location", e.target.value)}
                    />
                  </Field>
                  <Field label="Modalidad" hint={fromSource("work_mode")}>
                    <select
                      className={inputCls}
                      value={job.work_mode ?? ""}
                      onChange={(e) => setJ("work_mode", e.target.value)}
                    >
                      <option value="">Sin especificar</option>
                      <option value="presencial">Presencial</option>
                      <option value="remoto">Remoto</option>
                      <option value="hibrido">Híbrido</option>
                    </select>
                  </Field>
                  <Field label="Fecha de publicación" hint={fromSource("published_at")}>
                    <input
                      type="date"
                      className={inputCls}
                      value={job.published_at ?? ""}
                      onChange={(e) => setJ("published_at", e.target.value)}
                    />
                  </Field>
                  <Field label="Fecha límite de postulación" hint={fromSource("deadline")}>
                    <input
                      type="date"
                      className={inputCls}
                      value={job.deadline ?? ""}
                      onChange={(e) => setJ("deadline", e.target.value)}
                    />
                  </Field>
                  <Field label="Salario" hint={fromSource("salary")}>
                    <input
                      className={inputCls}
                      value={job.salary ?? ""}
                      onChange={(e) => setJ("salary", e.target.value)}
                    />
                  </Field>
                  <Field label="Estado de la oportunidad">
                    <select
                      className={inputCls}
                      value={job.opportunity_status ?? "desconocida"}
                      onChange={(e) => setJ("opportunity_status", e.target.value as JobDetails["opportunity_status"])}
                    >
                      <option value="desconocida">Desconocido</option>
                      <option value="abierta">Abierta</option>
                      <option value="cerrada">Cerrada</option>
                    </select>
                  </Field>
                  <Field label="Estado de postulación">
                    <select
                      className={inputCls}
                      value={job.application_status ?? "pendiente_revisar"}
                      onChange={(e) => setJ("application_status", e.target.value as ApplicationStatus)}
                    >
                      {(Object.keys(APPLICATION_LABEL) as ApplicationStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {APPLICATION_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Fecha en que revisé la oferta">
                    <input
                      type="date"
                      className={inputCls}
                      value={job.reviewed_at ? job.reviewed_at.slice(0, 10) : ""}
                      onChange={(e) => setJ("reviewed_at", e.target.value ? `${e.target.value}T12:00:00` : "")}
                    />
                  </Field>
                </div>
                <Field label="Observaciones">
                  <textarea
                    className={`${inputCls} h-20 py-2`}
                    value={job.observations ?? ""}
                    onChange={(e) => setJ("observations", e.target.value)}
                  />
                </Field>
                <p className="text-[12px] text-[var(--ink-3)]">
                  «Postulación iniciada» y «Postulado» protegen el enlace del archivado automático.
                </p>
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void saveJob()}>
                    Guardar oferta
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Metadatos */}
          <section className="rounded-2xl border border-[var(--line)] p-4 text-[13px]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Información técnica</h3>
              <Button size="sm" variant="ghost" onClick={() => void refetch()} disabled={refetching}>
                <RefreshCw size={14} className={refetching ? "animate-spin" : ""} /> Volver a analizar
              </Button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[var(--ink-2)]">
              <dt>Metadatos</dt>
              <dd>
                {link.metadata_status}
                {link.metadata_error ? ` — ${link.metadata_error}` : ""}
              </dd>
              <dt>Categoría asignada por</dt>
              <dd>
                {
                  { reglas: "reglas automáticas", ia: "IA", manual: "ti (manual)", por_defecto: "valor por defecto" }[
                    link.category_source
                  ]
                }
              </dd>
              <dt>Origen</dt>
              <dd>{link.source}</dd>
              <dt>Recibido</dt>
              <dd>{fmtDateTime(link.received_at)}</dd>
              <dt>Último envío</dt>
              <dd>
                {fmtDateTime(link.last_shared_at)} ({link.share_count}×)
              </dd>
              <dt>Revisado</dt>
              <dd>{fmtDateTime(link.reviewed_at)}</dd>
              <dt>Vence</dt>
              <dd>{fmtDateTime(link.expires_at)}</dd>
              {link.archived_at && (
                <>
                  <dt>Archivado</dt>
                  <dd>{fmtDateTime(link.archived_at)}</dd>
                </>
              )}
            </dl>
          </section>

          {history.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <History size={15} /> Historial
              </h3>
              <ol className="space-y-1.5 border-l border-[var(--line)] pl-4 text-[13px]">
                {history.map((h) => (
                  <li key={h.id} className="text-[var(--ink-2)]">
                    <span className="text-[var(--ink)]">{ACTION_LABEL[h.action] ?? h.action}</span>
                    {h.to_status && h.action === "cambio_estado" && <> → {STATUS_LABEL[h.to_status]}</>}
                    <span className="ml-2 text-[var(--ink-3)]">{fmtDateTime(h.created_at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
