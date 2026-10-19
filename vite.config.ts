import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Información de despliegue visible en Ajustes (sin secretos).
const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_REF ?? "";
const repo =
  process.env.VITE_GITHUB_REPO ??
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit.slice(0, 7)),
    __BUILD_REPO__: JSON.stringify(repo),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom"], supabase: ["@supabase/supabase-js"] },
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
