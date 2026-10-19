// Acciones sobre enlaces compartidas por toda la interfaz.
// Cada acción persiste en Supabase y muestra un aviso de éxito o error.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Category, Link, LinkStatus, LinkView } from "../lib/types.ts";
import { STATUS_LABEL } from "../lib/logic.ts";
import { useToast } from "./ui.tsx";
import type { Vault } from "../hooks/useVault.ts";

export interface LinkActions {
  setStatus: (l: LinkView, status: LinkStatus) => Promise<void>;
  toggleFavorite: (l: LinkView) => Promise<void>;
  setCategory: (l: LinkView, categoryId: string | null) => Promise<void>;
  restore: (l: LinkView) => Promise<void>;
  patch: (l: LinkView, patch: Partial<Link>, okMessage?: string) => Promise<void>;
  remove: (l: LinkView) => Promise<void>;
  openDetails: (l: LinkView) => void;
  openNote: (l: LinkView) => void;
  confirmDelete: (l: LinkView) => void;
  categories: Category[];
}

const Ctx = createContext<LinkActions | null>(null);

export function useLinkActions(): LinkActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("LinkActionsProvider ausente");
  return v;
}

export function LinkActionsProvider({
  vault,
  onOpenDetails,
  onOpenNote,
  onConfirmDelete,
  children,
}: {
  vault: Vault;
  onOpenDetails: (l: LinkView) => void;
  onOpenNote: (l: LinkView) => void;
  onConfirmDelete: (l: LinkView) => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const { updateLink, deleteLink } = vault;

  const run = useCallback(
    async (fn: () => Promise<void>, ok?: string, undo?: () => Promise<void>) => {
      try {
        await fn();
        if (ok) toast("success", ok, undo ? { label: "Deshacer", run: () => void undo() } : undefined);
      } catch (e) {
        toast("error", `No se guardó el cambio: ${e instanceof Error ? e.message : "error desconocido"}`);
      }
    },
    [toast],
  );

  const actions = useMemo<LinkActions>(
    () => ({
      categories: vault.categories,
      setStatus: (l, status) =>
        run(
          () => updateLink(l.id, { status }),
          `Marcado como «${STATUS_LABEL[status]}»`,
          // Deshacer: vuelve al estado anterior.
          () => updateLink(l.id, { status: l.status }),
        ),
      toggleFavorite: (l) =>
        run(
          () => updateLink(l.id, { favorite: !l.favorite }),
          l.favorite ? "Quitado de favoritos" : "Añadido a favoritos (protegido del archivado)",
        ),
      setCategory: (l, categoryId) =>
        run(() => updateLink(l.id, { category_id: categoryId, category_source: "manual" }), "Categoría actualizada"),
      restore: (l) => {
        const target: LinkStatus =
          l.status_before_archive && !["archivado", "descartado"].includes(l.status_before_archive)
            ? l.status_before_archive
            : "pendiente";
        return run(() => updateLink(l.id, { status: target }), `Restaurado como «${STATUS_LABEL[target]}»`);
      },
      patch: (l, patch, okMessage) => run(() => updateLink(l.id, patch), okMessage ?? "Cambios guardados"),
      remove: (l) => run(() => deleteLink(l.id), "Enlace eliminado definitivamente"),
      openDetails: onOpenDetails,
      openNote: onOpenNote,
      confirmDelete: onConfirmDelete,
    }),
    [vault.categories, run, updateLink, deleteLink, onOpenDetails, onOpenNote, onConfirmDelete],
  );

  return <Ctx.Provider value={actions}>{children}</Ctx.Provider>;
}
