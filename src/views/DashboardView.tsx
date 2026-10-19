import {
  Archive,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  GraduationCap,
  Hourglass,
  Inbox,
  Layers,
  MessageCircle,
  Settings2,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";
import type { LinkView } from "../lib/types.ts";
import {
  buildDigest,
  categoryDistribution,
  computeStats,
  dailySeries,
  reviewToday,
  type Recommendation,
  type ViewKey,
} from "../lib/logic.ts";
import { safeHref } from "../lib/format.ts";
import { CategoryBars, Timeline } from "../components/Charts.tsx";
import { Button, IconButton } from "../components/ui.tsx";
import { useLinkActions } from "../components/actions.tsx";
import { CategoryIcon } from "../components/CategoryIcon.tsx";

function Stat({
  label,
  value,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3.5 text-left transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-center justify-between text-[var(--ink-3)]">
        <span className="text-[12.5px] font-medium">{label}</span>
        <span style={{ color: tone }}>{icon}</span>
      </div>
      <div className="mt-1.5 font-mono text-[26px] leading-none font-medium tracking-tight">{value}</div>
    </button>
  );
}

const REC_ICON: Record<Recommendation["kind"], React.ReactNode> = {
  deadline: <CalendarClock size={15} className="text-[#dc2626]" />,
  stale: <Clock size={15} className="text-[#d97706]" />,
  education: <GraduationCap size={15} className="text-[#7c3aed]" />,
  expiring: <Hourglass size={15} className="text-[var(--warn)]" />,
};

export function DashboardView({
  links,
  staleAfter,
  retentionDays,
  digestEnabled,
  go,
  onFilterCategory,
  onLoadDemo,
  onAdd,
}: {
  links: LinkView[];
  staleAfter: number;
  retentionDays: number;
  digestEnabled: boolean;
  go: (v: ViewKey) => void;
  onFilterCategory: (id: string | null) => void;
  onLoadDemo: () => void;
  onAdd: () => void;
}) {
  const a = useLinkActions();
  const stats = computeStats(links);
  const recs = reviewToday(links, staleAfter);
  const digest = buildDigest(links);
  const dist = categoryDistribution(links);

  if (links.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 sm:p-8">
          <div className="mb-4 inline-grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <MessageCircle size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Tu bóveda de enlaces está lista</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">
            Comparte cualquier enlace a tu número de LinkVault por WhatsApp y aparecerá aquí, clasificado y con vista
            previa. Para empezar:
          </p>
          <ol className="mt-5 space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] font-mono text-xs">
                1
              </span>
              <span>
                Registra tu número de WhatsApp en <b>Ajustes → Números autorizados</b> (sólo esos números pueden guardar
                enlaces).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] font-mono text-xs">
                2
              </span>
              <span>
                Conecta WhatsApp Business Platform siguiendo la guía de <b>Ajustes → Estado del sistema</b>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] font-mono text-xs">
                3
              </span>
              <span>
                Mientras tanto, prueba el flujo completo con el simulador de mensajes o añade un enlace a mano.
              </span>
            </li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => go("ajustes")}>
              <Settings2 size={15} /> Ir a ajustes
            </Button>
            <Button onClick={onAdd}>Añadir un enlace</Button>
            <Button variant="ghost" onClick={onLoadDemo}>
              <Sparkles size={15} /> Cargar datos de demostración
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inicio</h1>
        <p className="text-[13px] text-[var(--ink-3)]">
          Retención: {retentionDays} días · los favoritos, «En seguimiento» y las postulaciones activas no se archivan
          solos.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Indicadores">
        <Stat label="Total guardados" value={stats.total} icon={<Layers size={16} />} onClick={() => go("todo")} />
        <Stat
          label="Pendientes"
          value={stats.pending}
          icon={<Inbox size={16} />}
          tone="#0ea5e9"
          onClick={() => go("por-revisar")}
        />
        <Stat
          label="Revisados"
          value={stats.reviewed}
          icon={<CheckCheck size={16} />}
          tone="#22c55e"
          onClick={() => go("todo")}
        />
        <Stat
          label="Favoritos"
          value={stats.favorites}
          icon={<Star size={16} />}
          tone="#eab308"
          onClick={() => go("favoritos")}
        />
        <Stat
          label="Vencen pronto (48 h)"
          value={stats.expiringSoon}
          icon={<Hourglass size={16} />}
          tone="var(--warn)"
          onClick={() => go("por-revisar")}
        />
        <Stat label="Archivados" value={stats.archived} icon={<Archive size={16} />} onClick={() => go("archivados")} />
        <Stat
          label="Últimos 7 días"
          value={stats.last7Days}
          icon={<TrendingUp size={16} />}
          tone="var(--accent)"
          onClick={() => go("todo")}
        />
        <Stat
          label="Descartados"
          value={stats.discarded}
          icon={<Archive size={16} />}
          onClick={() => go("descartados")}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BellRing size={16} className="text-[var(--accent)]" /> Para revisar hoy
          </h2>
          {recs.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--ink-3)]">
              Nada urgente. Buen trabajo manteniendo la bandeja al día.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recs.map((r) => (
                <li key={r.link.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0">{REC_ICON[r.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <button
                      className="block w-full truncate text-left text-[14px] font-medium hover:text-[var(--accent)]"
                      onClick={() => a.openDetails(r.link)}
                    >
                      {r.link.title || r.link.original_url}
                    </button>
                    <p className="flex items-center gap-1.5 truncate text-[12.5px] text-[var(--ink-3)]">
                      <CategoryIcon name={r.link.category?.icon} size={12} color={r.link.category?.color} />
                      {r.reason} · <span className="font-mono">{r.link.domain}</span>
                    </p>
                  </div>
                  <a
                    href={safeHref(r.link.original_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Abrir enlace"
                    title="Abrir enlace"
                    className="inline-grid size-8 place-items-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
                  >
                    <ExternalLink size={15} />
                  </a>
                  <IconButton label="Marcar como visto" onClick={() => void a.setStatus(r.link, "visto")}>
                    <Check size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          {digestEnabled && (
            <section className="rounded-2xl border border-[var(--line)] bg-gradient-to-br from-[var(--accent-soft)] to-transparent p-4">
              <h2 className="mb-2 text-sm font-semibold">Resumen del día</h2>
              <ul className="space-y-1.5 text-[13.5px] text-[var(--ink-2)]">
                <DigestRow n={digest.newToday} label="enlaces nuevos en 24 h" onClick={() => go("bandeja")} />
                <DigestRow n={digest.jobsPending} label="ofertas laborales por revisar" onClick={() => go("empleo")} />
                <DigestRow
                  n={digest.educationSaved}
                  label="recursos educativos esta semana"
                  onClick={() => go("aprendizaje")}
                />
                <DigestRow n={digest.expiringSoon} label="se archivarán en 48 h" onClick={() => go("por-revisar")} />
                <DigestRow
                  n={digest.favoritesUnreviewed}
                  label="favoritos sin revisar"
                  onClick={() => go("favoritos")}
                />
              </ul>
            </section>
          )}
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Distribución por categorías</h2>
            <CategoryBars data={dist} onSelect={onFilterCategory} />
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="mb-1 text-sm font-semibold">Evolución: enlaces recibidos por día</h2>
        <Timeline data={dailySeries(links, 30)} />
      </section>
    </div>
  );
}

function DigestRow({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-baseline gap-2 text-left hover:text-[var(--ink)]">
        <span className="w-7 text-right font-mono text-[15px] font-medium text-[var(--ink)]">{n}</span>
        {label}
      </button>
    </li>
  );
}
