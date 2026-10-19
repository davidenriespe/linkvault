// Gráficos ligeros en SVG/HTML (sin librerías externas).

import { useState } from "react";
import type { CategoryCount } from "../lib/logic.ts";

export function CategoryBars({ data, onSelect }: { data: CategoryCount[]; onSelect?: (id: string | null) => void }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!data.length)
    return <p className="py-6 text-center text-sm text-[var(--ink-3)]">Aún no hay enlaces clasificados.</p>;
  return (
    <ul className="space-y-2" aria-label="Distribución por categorías">
      {data.map((d) => (
        <li key={d.id ?? "none"}>
          <button
            className="group block w-full text-left"
            onClick={() => onSelect?.(d.id)}
            title={`Ver ${d.name}`}
            disabled={!onSelect}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate group-hover:text-[var(--accent)]">{d.name}</span>
              <span className="font-mono text-[12px] text-[var(--ink-3)]">
                {d.count} · {Math.round((d.count / total) * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(d.count / max) * 100}%`, background: d.color }}
              />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Timeline({ data }: { data: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  const W = 600;
  const H = 120;
  const gap = 3;
  const bw = (W - gap * (data.length - 1)) / data.length;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-EC", { day: "numeric", month: "short" });
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[12.5px] text-[var(--ink-3)]">
        <span>
          {h
            ? `${fmt(h.day)}: ${h.count} enlace${h.count === 1 ? "" : "s"}`
            : `${total} en los últimos ${data.length} días`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Enlaces recibidos por día, últimos ${data.length} días`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        {data.map((d, i) => {
          const bh = d.count ? Math.max(3, (d.count / max) * (H - 8)) : 0;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect
                x={i * (bw + gap)}
                y={H - bh}
                width={bw}
                height={bh}
                rx={Math.min(3, bw / 2)}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? 1 : 0.4}
              >
                <title>{`${fmt(d.day)}: ${d.count}`}</title>
              </rect>
            </g>
          );
        })}
        <text x="0" y={H + 14} fontSize="11" fill="var(--ink-3)">
          {fmt(data[0].day)}
        </text>
        <text x={W} y={H + 14} fontSize="11" fill="var(--ink-3)" textAnchor="end">
          Hoy
        </text>
      </svg>
    </div>
  );
}
