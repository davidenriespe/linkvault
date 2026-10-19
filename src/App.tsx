import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Ban,
  BookOpen,
  Briefcase,
  Cpu,
  Eye,
  Home,
  Inbox,
  Layers,
  ListTodo,
  Menu,
  Moon,
  Search,
  Settings,
  Star,
  Sun,
  Vault as VaultIcon,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "./hooks/useSession.ts";
import { useVault } from "./hooks/useVault.ts";
import { useTheme, setStoredTheme } from "./hooks/useTheme.ts";
import { AuthView } from "./views/AuthView.tsx";
import { DashboardView } from "./views/DashboardView.tsx";
import { LinksView } from "./views/LinksView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { LinkDrawer } from "./components/LinkDrawer.tsx";
import { LinkActionsProvider } from "./components/actions.tsx";
import { Button, ConfirmDialog, Field, Modal, ToastProvider, cx, inputCls, useToast } from "./components/ui.tsx";
import { VIEW_LABEL, matchesView, type Filters, type ViewKey } from "./lib/logic.ts";
import type { LinkView } from "./lib/types.ts";
import { callLinksApi, supabase } from "./lib/supabase.ts";
import { buildDemoRows, demoDeadline } from "./lib/demo.ts";

const NAV: { key: ViewKey; icon: LucideIcon; group?: string }[] = [
  { key: "inicio", icon: Home },
  { key: "bandeja", icon: Inbox },
  { key: "por-revisar", icon: ListTodo },
  { key: "todo", icon: Layers },
  { key: "empleo", icon: Briefcase, group: "Temas" },
  { key: "aprendizaje", icon: BookOpen },
  { key: "tecnologia-ia", icon: Cpu },
  { key: "favoritos", icon: Star, group: "Organización" },
  { key: "seguimiento", icon: Eye },
  { key: "archivados", icon: Archive },
  { key: "descartados", icon: Ban },
];

function readHash(): ViewKey {
  const h = location.hash.replace(/^#\/?/, "") as ViewKey;
  return h in VIEW_LABEL ? h : "inicio";
}

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const { session, ready } = useSession();
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-[var(--ink-3)]">Cargando…</div>;
  if (!session) return <AuthView />;
  return <Shell key={session.user.id} userId={session.user.id} email={session.user.email ?? ""} />;
}

