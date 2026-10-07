import { dateRelative } from "./dates";

/**
 * Mission 22 (A2) — « Reprendre » : là où l'utilisateur s'était arrêté, sans rien retrouver de mémoire (règle 7 de
 * docs/CRM-V2.md). Deux mémoires, réunies ici (logique pure, sans dépendance serveur ni navigateur) :
 * - côté appareil, `localStorage["reprendre"]` = `{ chemin, titre, le }`, écrit à chaque ouverture d'un dossier, d'un
 *   contact, d'une fiche client ou d'un mail (`components/v2/MemoireReprendre.tsx`, monté par la coque v2) ;
 * - côté serveur, le paramètre `DERNIER_DOSSIER_OUVERT` (« <dossierId>|<ISO> », `lib/v2/reprendre-serveur.ts`), qui
 *   suit l'utilisateur d'un appareil à l'autre et donne au dossier son nom.
 * Le bandeau disparaît après 48 h, ou quand on le ferme.
 */
export const CLE_REPRENDRE = "reprendre";
export const CLE_REPRENDRE_FERME = "reprendre:ferme";
export const DUREE_REPRENDRE_MS = 48 * 3_600_000;

export type ContexteReprendre = {
  /** L'adresse à rouvrir (inchangée : /dossiers?dossier=…, /leads?lead=…, /clients/<id>, /mail?mail=…). */
  chemin: string;
  /** « le dossier ouvert » côté appareil ; « dossier Nom, objet » quand le serveur le connaît. */
  titre: string;
  /** L'instant ISO de l'ouverture. */
  le: string;
  /** Le dossier, pour la mémoire serveur ; null pour un contact, un client, un mail. */
  dossierId?: string | null;
};

/** Ce qu'une adresse du CRM dit à mémoriser, ou null (les listes et les écrans sans objet ne se reprennent pas). */
export function contexteDepuisAdresse(pathname: string, recherche: string | URLSearchParams): Omit<ContexteReprendre, "le"> | null {
  const parametres = typeof recherche === "string" ? new URLSearchParams(recherche) : recherche;
  const dossier = parametres.get("dossier");
  // Correctifs du 07/10 (d1) : la rubrique ouverte (`?rubrique=`) se retient et se restitue dans le lien.
  const rubrique = parametres.get("rubrique");
  if (pathname === "/dossiers" && dossier) return { chemin: `/dossiers?dossier=${encodeURIComponent(dossier)}${rubrique ? `&rubrique=${encodeURIComponent(rubrique)}` : ""}`, titre: "le dossier ouvert", dossierId: dossier };
  const lead = parametres.get("lead");
  if (pathname === "/leads" && lead) return { chemin: `/leads?lead=${encodeURIComponent(lead)}`, titre: "le contact ouvert", dossierId: null };
  const client = /^\/clients\/([^/]+)$/.exec(pathname)?.[1];
  if (client) return { chemin: `/clients/${encodeURIComponent(client)}`, titre: "la fiche client", dossierId: null };
  const mail = parametres.get("mail");
  if (pathname === "/mail" && mail) return { chemin: `/mail?mail=${encodeURIComponent(mail)}`, titre: "le mail ouvert", dossierId: null };
  return null;
}

/** Moins de 48 h : le contexte vaut encore d'être repris. */
export function estRecent(le: string, maintenant: Date): boolean {
  const instant = Date.parse(le);
  if (Number.isNaN(instant)) return false;
  const ecart = maintenant.getTime() - instant;
  return ecart >= 0 && ecart < DUREE_REPRENDRE_MS;
}

/** La valeur du paramètre serveur « <dossierId>|<ISO> », lue ; null si elle est illisible. */
export function lireValeurServeur(valeur: unknown): { dossierId: string; le: string } | null {
  if (typeof valeur !== "string") return null;
  const separateur = valeur.indexOf("|");
  if (separateur <= 0) return null;
  const dossierId = valeur.slice(0, separateur).trim();
  const le = valeur.slice(separateur + 1).trim();
  if (!dossierId || Number.isNaN(Date.parse(le))) return null;
  return { dossierId, le: new Date(le).toISOString() };
}

/** La valeur à écrire dans le paramètre serveur. */
export function valeurServeur(dossierId: string, le: Date): string {
  return `${dossierId}|${le.toISOString()}`;
}

/**
 * Le contexte à montrer : le plus récent des deux mémoires, chacune valable 48 h ; un bandeau fermé (`ferme` = l'instant
 * du contexte fermé) ne revient pas pour le même instant ni pour un plus ancien. Quand les deux parlent du même chemin,
 * le titre nommé du serveur l'emporte sur le titre générique de l'appareil.
 */
export function choisirReprendre(local: ContexteReprendre | null, serveur: ContexteReprendre | null, maintenant: Date, ferme: string | null = null): ContexteReprendre | null {
  const candidats = [local, serveur].filter((c): c is ContexteReprendre => c !== null && typeof c.chemin === "string" && typeof c.le === "string" && estRecent(c.le, maintenant));
  if (candidats.length === 0) return null;
  const choisi = candidats.reduce((a, b) => (Date.parse(b.le) > Date.parse(a.le) ? b : a));
  if (ferme && Date.parse(choisi.le) <= Date.parse(ferme)) return null;
  if (serveur && choisi !== serveur && choisi.chemin === serveur.chemin) return { ...choisi, titre: serveur.titre };
  return choisi;
}

/** « Reprendre : dossier Martin, cuisine — il y a 2 h ». */
export function phraseReprendre(contexte: Pick<ContexteReprendre, "titre" | "le">, maintenant: Date): string {
  return `Reprendre : ${contexte.titre} — ${dateRelative(contexte.le, maintenant)}`;
}
