import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  Clock,
  ExternalLink,
  Eye,
  MessageCircle,
  MoreHorizontal,
  PanelRightOpen,
  Repeat2,
  ShieldCheck,
  Star,
  StickyNote,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { LinkView } from "../lib/types.ts";
import {
  APPLICATION_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  daysUntil,
  isProtected,
  msUntilArchive,
  staleDays,
} from "../lib/logic.ts";
import { fmtRelative, fmtRemaining, safeHref, fmtDateTime } from "../lib/format.ts";
import { Badge, IconButton, cx } from "./ui.tsx";
import { CategoryIcon } from "./CategoryIcon.tsx";
import { useLinkActions } from "./actions.tsx";

const STATUS_COLOR: Record<string, string> = {
  nuevo: "#0ea5e9",
  pendiente: "#f59e0b",
  visto: "#22c55e",
  seguimiento: "#8b5cf6",
  archivado: "#64748b",
  descartado: "#ef4444",
};

export function StatusDot({ status }: { status: string }) {
  return <span className="inline-block size-2 rounded-full" style={{ background: STATUS_COLOR[status] }} aria-hidden />;
}

export function LinkCard({ link, staleAfter, index = 0 }: { link: LinkView; staleAfter: number; index?: number }) {
  const a = useLinkActions();
  const [menu, setMenu] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const href = safeHref(link.original_url);
  const img = imgOk ? safeHref(link.preview_image) : undefined;
  const remaining = msUntilArchive(link);
  const stale = staleDays(link, staleAfter);
  const isArchivedLike = link.status === "archivado" || link.status === "descartado";
  const deadlineDays = daysUntil(link.job?.deadline ?? null);
  const title = link.title || link.job?.job_title || link.original_url;
  const blurb = link.summary || link.description;

  return (
    <article
      className="lv-in group relative rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3.5 transition-shadow hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,0.25)] sm:p-4"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      <div className="flex gap-3.5">
        {/* Vista previa */}
        <div className="hidden shrink-0 sm:block">
          {img ? (
            <img
              src={img}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgOk(false)}
              className="h-[76px] w-[112px] rounded-xl border border-[var(--line)] object-cover"
            />
          ) : (
            <div
              className="grid h-[76px] w-[112px] place-items-center rounded-xl border border-[var(--line)] font-mono text-xl font-medium uppercase"
              style={{
                color: link.category?.color ?? "var(--ink-3)",
                background: `color-mix(in oklab, ${link.category?.color ?? "#94a3b8"} 10%, var(--panel))`,
              }}
              aria-hidden
            >
              {link.domain.replace(/^www\./, "").slice(0, 2)}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Fila superior: categoría, estado, avisos */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <label className="relative">
              <span className="sr-only">Categoría</span>
              <select
                value={link.category_id ?? ""}
                onChange={(e) => void a.setCategory(link, e.target.value || null)}
                className="absolute inset-0 cursor-pointer opacity-0"
                title="Cambiar categoría"
              >
                <option value="">Sin categoría</option>
                {a.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Badge color={link.category?.color}>
                <CategoryIcon name={link.category?.icon} size={12} />
                {link.category?.name ?? "Sin categoría"}
              </Badge>
            </label>
            <Badge>
              <StatusDot status={link.status} />
              {STATUS_LABEL[link.status]}
            </Badge>
            {link.priority !== "media" && (
              <Badge color={link.priority === "alta" ? "#e11d48" : undefined}>
                Prioridad {PRIORITY_LABEL[link.priority].toLowerCase()}
              </Badge>
            )}
            {link.job && link.job.application_status !== "pendiente_revisar" && (
              <Badge color="#2563eb">{APPLICATION_LABEL[link.job.application_status]}</Badge>
            )}
            {deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 7 && (
              <Badge color="#dc2626">
                <TriangleAlert size={12} /> Cierra {deadlineDays === 0 ? "hoy" : `en ${deadlineDays} d`}
              </Badge>
            )}
            {stale !== null && (
              <Badge color="#d97706">
                <Clock size={12} /> Sin revisar hace {stale} d
              </Badge>
            )}
            {link.is_demo && <Badge color="#a855f7">Demo</Badge>}
            {link.source === "simulacion" && <Badge color="#a855f7">Simulación</Badge>}
          </div>

          <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--accent)] focus-visible:text-[var(--accent)] focus-visible:outline-none"
            >
              {title}
            </a>
          </h3>
          {blurb ? (
            <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{blurb}</p>
          ) : link.metadata_status === "pendiente" ? (
            <p className="lv-pulse mt-1 text-[13px] text-[var(--ink-3)]">Obteniendo vista previa…</p>
          ) : (
            <p className="mt-1 text-[13px] text-[var(--ink-3)] italic">
              Resumen no disponible{link.metadata_error ? ` · ${link.metadata_error}` : ""}
            </p>
          )}
          {link.job && (link.job.company || link.job.location) && (
            <p className="mt-1 text-[13px] text-[var(--ink-2)]">
              {[link.job.company, link.job.location, link.job.work_mode].filter(Boolean).join(" · ")}
            </p>
          )}

          {link.notes && (
            <p className="mt-2 flex gap-1.5 rounded-lg bg-[var(--panel-2)] px-2.5 py-1.5 text-[13px] text-[var(--ink-2)]">
              <StickyNote size={14} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">{link.notes}</span>
            </p>
          )}

          {link.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {link.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-[var(--line)] px-1.5 py-px text-[11.5px] text-[var(--ink-2)]"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Metadatos */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ink-3)]">
            <span className="max-w-[16rem] truncate font-mono" title={link.original_url}>
              {link.domain}
            </span>
            <span title={fmtDateTime(link.received_at)} className="inline-flex items-center gap-1">
              {link.source === "whatsapp" && <MessageCircle size={12} />}
              Recibido {fmtRelative(link.received_at)}
            </span>
            {link.share_count > 1 && (
              <span
                className="inline-flex items-center gap-1"
                title={`Último envío: ${fmtDateTime(link.last_shared_at)}`}
              >
                <Repeat2 size={12} /> compartido {link.share_count}×
              </span>
            )}
            {remaining !== null ? (
              <span
                className={cx(
                  "inline-flex items-center gap-1",
                  remaining < 48 * 3_600_000 && "font-medium text-[var(--warn)]",
                )}
              >
                <Archive size={12} /> se archiva en {fmtRemaining(remaining)}
              </span>
            ) : isProtected(link) && !isArchivedLike ? (
              <span className="inline-flex items-center gap-1 text-[var(--ok)]">
                <ShieldCheck size={12} /> protegido
              </span>
            ) : null}
            {link.reviewed_at && <span>Revisado {fmtRelative(link.reviewed_at)}</span>}
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="mt-3 flex flex-wrap items-center gap-0.5 border-t border-[var(--line)] pt-2.5">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 text-[13px] font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-strong)]"
        >
          <ExternalLink size={14} /> Abrir
        </a>
        {isArchivedLike ? (
          <>
            <IconButton label="Restaurar" onClick={() => void a.restore(link)}>
              <ArchiveRestore size={16} />
            </IconButton>
            <IconButton label="Eliminar definitivamente" onClick={() => a.confirmDelete(link)}>
              <Trash2 size={16} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              label="Marcar como visto"
              active={link.status === "visto"}
              onClick={() => void a.setStatus(link, "visto")}
              disabled={link.status === "visto"}
            >
              <Check size={16} />
            </IconButton>
            <IconButton
              label="Marcar como pendiente"
              active={link.status === "pendiente"}
              onClick={() => void a.setStatus(link, "pendiente")}
              disabled={link.status === "pendiente"}
            >
              <Clock size={16} />
            </IconButton>
            <IconButton
              label={link.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
              active={link.favorite}
              onClick={() => void a.toggleFavorite(link)}
            >
              <Star size={16} fill={link.favorite ? "currentColor" : "none"} />
            </IconButton>
            <IconButton label="Añadir nota" onClick={() => a.openNote(link)}>
              <StickyNote size={16} />
            </IconButton>
          </>
        )}
        <IconButton label="Ver detalles y editar" onClick={() => a.openDetails(link)}>
          <PanelRightOpen size={16} />
        </IconButton>
        <div className="relative ml-auto">
          <IconButton label="Más acciones" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <MoreHorizontal size={16} />
          </IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div
                role="menu"
                className="lv-pop absolute right-0 bottom-9 z-20 w-56 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 text-sm shadow-xl"
              >
                {!isArchivedLike && link.status !== "seguimiento" && (
                  <MenuItem
                    icon={<Eye size={15} />}
                    onClick={() => void a.setStatus(link, "seguimiento")}
                    close={() => setMenu(false)}
                  >
                    Poner en seguimiento
                  </MenuItem>
                )}
                {!isArchivedLike && (
                  <MenuItem
                    icon={<Archive size={15} />}
                    onClick={() => void a.setStatus(link, "archivado")}
                    close={() => setMenu(false)}
                  >
                    Archivar
                  </MenuItem>
                )}
                {link.status !== "descartado" && (
                  <MenuItem
                    icon={<Ban size={15} />}
                    onClick={() => void a.setStatus(link, "descartado")}
                    close={() => setMenu(false)}
                  >
                    Descartar
                  </MenuItem>
                )}
                {!isArchivedLike && (
                  <MenuItem
                    icon={<Trash2 size={15} />}
                    onClick={() => a.confirmDelete(link)}
                    close={() => setMenu(false)}
                    danger
                  >
                    Eliminar definitivamente
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  close,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  close: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={() => {
        close();
        onClick();
      }}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--panel-2)]",
        danger && "text-[var(--danger)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
