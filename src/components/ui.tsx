// Componentes base reutilizables: botones, diálogos, avisos (toasts), insignias.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5 text-sm",
        variant === "primary" && "bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-strong)]",
        variant === "secondary" &&
          "border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:bg-[var(--panel-2)]",
        variant === "ghost" && "text-[var(--ink-2)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
        variant === "danger" && "bg-[var(--danger)] text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "inline-grid size-8 place-items-center rounded-lg text-[var(--ink-2)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40",
        active && "text-[var(--accent)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", className)}
      style={
        color
          ? { color, backgroundColor: `color-mix(in oklab, ${color} 13%, transparent)` }
          : { color: "var(--ink-2)", backgroundColor: "var(--panel-2)" }
      }
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Diálogo modal accesible (Esc cierra, foco atrapado de forma básica)
// ---------------------------------------------------------------------------
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
      <div className="lv-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "lv-pop relative max-h-[90dvh] w-full overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Cerrar" data-close onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-sm text-[var(--ink-2)]">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------
type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<(kind: ToastKind, message: string, action?: Toast["action"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="lv-pop pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3.5 py-3 text-sm shadow-lg"
          >
            {t.kind === "success" && <CheckCircle2 size={18} className="mt-px shrink-0 text-[var(--ok)]" />}
            {t.kind === "error" && <AlertTriangle size={18} className="mt-px shrink-0 text-[var(--danger)]" />}
            {t.kind === "info" && <Info size={18} className="mt-px shrink-0 text-[var(--accent)]" />}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 font-semibold text-[var(--accent)] hover:underline"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Campos de formulario
// ---------------------------------------------------------------------------
export const inputCls =
  "h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-[var(--ink-2)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--ink-3)]">{hint}</span>}
    </label>
  );
}