function Shell({ userId, email }: { userId: string; email: string }) {
  const vault = useVault(userId);
  const toast = useToast();
  const [view, setView] = useState<ViewKey>(readHash);
  const [search, setSearch] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<LinkView | null>(null);
  const [noteText, setNoteText] = useState("");
  const [deleteFor, setDeleteFor] = useState<LinkView | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<{ n: number; filters: Partial<Filters> }>({ n: 0, filters: {} });
  const [recovery, setRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const knownIds = useRef<Set<string> | null>(null);

  useTheme(vault.settings?.theme);

  // Navegación por hash (#/empleo) para que el botón Atrás funcione.
  useEffect(() => {
    const on = () => setView(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((v: ViewKey) => {
    location.hash = `/${v}`;
    setView(v);
    setNavOpen(false);
    setPreset({ n: Date.now(), filters: {} });
    window.scrollTo({ top: 0 });
  }, []);

  // Atajo: «/» enfoca la búsqueda.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  // Recuperación de contraseña.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => event === "PASSWORD_RECOVERY" && setRecovery(true));
    return () => data.subscription.unsubscribe();
  }, []);

  // Aviso cuando llega un enlace nuevo en tiempo real.
  useEffect(() => {
    if (vault.loading) return;
    const ids = new Set(vault.links.map((l) => l.id));
    if (knownIds.current) {
      const fresh = vault.links.filter((l) => !knownIds.current!.has(l.id) && l.source !== "demo");
      if (fresh.length === 1) toast("info", `Nuevo enlace recibido: ${fresh[0].title ?? fresh[0].domain}`);
      else if (fresh.length > 1) toast("info", `${fresh.length} enlaces nuevos recibidos`);
    }
    knownIds.current = ids;
  }, [vault.links, vault.loading, toast]);

  const openDetails = useCallback((l: LinkView) => setDetailId(l.id), []);
  const openNote = useCallback((l: LinkView) => {
    setNoteFor(l);
    setNoteText(l.notes ?? "");
  }, []);
  const confirmDelete = useCallback((l: LinkView) => setDeleteFor(l), []);
  const detail = useMemo(() => vault.links.find((l) => l.id === detailId) ?? null, [vault.links, detailId]);

  const counts = useMemo(() => {
    const c: Partial<Record<ViewKey, number>> = {};
    for (const n of NAV) if (n.key !== "inicio") c[n.key] = vault.links.filter((l) => matchesView(l, n.key)).length;
    return c;
  }, [vault.links]);

  const addLink = async () => {
    setAdding(true);
    try {
      const r = await callLinksApi<{ ok: boolean; isNew: boolean; title?: string; error?: string }>({
        action: "add",
        url: addUrl.trim(),
      });
      toast(
        "success",
        r.isNew ? `Guardado: ${r.title ?? addUrl}` : "Ya estaba guardado; se actualizó la fecha de envío",
      );
      setAddUrl("");
      setAddOpen(false);
      void vault.reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setAdding(false);
    }
  };

  const loadDemo = async () => {
    const rows = buildDemoRows(userId, vault.categories);
    const { data, error } = await supabase
      .from("links")
      .upsert(rows, { onConflict: "user_id,normalized_url", ignoreDuplicates: true })
      .select("id, category_id");
    if (error) {
      toast("error", `No se cargaron los datos: ${error.message}`);
      return;
    }
    const empleo = vault.categories.find((c) => c.slug === "empleo");
    const jobLink = data?.find((r) => r.category_id === empleo?.id);
    if (jobLink) {
      await supabase.from("job_details").upsert(
        {
          link_id: jobLink.id,
          user_id: userId,
          company: "Empresa Demo S.A.",
          job_title: "Analista SIG",
          location: "Quito, Ecuador",
          work_mode: "hibrido",
          deadline: demoDeadline(),
          application_status: "interesante",
          observations: "Registro de demostración",
        },
        { onConflict: "link_id" },
      );
    }
    // Los demo «archivados» se marcan como tales para poblar el archivo.
    toast("success", `${data?.length ?? 0} enlaces de demostración cargados`);
    await vault.reload();
  };

  const dark = document.documentElement.dataset.theme === "dark";
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    setStoredTheme(next);
    void vault.updateSettings({ theme: next }).catch(() => {});
  };

  const onSearch = (q: string) => {
    setSearch(q);
    if (q.trim() && (view === "inicio" || view === "ajustes")) {
      location.hash = "/todo";
      setView("todo");
    }
  };

  return (
    <LinkActionsProvider
      vault={vault}
      onOpenDetails={openDetails}
      onOpenNote={openNote}
      onConfirmDelete={confirmDelete}
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-[var(--panel)] focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <div className="flex min-h-dvh">
        {/* Barra lateral */}
        {navOpen && (
          <div className="lv-fade fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setNavOpen(false)} />
        )}
        <aside
          className={cx(
            "lv-scroll fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
            navOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Navegación"
        >
          <div className="mb-5 flex items-center gap-2.5 px-2">
            <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
              <VaultIcon size={17} />
            </span>
            <span className="font-semibold tracking-tight">LinkVault</span>
            <button
              className="ml-auto rounded p-1 lg:hidden"
              aria-label="Cerrar menú"
              onClick={() => setNavOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 text-[14px]">
            {NAV.map((n) => (
              <div key={n.key}>
                {n.group && (
                  <p className="mt-4 mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-[var(--ink-3)] uppercase">
                    {n.group}
                  </p>
                )}
                <button
                  onClick={() => go(n.key)}
                  aria-current={view === n.key ? "page" : undefined}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    view === n.key
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--ink)]"
                      : "text-[var(--ink-2)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
                  )}
                >
                  <n.icon size={16} className={view === n.key ? "text-[var(--accent)]" : ""} />
                  <span className="flex-1">{VIEW_LABEL[n.key]}</span>
                  {counts[n.key] ? (
                    <span className="font-mono text-[11.5px] text-[var(--ink-3)]">{counts[n.key]}</span>
                  ) : null}
                </button>
              </div>
            ))}
          </nav>
          <button
            onClick={() => go("ajustes")}
            aria-current={view === "ajustes" ? "page" : undefined}
            className={cx(
              "mt-4 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px]",
              view === "ajustes"
                ? "bg-[var(--accent-soft)] font-medium"
                : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
            )}
          >
            <Settings size={16} /> Ajustes
          </button>
        </aside>

        {/* Contenido */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 py-2.5 backdrop-blur sm:px-6">
            <button className="rounded-lg p-2 lg:hidden" aria-label="Abrir menú" onClick={() => setNavOpen(true)}>
              <Menu size={18} />
            </button>
            <div className="relative max-w-xl flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
              />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Buscar por título, URL, dominio, etiqueta, nota, empresa…"
                aria-label="Buscar enlaces"
                className={`${inputCls} pl-9`}
              />
              <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-[var(--line)] px-1.5 font-mono text-[11px] text-[var(--ink-3)] sm:block">
                /
              </kbd>
            </div>
            <span
              className="hidden items-center gap-1 text-[12px] text-[var(--ink-3)] sm:inline-flex"
              title={
                vault.realtime === "conectado"
                  ? "Actualización en tiempo real activa"
                  : "Sin tiempo real: actualización periódica"
              }
            >
              {vault.realtime === "conectado" ? <Wifi size={14} className="text-[var(--ok)]" /> : <WifiOff size={14} />}
              {vault.realtime === "conectado" ? "En vivo" : "Periódico"}
            </span>
            <button
              className="rounded-lg p-2 text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
              aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              title={dark ? "Modo claro" : "Modo oscuro"}
              onClick={toggleTheme}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </header>

          <main id="contenido" className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
            {vault.loading ? (
              <div className="space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="lv-pulse h-28 rounded-2xl bg-[var(--panel-2)]" />
                ))}
              </div>
            ) : vault.error ? (
              <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--panel)] p-5 text-sm">
                <p className="font-semibold text-[var(--danger)]">No se pudieron cargar tus enlaces</p>
                <p className="mt-1 text-[var(--ink-2)]">{vault.error}</p>
                <Button className="mt-3" onClick={() => void vault.reload()}>
                  Reintentar
                </Button>
              </div>
            ) : view === "inicio" ? (
              <DashboardView
                links={vault.links}
                staleAfter={vault.settings?.stale_after_days ?? 3}
                retentionDays={vault.settings?.retention_days ?? 7}
                digestEnabled={vault.settings?.notification_preferences.digest_in_app !== false}
                go={go}
                onFilterCategory={(id) => {
                  location.hash = "/todo";
                  setView("todo");
                  setPreset({ n: Date.now(), filters: id ? { categoryId: id } : {} });
                }}
                onLoadDemo={() => void loadDemo()}
                onAdd={() => setAddOpen(true)}
              />
            ) : view === "ajustes" ? (
              <SettingsView vault={vault} email={email} userId={userId} links={vault.links} onLoadDemo={loadDemo} />
            ) : (
              <LinksView
                key={`${view}-${preset.n}`}
                view={view}
                links={vault.links}
                categories={vault.categories}
                search={search}
                staleAfter={vault.settings?.stale_after_days ?? 3}
                onAdd={() => setAddOpen(true)}
                initialFilters={preset.filters}
              />
            )}
          </main>
        </div>
      </div>

      <LinkDrawer link={detail} onClose={() => setDetailId(null)} upsertJob={vault.upsertJob} />

      <Modal open={Boolean(noteFor)} title="Nota personal" onClose={() => setNoteFor(null)}>
        <p className="mb-2 truncate text-[13px] text-[var(--ink-3)]">{noteFor?.title ?? noteFor?.original_url}</p>
        <textarea
          className={`${inputCls} h-28 py-2`}
          value={noteText}
          maxLength={5000}
          placeholder="Ej.: Leer el artículo el fin de semana"
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            "Revisar requisitos de postulación",
            "Aprender este tutorial",
            "Probar esta herramienta",
            "Leer el fin de semana",
            "Comparar con alternativas",
          ].map((s) => (
            <button
              key={s}
              className="rounded-md border border-[var(--line)] px-2 py-0.5 text-[12px] text-[var(--ink-2)] hover:border-[var(--accent)]"
              onClick={() => setNoteText((t) => (t ? `${t}\n${s}` : s))}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setNoteFor(null)}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const l = noteFor!;
              setNoteFor(null);
              try {
                await vault.updateLink(l.id, { notes: noteText.trim() || null });
                toast("success", "Nota guardada");
              } catch (e) {
                toast("error", `No se guardó la nota: ${e instanceof Error ? e.message : "error"}`);
              }
            }}
          >
            Guardar nota
          </Button>
        </div>
      </Modal>

      <Modal open={addOpen} title="Añadir enlace" onClose={() => setAddOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addLink();
          }}
        >
          <Field
            label="URL"
            hint="Pasa por el mismo proceso que WhatsApp: metadatos, clasificación y detección de duplicados."
          >
            <input
              type="url"
              required
              className={inputCls}
              placeholder="https://…"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
            />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={adding}>
              {adding ? "Analizando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteFor)}
        title="Eliminar definitivamente"
        danger
        confirmLabel="Eliminar"
        message={
          <>
            <p>
              Se borrará <b>{deleteFor?.title ?? deleteFor?.original_url}</b> con sus notas, datos de empleo e
              historial. Esta acción no se puede deshacer.
            </p>
            <p className="mt-2">Si sólo quieres quitarlo de la bandeja, usa «Archivar».</p>
          </>
        }
        onConfirm={() => {
          if (!deleteFor) return;
          const l = deleteFor;
          if (detailId === l.id) setDetailId(null);
          void vault
            .deleteLink(l.id)
            .then(() => toast("success", "Enlace eliminado definitivamente"))
            .catch((e: Error) => toast("error", e.message));
        }}
        onClose={() => setDeleteFor(null)}
      />

      <Modal open={recovery} title="Nueva contraseña" onClose={() => setRecovery(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) toast("error", error.message);
            else {
              toast("success", "Contraseña actualizada");
              setRecovery(false);
              setNewPassword("");
            }
          }}
        >
          <Field label="Contraseña nueva" hint="Mínimo 8 caracteres">
            <input
              type="password"
              minLength={8}
              required
              className={inputCls}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" type="submit">
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </LinkActionsProvider>
  );
}
