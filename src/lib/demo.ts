// Datos de demostración. Se guardan con is_demo = true y source = "demo",
// se muestran con la insignia «Demo» y se eliminan con un botón en Ajustes.

import type { Category } from "./types.ts";

interface DemoLink {
  url: string;
  title: string;
  description: string;
  slug: string;
  daysAgo: number;
  status?: string;
  favorite?: boolean;
  priority?: string;
  tags?: string[];
  notes?: string;
}

const DEMO: DemoLink[] = [
  {
    url: "https://demo.linkvault.invalid/empleo/analista-sig",
    title: "[DEMO] Analista SIG — oferta de ejemplo",
    description: "Registro ficticio para probar la vista de Empleo, la fecha límite y el estado de postulación.",
    slug: "empleo",
    daysAgo: 1,
    priority: "alta",
    tags: ["sig", "demo"],
    notes: "Revisar requisitos de postulación",
  },
  {
    url: "https://demo.linkvault.invalid/curso/teledeteccion",
    title: "[DEMO] Curso de teledetección con Sentinel-2",
    description: "Recurso educativo de ejemplo para la vista de Aprendizaje.",
    slug: "formacion",
    daysAgo: 2,
    priority: "alta",
    tags: ["demo"],
    notes: "Aprender este tutorial",
  },
  {
    url: "https://demo.linkvault.invalid/ia/agentes",
    title: "[DEMO] Guía de agentes de IA",
    description: "Artículo ficticio de inteligencia artificial.",
    slug: "ia",
    daysAgo: 0,
    favorite: true,
    tags: ["demo"],
  },
  {
    url: "https://demo.linkvault.invalid/qgis/plugin",
    title: "[DEMO] Plugin de QGIS para análisis de cuencas",
    description: "Herramienta geoespacial de ejemplo.",
    slug: "geografia-sig",
    daysAgo: 5,
    status: "seguimiento",
    tags: ["qgis", "demo"],
    notes: "Probar esta herramienta",
  },
  {
    url: "https://demo.linkvault.invalid/ambiente/remediacion",
    title: "[DEMO] Técnicas de remediación de suelos",
    description: "Lectura de ejemplo sobre medio ambiente.",
    slug: "medio-ambiente",
    daysAgo: 6,
    tags: ["demo"],
    notes: "Leer el artículo el fin de semana",
  },
  {
    url: "https://demo.linkvault.invalid/paper/manglares",
    title: "[DEMO] Paper sobre carbono azul en manglares",
    description: "Artículo científico ficticio.",
    slug: "investigacion",
    daysAgo: 3,
    status: "visto",
  },
  {
    url: "https://demo.linkvault.invalid/dev/react",
    title: "[DEMO] Novedades de React y Vite",
    description: "Enlace de programación de ejemplo.",
    slug: "programacion",
    daysAgo: 4,
    status: "pendiente",
  },
  {
    url: "https://demo.linkvault.invalid/juegos/estreno",
    title: "[DEMO] Estreno de videojuego",
    description: "Entretenimiento de ejemplo.",
    slug: "videojuegos",
    daysAgo: 8,
    status: "archivado",
  },
];

export function buildDemoRows(userId: string, categories: Category[], now = Date.now()) {
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  return DEMO.map((d) => {
    const received = new Date(now - d.daysAgo * 86_400_000 - 3_600_000).toISOString();
    return {
      user_id: userId,
      original_url: d.url,
      normalized_url: d.url,
      domain: "demo.linkvault.invalid",
      title: d.title,
      description: d.description,
      category_id: bySlug.get(d.slug) ?? null,
      category_source: "manual",
      status: d.status ?? "nuevo",
      favorite: d.favorite ?? false,
      priority: d.priority ?? "media",
      tags: d.tags ?? ["demo"],
      notes: d.notes ?? null,
      source: "demo",
      is_demo: true,
      received_at: received,
      last_shared_at: received,
      metadata_status: "omitido",
      metadata_error: "Registro de demostración",
    };
  });
}

/** Fecha límite de ejemplo para la oferta demo (dentro de 4 días). */
export function demoDeadline(now = Date.now()): string {
  return new Date(now + 4 * 86_400_000).toISOString().slice(0, 10);
}
