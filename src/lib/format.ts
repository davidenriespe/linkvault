const dateTime = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", year: "numeric" });
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export const fmtDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");

export const fmtDate = (iso: string | null) =>
  iso ? dateOnly.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : "—";

export function fmtRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "ahora mismo";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return fmtDate(iso);
}

/** Tiempo restante legible, p. ej. «3 d 4 h». */
export function fmtRemaining(ms: number): string {
  if (ms <= 0) return "vencido";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1 h";
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** Sólo permite abrir/mostrar URLs http(s) (defensa en profundidad contra XSS). */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
