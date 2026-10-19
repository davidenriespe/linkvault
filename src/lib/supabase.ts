import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  string | undefined;

/** true si el frontend tiene la URL y la clave pública de Supabase. */
export const supabaseConfigured = Boolean(url && key);

// La clave publicable es pública por diseño: la seguridad la aplica
// Row Level Security en la base de datos. La clave service_role NUNCA
// se usa en el navegador.
export const supabase = createClient(url ?? "https://invalid.supabase.co", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const SUPABASE_URL = url ?? "";

/** Llama a la Edge Function links-api con la sesión del usuario. */
export async function callLinksApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("links-api", { body });
  if (error) {
    // Intenta mostrar el mensaje que devolvió la función.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error(error.message);
  }
  return data as T;
}
