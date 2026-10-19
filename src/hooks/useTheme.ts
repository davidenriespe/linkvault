import { useEffect } from "react";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setStoredTheme(theme: Theme) {
  try {
    localStorage.setItem("lv-theme", theme);
  } catch {
    /* almacenamiento no disponible */
  }
  apply(theme);
}

/** Sincroniza el tema guardado en Supabase con el documento y el sistema. */
export function useTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (!theme) return;
    setStoredTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
}
