// Estado de datos del usuario: enlaces, categorías, datos de empleo y ajustes.
// Carga desde Supabase, se suscribe a Realtime y expone mutaciones que
// persisten en la base de datos (la interfaz se actualiza de forma optimista
// y se revierte si la operación falla).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase.ts";
import type { Category, JobDetails, Link, LinkView, Settings } from "../lib/types.ts";

const PAGE = 1000;

async function fetchAll<T>(table: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(order, { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export interface Vault {
  loading: boolean;
  error: string | null;
  links: LinkView[];
  categories: Category[];
  settings: Settings | null;
  realtime: "conectando" | "conectado" | "desconectado";
  reload: () => Promise<void>;
  updateLink: (id: string, patch: Partial<Link>) => Promise<void>;
  deleteLink: (id: string) => Promise<void>;
  upsertJob: (linkId: string, patch: Partial<JobDetails>) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

export function useVault(userId: string): Vault {
  const [links, setLinks] = useState<Link[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobDetails>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<Vault["realtime"]>("conectando");
  const linksRef = useRef(links);
  linksRef.current = links;

  const reload = useCallback(async () => {
    try {
      const [l, j, c, s] = await Promise.all([
        fetchAll<Link>("links", "last_shared_at"),
        fetchAll<JobDetails>("job_details", "created_at"),
        supabase.from("categories").select("*").order("sort_order"),
        supabase.from("settings").select("*").maybeSingle(),
      ]);
      if (c.error) throw c.error;
      if (s.error) throw s.error;
      setLinks(l);
      setJobs(new Map(j.map((x) => [x.link_id, x])));
      setCategories((c.data ?? []) as Category[]);
      setSettings((s.data as Settings) ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Tiempo real: altas y cambios desde WhatsApp u otras pestañas.
  useEffect(() => {
    const channel = supabase
      .channel(`vault-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "links", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as Partial<Link>).id;
            setLinks((prev) => prev.filter((x) => x.id !== id));
            return;
          }
          const row = payload.new as Link;
          setLinks((prev) => {
            const i = prev.findIndex((x) => x.id === row.id);
            if (i === -1) return [row, ...prev];
            const next = [...prev];
            next[i] = row;
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_details", filter: `user_id=eq.${userId}` },
        (payload) => {
          setJobs((prev) => {
            const next = new Map(prev);
            if (payload.eventType === "DELETE") next.delete((payload.old as Partial<JobDetails>).link_id!);
            else next.set((payload.new as JobDetails).link_id, payload.new as JobDetails);
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtime("conectado");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          setRealtime("desconectado");
      });

    // Respaldo: si Realtime cae, recarga al volver a la pestaña y cada 2 min.
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(() => void reload(), 120_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const updateLink = useCallback(async (id: string, patch: Partial<Link>) => {
    const before = linksRef.current.find((l) => l.id === id);
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { data, error: err } = await supabase.from("links").update(patch).eq("id", id).select("*").single();
    if (err) {
      if (before) setLinks((prev) => prev.map((l) => (l.id === id ? before : l)));
      throw new Error(err.message);
    }
    // La base de datos completa campos (fechas de revisión, archivado…).
    setLinks((prev) => prev.map((l) => (l.id === id ? (data as Link) : l)));
  }, []);

  const deleteLink = useCallback(async (id: string) => {
    const before = linksRef.current;
    setLinks((prev) => prev.filter((l) => l.id !== id));
    const { error: err } = await supabase.from("links").delete().eq("id", id);
    if (err) {
      setLinks(before);
      throw new Error(err.message);
    }
  }, []);

  const upsertJob = useCallback(
    async (linkId: string, patch: Partial<JobDetails>) => {
      const { data, error: err } = await supabase
        .from("job_details")
        .upsert({ link_id: linkId, user_id: userId, ...patch }, { onConflict: "link_id" })
        .select("*")
        .single();
      if (err) throw new Error(err.message);
      setJobs((prev) => new Map(prev).set(linkId, data as JobDetails));
    },
    [userId],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const { data, error: err } = await supabase
        .from("settings")
        .update(patch)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (err) throw new Error(err.message);
      setSettings(data as Settings);
      // La retención desplaza los vencimientos: se recargan los enlaces.
      if (patch.retention_days !== undefined) void reload();
    },
    [userId, reload],
  );

  const view = useMemo<LinkView[]>(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return links.map((l) => ({
      ...l,
      category: l.category_id ? (byId.get(l.category_id) ?? null) : null,
      job: jobs.get(l.id) ?? null,
    }));
  }, [links, jobs, categories]);

  return {
    loading,
    error,
    links: view,
    categories,
    settings,
    realtime,
    reload,
    updateLink,
    deleteLink,
    upsertJob,
    updateSettings,
  };
}
