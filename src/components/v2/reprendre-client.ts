import { CLE_REPRENDRE, type ContexteReprendre } from "@/lib/v2/reprendre";

/**
 * Mission 22 (A2) — la mémoire « Reprendre » côté appareil : `localStorage["reprendre"]` = `{ chemin, titre, le }`,
 * et, pour un dossier, la mémoire serveur par `POST /api/reprendre` (sans passer par `appelApi` : une note de contexte
 * ne doit pas faire relire les compteurs). Appelée par la coque à chaque adresse qui s'y prête et par Aujourd'hui quand
 * un panneau de dossier s'ouvre.
 */
export function memoriserReprendre(contexte: Omit<ContexteReprendre, "le">, maintenant: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const memo: ContexteReprendre = { chemin: contexte.chemin, titre: contexte.titre, le: maintenant.toISOString(), dossierId: contexte.dossierId ?? null };
  try {
    window.localStorage.setItem(CLE_REPRENDRE, JSON.stringify(memo));
  } catch {
    // stockage indisponible : la mémoire serveur suffit pour un dossier
  }
  if (memo.dossierId) {
    void fetch("/api/reprendre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dossierId: memo.dossierId }), keepalive: true }).catch(() => undefined);
  }
}

/** La mémoire de l'appareil, lue ; null si elle manque ou ne se lit pas. */
export function lireMemoireReprendre(): ContexteReprendre | null {
  if (typeof window === "undefined") return null;
  try {
    const brut = JSON.parse(window.localStorage.getItem(CLE_REPRENDRE) ?? "null") as ContexteReprendre | null;
    return brut && typeof brut.chemin === "string" && typeof brut.titre === "string" && typeof brut.le === "string" ? brut : null;
  } catch {
    return null;
  }
}
