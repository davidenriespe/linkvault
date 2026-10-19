import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Copy,
  Database,
  Download,
  ExternalLink,
  FlaskConical,
  LogOut,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import type { FunctionStatus, LinkView, Settings, SystemStatus, WebhookEvent, WhatsAppSender } from "../lib/types.ts";
import { SUPABASE_URL, callLinksApi, supabase } from "../lib/supabase.ts";
import { downloadFile, fmtDateTime, fmtRelative } from "../lib/format.ts";
import { Badge, Button, ConfirmDialog, Field, inputCls, useToast } from "../components/ui.tsx";
import type { Vault } from "../hooks/useVault.ts";
import { setStoredTheme } from "../hooks/useTheme.ts";

type Check = { label: string; state: "ok" | "warn" | "off"; detail: string; fix?: string };

function StatusRow({ c }: { c: Check }) {
  return (
    <li className="flex gap-3 py-2.5">
      {c.state === "ok" ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--ok)]" />
      ) : c.state === "warn" ? (
        <CircleDashed size={18} className="mt-0.5 shrink-0 text-[var(--warn)]" />
      ) : (
        <XCircle size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{c.label}</p>
        <p className="text-[13px] text-[var(--ink-2)]">{c.detail}</p>
        {c.fix && <p className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">→ {c.fix}</p>}
      </div>
    </li>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsView({
  vault,
  email,
  userId,
  links,
  onLoadDemo,
}: {
  vault: Vault;
  email: string;
  userId: string;
  links: LinkView[];
  onLoadDemo: () => Promise<void>;
}) {
  const toast = useToast();
  const settings = vault.settings;
  const [sys, setSys] = useState<SystemStatus | null>(null);
  const [fn, setFn] = useState<FunctionStatus | null>(null);
  const [fnError, setFnError] = useState<string | null>(null);
  const [senders, setSenders] = useState<WhatsAppSender[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [phone, setPhone] = useState("");
  const [phoneLabel, setPhoneLabel] = useState("");
  const [simText, setSimText] = useState(
    "Mira esta oferta https://www.linkedin.com/jobs/view/1234567890 y este curso https://www.coursera.org/learn/machine-learning",
  );
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);
  const [retention, setRetention] = useState(settings?.retention_days ?? 7);
  const [stale, setStale] = useState(settings?.stale_after_days ?? 3);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [s, se, ev] = await Promise.all([
      supabase.rpc("get_system_status"),
      supabase.from("whatsapp_senders").select("*").order("created_at"),
      supabase.from("webhook_events").select("*").order("received_at", { ascending: false }).limit(15),
    ]);
    if (!s.error) setSys(s.data as SystemStatus);
    setSenders((se.data ?? []) as WhatsAppSender[]);
    setEvents((ev.data ?? []) as WebhookEvent[]);
    try {
      setFn(await callLinksApi<FunctionStatus>({ action: "status" }));
      setFnError(null);
    } catch (e) {
      setFn(null);
      setFnError(e instanceof Error ? e.message : "No disponible");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (settings) {
      setRetention(settings.retention_days);
      setStale(settings.stale_after_days);
    }
  }, [settings]);

  const save = async (patch: Partial<Settings>, msg: string) => {
    try {
      await vault.updateSettings(patch);
      toast("success", msg);
    } catch (e) {
      toast("error", `No se guardó: ${e instanceof Error ? e.message : "error"}`);
    }
  };

  const addSender = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      toast("error", "Escribe el número completo con código de país, p. ej. 593991234567");
      return;
    }
    const { error } = await supabase
      .from("whatsapp_senders")
      .insert({ user_id: userId, phone: digits, label: phoneLabel.trim() || null });
    if (error) {
      toast("error", error.code === "23505" ? "Ese número ya está registrado" : error.message);
      return;
    }
    setPhone("");
    setPhoneLabel("");
    toast("success", "Número autorizado");
    void load();
  };

  const removeSender = async (id: string) => {
    const { error } = await supabase.from("whatsapp_senders").delete().eq("id", id);
    if (error) toast("error", error.message);
    else {
      toast("success", "Número eliminado");
      void load();
    }
  };

  const simulate = async () => {
    setSimBusy(true);
    setSimResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "SIMULACION",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { display_phone_number: "SIMULACION", phone_number_id: "SIMULACION" },
                  messages: [
                    {
                      id: `wamid.SIM-${crypto.randomUUID()}`,
                      from: senders[0]?.phone ?? "593000000000",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: simText },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-webhook?mode=test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const r = body.results?.[0];
      const lines = (r?.links ?? []).map(
        (l: { ok: boolean; isNew: boolean; title?: string; url: string; category?: string; error?: string }) =>
          l.ok
            ? `${l.isNew ? "✅ Nuevo" : "♻️ Duplicado"}: ${l.title ?? l.url}${l.category ? ` · ${l.category}` : ""}`
            : `⚠️ ${l.url}: ${l.error}`,
      );
      setSimResult([`Estado: ${r?.status ?? "?"}${r?.detail ? ` — ${r.detail}` : ""}`, ...lines].join("\n"));
      toast("success", "Simulación procesada por el webhook");
      void load();
    } catch (e) {
      setSimResult(`Error: ${e instanceof Error ? e.message : "desconocido"}`);
      toast("error", "La simulación falló");
    } finally {
      setSimBusy(false);
    }
  };

  const backup = async () => {
    const [cats, jobs, hist, sett] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("job_details").select("*"),
      supabase.from("link_history").select("*").limit(10000),
      supabase.from("settings").select("*"),
    ]);
    const plain = links.map(({ category: _c, job: _j, ...rest }) => rest);
    downloadFile(
      `linkvault-respaldo-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          app: "LinkVault",
          version: 1,
          exported_at: new Date().toISOString(),
          settings: sett.data,
          categories: cats.data,
          links: plain,
          job_details: jobs.data,
          link_history: hist.data,
        },
        null,
        2,
      ),
      "application/json",
    );
    toast("success", "Copia de seguridad descargada");
  };

  const deleteDemo = async () => {
    const { error, count } = await supabase.from("links").delete({ count: "exact" }).eq("is_demo", true);
    if (error) toast("error", error.message);
    else {
      toast("success", `${count ?? 0} registros de demostración eliminados`);
      void vault.reload();
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast("info", "Copiado al portapapeles"));
  };

  // ------------------------------------------------------------------ estado
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const repo = __BUILD_REPO__ || (import.meta.env.VITE_GITHUB_REPO as string | undefined) || "";
  const checks: Check[] = [
    {
      label: "Base de datos conectada",
      state: vault.error ? "off" : "ok",
      detail: vault.error ? `Error: ${vault.error}` : `Supabase PostgreSQL · ${links.length} enlaces cargados`,
    },
    { label: "Autenticación configurada", state: "ok", detail: `Sesión iniciada como ${email}` },
    {
      label: "Actualización en tiempo real",
      state: vault.realtime === "conectado" ? "ok" : "warn",
      detail:
        vault.realtime === "conectado"
          ? "Supabase Realtime activo: los enlaces nuevos aparecen sin recargar"
          : "Realtime no conectado; se recarga al volver a la pestaña y cada 2 minutos",
    },
    {
      label: "Webhook configurado",
      state:
        fn?.whatsapp_verify_token && fn.whatsapp_app_secret
          ? sys?.whatsapp_webhook_verified_at
            ? "ok"
            : "warn"
          : "off",
      detail: fnError
        ? `No se pudo consultar la función: ${fnError}`
        : fn?.whatsapp_verify_token && fn.whatsapp_app_secret
          ? sys?.whatsapp_webhook_verified_at
            ? `Verificado por Meta ${fmtRelative(sys.whatsapp_webhook_verified_at)}`
            : "Secretos presentes, pero Meta aún no ha verificado la URL del webhook"
          : `Faltan secretos: ${[!fn?.whatsapp_verify_token && "WHATSAPP_VERIFY_TOKEN", !fn?.whatsapp_app_secret && "WHATSAPP_APP_SECRET"].filter(Boolean).join(", ")}`,
      fix: !(fn?.whatsapp_verify_token && fn?.whatsapp_app_secret && sys?.whatsapp_webhook_verified_at)
        ? "Guía: docs/WHATSAPP.md, pasos 4 y 5"
        : undefined,
    },
    {
      label: "WhatsApp Business API conectado",
      state: sys?.whatsapp_last_real_event_at
        ? "ok"
        : fn?.whatsapp_access_token && fn.whatsapp_phone_number_id
          ? "warn"
          : "off",
      detail: sys?.whatsapp_last_real_event_at
        ? `Último mensaje real recibido ${fmtRelative(sys.whatsapp_last_real_event_at)}`
        : fn?.whatsapp_access_token && fn.whatsapp_phone_number_id
          ? "Credenciales presentes; todavía no ha llegado ningún mensaje real"
          : "No conectado: no hay token de acceso ni Phone Number ID. El simulador sí funciona.",
      fix: !sys?.whatsapp_last_real_event_at
        ? "Registra tu número abajo y envía un enlace al número de LinkVault"
        : undefined,
    },
    {
      label: "Números autorizados",
      state: senders.length ? "ok" : "off",
      detail: senders.length
        ? `${senders.length} número(s) pueden guardar enlaces`
        : "Ningún número autorizado: los mensajes reales se ignoran",
    },
    {
      label: "Procesamiento de metadatos",
      state: sys?.metadata_ok_count ? "ok" : fnError ? "off" : "warn",
      detail: sys?.metadata_ok_count
        ? `${sys.metadata_ok_count} enlaces con vista previa · último ${fmtRelative(sys.metadata_last_ok_at)} · ${sys.metadata_failed_count} sin metadatos`
        : "Aún no se ha procesado ningún enlace con éxito",
      fix: fn
        ? fn.ai_provider
          ? `IA activa (${fn.ai_model})`
          : "Clasificación por reglas · IA opcional con ANTHROPIC_API_KEY"
        : undefined,
    },
    {
      label: "Tarea de archivado programada",
      state: sys?.archive_job_scheduled ? "ok" : "off",
      detail: sys?.archive_job_scheduled
        ? `pg_cron «${sys.archive_job_schedule}» (cada hora, minuto 15)${sys.archive_last_run ? ` · última ejecución ${fmtRelative(sys.archive_last_run.at)}, ${sys.archive_last_run.archived} archivados` : " · aún sin ejecutarse"}`
        : "La tarea no está programada",
    },
    {
      label: "Repositorio GitHub configurado",
      state: repo ? "ok" : "warn",
      detail: repo
        ? `${repo}${__BUILD_COMMIT__ ? ` · commit ${__BUILD_COMMIT__}` : ""}`
        : "Define VITE_GITHUB_REPO en el despliegue",
    },
    {
      label: "Aplicación desplegada",
      state: isLocal ? "warn" : "ok",
      detail: isLocal
        ? "Ejecutándose en local (npm run dev)"
        : `Publicada en ${location.host} · compilada ${fmtDateTime(__BUILD_TIME__)}`,
      fix: isLocal ? "Guía: README → Despliegue" : undefined,
    },
  ];

  const demoCount = links.filter((l) => l.is_demo).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
          <p className="text-[13px] text-[var(--ink-3)]">Configuración, integraciones y datos</p>
        </div>
        <Button size="sm" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Actualizar estado
        </Button>
      </div>

      <Section title="Estado del sistema" icon={<Database size={17} />}>
        <ul className="divide-y divide-[var(--line)]">
          {checks.map((c) => (
            <StatusRow key={c.label} c={c} />
          ))}
        </ul>
        {fn && (
          <div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-[13px]">
            <p className="mb-1 font-medium">URL del webhook para Meta (Callback URL)</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{fn.webhook_url}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(fn.webhook_url)}>
                <Copy size={14} /> Copiar
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Números autorizados de WhatsApp" icon={<Phone size={17} />}>
        <p className="mb-3 text-[13px] text-[var(--ink-2)]">
          Sólo los mensajes enviados desde estos números se guardan en tu bóveda. Escribe el número con código de país y
          sin «+» (Ecuador: 593…).
        </p>
        {senders.length > 0 && (
          <ul className="mb-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
            {senders.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <MessageCircle size={15} className="text-[var(--accent)]" />
                <span className="font-mono">+{s.phone}</span>
                {s.label && <Badge>{s.label}</Badge>}
                <span className="ml-auto text-[12px] text-[var(--ink-3)]">
                  {s.last_inbound_at ? `último mensaje ${fmtRelative(s.last_inbound_at)}` : "sin mensajes aún"}
                </span>
                <button
                  aria-label={`Eliminar ${s.phone}`}
                  className="rounded p-1 text-[var(--ink-3)] hover:text-[var(--danger)]"
                  onClick={() => void removeSender(s.id)}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            inputMode="tel"
            placeholder="593991234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label="Número de WhatsApp"
          />
          <input
            className={`${inputCls} sm:max-w-44`}
            placeholder="Etiqueta (opcional)"
            value={phoneLabel}
            maxLength={60}
            onChange={(e) => setPhoneLabel(e.target.value)}
            aria-label="Etiqueta"
          />
          <Button variant="primary" onClick={() => void addSender()}>
            Autorizar
          </Button>
        </div>
      </Section>

      <Section title="Simulador de mensajes (modo de prueba)" icon={<FlaskConical size={17} />}>
        <p className="mb-3 text-[13px] text-[var(--ink-2)]">
          Envía al webhook un evento con el mismo formato que Meta. Recorre el flujo real (idempotencia, extracción de
          URLs, metadatos, clasificación y guardado) pero se marca como <b>Simulación</b>: no demuestra que WhatsApp
          esté conectado.
        </p>
        <textarea className={`${inputCls} h-20 py-2`} value={simText} onChange={(e) => setSimText(e.target.value)} />
        <div className="mt-2 flex justify-end">
          <Button variant="primary" onClick={() => void simulate()} disabled={simBusy || !simText.trim()}>
            <Send size={14} /> {simBusy ? "Procesando…" : "Enviar mensaje simulado"}
          </Button>
        </div>
        {simResult && (
          <pre className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 font-mono text-[12px] whitespace-pre-wrap">
            {simResult}
          </pre>
        )}
        {events.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-[13px] font-semibold">Últimos eventos del webhook</h3>
            <ul className="space-y-1 text-[12.5px]">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-2 text-[var(--ink-2)]">
                  <Badge color={e.provider === "whatsapp" ? "#16a34a" : "#a855f7"}>
                    {e.provider === "whatsapp" ? "WhatsApp" : "Simulación"}
                  </Badge>
                  <span>{e.processing_status}</span>
                  <span>
                    · {e.urls_found} URL · {e.links_created} nuevos · {e.links_updated} actualizados
                  </span>
                  {e.error_message && <span className="text-[var(--warn)]">· {e.error_message}</span>}
                  <span className="ml-auto text-[var(--ink-3)]">{fmtRelative(e.received_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Retención y recordatorios" icon={<RefreshCw size={17} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Días antes del archivado automático"
            hint="Los enlaces nuevos, pendientes o vistos se archivan al vencer este plazo."
          >
            <input
              type="number"
              min={1}
              max={365}
              className={inputCls}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </Field>
          <Field
            label="Avisar de pendientes sin revisar tras (días)"
            hint="Muestra el recordatorio visual «Sin revisar hace X días»."
          >
            <input
              type="number"
              min={1}
              max={60}
              className={inputCls}
              value={stale}
              onChange={(e) => setStale(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            disabled={
              !settings ||
              (retention === settings.retention_days && stale === settings.stale_after_days) ||
              retention < 1 ||
              retention > 365 ||
              stale < 1 ||
              stale > 60
            }
            onClick={() =>
              void save({ retention_days: retention, stale_after_days: stale }, "Política de retención actualizada")
            }
          >
            Guardar
          </Button>
        </div>
      </Section>

      <Section title="Apariencia y notificaciones" icon={<CheckCircle2 size={17} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tema">
            <select
              className={inputCls}
              value={settings?.theme ?? "system"}
              onChange={(e) => {
                const theme = e.target.value as Settings["theme"];
                setStoredTheme(theme);
                void save({ theme }, "Tema actualizado");
              }}
            >
              <option value="system">Según el sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Oscuro</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={settings?.notification_preferences.whatsapp_ack !== false}
              onChange={(e) =>
                void save(
                  {
                    notification_preferences: { ...settings?.notification_preferences, whatsapp_ack: e.target.checked },
                  },
                  "Preferencia guardada",
                )
              }
            />
            Responder por WhatsApp confirmando cada enlace guardado (requiere token de acceso)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={settings?.notification_preferences.digest_in_app !== false}
              onChange={(e) =>
                void save(
                  {
                    notification_preferences: {
                      ...settings?.notification_preferences,
                      digest_in_app: e.target.checked,
                    },
                  },
                  "Preferencia guardada",
                )
              }
            />
            Mostrar el resumen del día en Inicio
          </label>
          <p className="text-[12.5px] text-[var(--ink-3)]">
            El envío del resumen por WhatsApp fuera de la ventana de 24 h exige una plantilla aprobada por Meta; por eso
            el resumen diario se muestra dentro del dashboard.
          </p>
        </div>
      </Section>

      <Section title="Datos" icon={<Download size={17} />}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void backup()}>
            <Download size={14} /> Copia de seguridad completa (JSON)
          </Button>
          <Button onClick={() => setConfirmDemo(true)}>
            <FlaskConical size={14} /> Cargar datos de demostración
          </Button>
          <Button variant="ghost" disabled={!demoCount} onClick={() => void deleteDemo()}>
            <Trash2 size={14} /> Eliminar datos de demostración ({demoCount})
          </Button>
        </div>
        <p className="mt-2 text-[12.5px] text-[var(--ink-3)]">
          Para exportar sólo una vista filtrada usa el botón «Exportar» de cada lista (CSV o JSON).
        </p>
      </Section>

      <Section title="Cuenta" icon={<LogOut size={17} />}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--ink-2)]">{email}</span>
          <Button size="sm" className="ml-auto" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={14} /> Cerrar sesión
          </Button>
        </div>
        <a
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-[var(--accent)] hover:underline"
          href="https://github.com/davidenriespe/linkvault#readme"
          target="_blank"
          rel="noopener noreferrer"
        >
          Guía de instalación y configuración <ExternalLink size={12} />
        </a>
      </Section>

      <ConfirmDialog
        open={confirmDemo}
        title="Cargar datos de demostración"
        message="Se añadirán 8 enlaces ficticios marcados como «Demo» para que explores la interfaz. Podrás eliminarlos todos con un clic."
        confirmLabel="Cargar"
        onConfirm={() => void onLoadDemo()}
        onClose={() => setConfirmDemo(false)}
      />
    </div>
  );
}
