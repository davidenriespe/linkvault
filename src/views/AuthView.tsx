import { useState } from "react";
import { Vault } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase.ts";
import { Button, Field, inputCls } from "../components/ui.tsx";

// URL pública de la app (incluye la subruta, p. ej. /linkvault/ en GitHub Pages).
const APP_URL = `${window.location.origin}${import.meta.env.BASE_URL}`;

export function AuthView() {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: APP_URL },
        });
        if (error) throw error;
        if (!data.session)
          setMsg({ kind: "ok", text: "Cuenta creada. Revisa tu correo y confirma la dirección para entrar." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Si el correo existe, recibirás un enlace para restablecer la contraseña." });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Error";
      setMsg({
        kind: "err",
        text: /invalid login/i.test(text)
          ? "Correo o contraseña incorrectos."
          : /not confirmed/i.test(text)
            ? "Confirma tu correo antes de iniciar sesión."
            : text,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-ink)]">
            <Vault size={20} />
          </span>
          <div>
            <p className="text-lg leading-tight font-semibold">LinkVault</p>
            <p className="text-[13px] text-[var(--ink-3)]">Tus enlaces de WhatsApp, organizados</p>
          </div>
        </div>

        {!supabaseConfigured ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 text-sm">
            <p className="font-semibold">Falta configurar Supabase</p>
            <p className="mt-2 text-[var(--ink-2)]">
              Copia <code className="font-mono">.env.example</code> a <code className="font-mono">.env.local</code> y
              define <code className="font-mono">VITE_SUPABASE_URL</code> y{" "}
              <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
            <h1 className="text-base font-semibold">
              {mode === "login" ? "Iniciar sesión" : mode === "signup" ? "Crear cuenta" : "Restablecer contraseña"}
            </h1>
            <Field label="Correo electrónico">
              <input
                type="email"
                required
                autoComplete="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {mode !== "reset" && (
              <Field label="Contraseña" hint={mode === "signup" ? "Mínimo 8 caracteres" : undefined}>
                <input
                  type="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className={inputCls}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}
            {msg && (
              <p
                role={msg.kind === "err" ? "alert" : "status"}
                className={msg.kind === "err" ? "text-sm text-[var(--danger)]" : "text-sm text-[var(--ok)]"}
              >
                {msg.text}
              </p>
            )}
            <Button variant="primary" type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Crear cuenta"
                    : "Enviar enlace"}
            </Button>
            <div className="flex justify-between text-[13px]">
              <button
                type="button"
                className="text-[var(--accent)] hover:underline"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
              >
                {mode === "login" ? "Crear una cuenta" : "Ya tengo cuenta"}
              </button>
              {mode === "login" && (
                <button type="button" className="text-[var(--ink-3)] hover:underline" onClick={() => setMode("reset")}>
                  ¿Olvidaste la contraseña?
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
