import { promises as fs } from "node:fs";
import path from "node:path";
import type { EspaceClient } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireFichier } from "@/lib/dossiers/stockage";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { estFamille, zonesPourSimulation, type IdFamille, type SelectionPrestations } from "@/lib/prestations/prestations";
import { codeRaisonSite, empreintePhoto, EN_COURS_PERDUE_MS, lireAnalyseJson, TACHE_ANALYSE_PHOTO, zonesNonVisiblesPourEmpreinte, type CodeRaisonSite, type StatutAnalyse } from "@/lib/simulateur/analyses";
import type { AnalysePhoto } from "@/lib/simulateur/moteur/types";
import { TYPES_SURFACE_ESPACE } from "@/lib/simulateur/types-surface";
import { estIdZone, PIECES, ZONES_SIMULATEUR, pieceDuCode, zonesElementaires, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { attenteEstimeeS, medianeEnSecondes } from "@/lib/simulations/travaux-lecture";
import { mettreEnFile } from "@/lib/taches/file";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * L'espace client et le simulateur (mission 15, partie 5) — ce que « Créer une
 * simulation » lit et demande au CRM, avec le même moteur que le site :
 *  - les pièces et leurs zones, depuis la source unique `simulateur/zones.ts`
 *    (MURS et le tablier de baignoire y sont : la liste des familles de
 *    prestations `IDS_FAMILLE`, qui pilote devis et tarifs, n'est pas touchée) ;
 *  - l'analyse d'une photo du dossier à la demande (dès qu'elle est choisie),
 *    cadrée comme la génération la cadrera : même empreinte, même cache ;
 *    comptée par dossier et par jour, comme le site compte par adresse ;
 *  - les zones choisies que cette analyse ne voit pas (refusées avant de
 *    dépenser, comme sur le site) ;
 *  - l'attente estimée d'une génération de l'espace.
 */

/** Les codes des pièces que le client peut simuler (CUISINE, SDB, MEUBLES, MURS, PRO). */
export const CODES_PIECES_ESPACE = PIECES.map((p) => p.code);

/**
 * Le contrôle automatique est resté sous le seuil après deux tentatives : la
 * simulation reste en brouillon pour Lucas (score et défauts dans le CRM) au
 * lieu d'être publiée ; c'est ce que le client lit en attendant.
 */
export const MESSAGE_RELECTURE = "Votre simulation demande une relecture : vous la recevrez dès qu'elle est prête.";

export type PieceClient = {
  /** Code de l'espace (CUISINE, SDB…), celui que `POST /simulations/creer` reçoit. */
  piece: string;
  /** Identifiant de la pièce du simulateur (cuisine, salle-de-bain…) : dessin de la carte, analyse. */
  id: IdPiece;
  libelle: string;
  aide: string;
  zones: { zone: string; libelle: string; description: string }[];
  /** Les zones des sous-parties cochées dans son Projet : proposées en premier. */
  cochees: string[];
  duProjet: boolean;
};

/**
 * Les pièces proposées au client : celles de son projet d'abord (ses familles),
 * puis les autres, murs compris ; dans chaque pièce, les zones cochées dans son
 * Projet en premier. Zones élémentaires seulement (« Façades (toutes) » est une
 * composée du site : ici, chaque zone porte sa propre teinte).
 */
export function piecesPourLeClient(familles: IdFamille[], selection: SelectionPrestations): PieceClient[] {
  const ordre = [...familles, ...CODES_PIECES_ESPACE.filter((code) => !(familles as string[]).includes(code))];
  return ordre.map((code) => {
    const piece = pieceDuCode(code);
    const type = TYPES_SURFACE_ESPACE[code];
    const cochees = new Set(estFamille(code) ? zonesPourSimulation(code, selection).filter((z) => z.cochee).map((z) => z.zone as string) : []);
    const zones = zonesElementaires(piece.id)
      .map((id) => ({ zone: id as string, libelle: ZONES_SIMULATEUR[id].libelle, description: ZONES_SIMULATEUR[id].description }))
      .sort((a, b) => Number(cochees.has(b.zone)) - Number(cochees.has(a.zone)));
    return { piece: code, id: piece.id, libelle: piece.libelle, aide: type?.aide ?? "", zones, cochees: zones.filter((z) => cochees.has(z.zone)).map((z) => z.zone), duProjet: (familles as string[]).includes(code) };
  });
}

/* ── Attente estimée ───────────────────────────────────────────────── */

/**
 * Médiane des durées des 20 dernières générations par l'API (espace et CRM :
 * même qualité), en secondes ; sans historique, celle du site.
 */
export async function attenteEstimeeEspaceS(): Promise<number> {
  const dernieres = await prisma.preparationSimulation.findMany({ where: { ...AVEC_ARCHIVES, mode: "API", statut: "TERMINEE" }, orderBy: { updatedAt: "desc" }, take: 20, select: { createdAt: true, updatedAt: true } });
  const durees = dernieres.map((p) => p.updatedAt.getTime() - p.createdAt.getTime()).filter((d) => d > 0 && d < 30 * 60_000);
  return durees.length > 0 ? medianeEnSecondes(durees) : attenteEstimeeS();
}

/* ── Analyse d'une photo du dossier, à la demande ──────────────────── */

export const schemaAnalyseEspace = z.object({
  photoId: z.string().min(1, "Choisissez une photo.").max(80),
  piece: z.enum(CODES_PIECES_ESPACE as [string, ...string[]]).optional(),
});

export type ReponseAnalyseEspace = { empreinte: string; statut: StatutAnalyse; analyse: AnalysePhoto | null; raison: CodeRaisonSite | null; /** Vrai quand une tâche vient d'être mise en file (202). */ nouvelle: boolean };

/** Empreinte de la photo cadrée, par photo du dossier : le cadrage (sharp) n'est refait qu'une fois par processus. */
const empreintes = new Map<string, string>();
const EMPREINTES_MAX = 500;

async function photoCadree(dossierId: string, photoId: string): Promise<{ empreinte: string; image: Buffer | null }> {
  const cle = `${dossierId}/${photoId}`;
  const { photosDuClient } = await import("./service");
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const photo = (await photosDuClient(dossierId, dossier.photos)).find((p) => p.id === photoId);
  if (!photo) throw new ErreurMetier("Cette photo n'est plus dans votre espace : choisissez-en une autre.", 404);
  const connue = empreintes.get(cle);
  if (connue) return { empreinte: connue, image: null };
  const octets = await lireFichier(photo.chemin);
  if (!octets) throw new ErreurMetier("Photo introuvable sur le serveur.", 404);
  const { cadrerPhoto } = await import("@/lib/simulateur/preparation");
  const { image } = await cadrerPhoto(octets);
  const empreinte = empreintePhoto(image);
  if (empreintes.size >= EMPREINTES_MAX) empreintes.delete(empreintes.keys().next().value!);
  empreintes.set(cle, empreinte);
  return { empreinte, image };
}

function reponse(ligne: { empreinte: string; statut: string; json: string | null; raison: string | null; archiveLe: Date | null; updatedAt: Date }, nouvelle = false): ReponseAnalyseEspace {
  if (ligne.archiveLe) return { empreinte: ligne.empreinte, statut: "ECHEC", analyse: null, raison: "purgee", nouvelle };
  const statut = (["EN_COURS", "PRETE", "SAUTEE", "ECHEC"] as const).find((s) => s === ligne.statut) ?? "ECHEC";
  if (statut === "EN_COURS" && Date.now() - ligne.updatedAt.getTime() > EN_COURS_PERDUE_MS) return { empreinte: ligne.empreinte, statut: "ECHEC", analyse: null, raison: "delai", nouvelle };
  return { empreinte: ligne.empreinte, statut, analyse: statut === "PRETE" ? lireAnalyseJson(ligne.json) : null, raison: statut === "PRETE" || statut === "EN_COURS" ? null : codeRaisonSite(ligne.raison), nouvelle };
}

/** Le quota du dossier, demandé (et compté) SEULEMENT quand une analyse doit être mise en file — comme `demanderAnalyseSite`. */
export type OptionsAnalyseEspace = { quota?: () => { ok: boolean; raison?: "ip" | "global" } };

/**
 * `POST /simulations/analyse` : la photo du dossier, cadrée comme pour la
 * génération, est analysée par le même moteur (tâche ANALYSE_PHOTO) ; une
 * analyse déjà connue pour cette photo et cette pièce est rendue tout de suite,
 * et la génération qui suivra la réutilisera par empreinte. Jamais bloquant :
 * au-delà du quota du dossier (429), le client lance sa simulation sans analyse.
 */
export async function demanderAnalyseEspace(espace: Pick<EspaceClient, "dossierId">, entree: z.output<typeof schemaAnalyseEspace>, options: OptionsAnalyseEspace = {}): Promise<ReponseAnalyseEspace> {
  const piece = pieceDuCode(entree.piece ?? "CUISINE").id;
  const { empreinte, image } = await photoCadree(espace.dossierId, entree.photoId);
  const connue = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte } });
  if (connue && !connue.archiveLe) {
    const prete = connue.statut === "PRETE" && connue.piece === piece && lireAnalyseJson(connue.json);
    const enCours = connue.statut === "EN_COURS" && Date.now() - connue.updatedAt.getTime() < EN_COURS_PERDUE_MS;
    if (prete || enCours) {
      // Le suivi par jeton exige que l'analyse soit rattachée au dossier.
      const ligne = connue.dossierId === espace.dossierId ? connue : await prisma.analysePhoto.update({ where: { empreinte }, data: { dossierId: espace.dossierId } });
      return reponse(ligne);
    }
  }
  // Une analyse va être faite (un appel vision, une photo sur le volume) : c'est ici, et seulement ici, que le quota compte.
  const quota = options.quota?.() ?? { ok: true };
  if (!quota.ok) {
    throw new ErreurMetier(
      quota.raison === "global" ? "Le service d'analyse des photos est très demandé aujourd'hui : vous pouvez lancer la simulation sans." : "Limite d'analyses atteinte pour aujourd'hui : vous pouvez lancer la simulation sans.",
      429,
      { raison: quota.raison === "global" ? "global-quota" : "ip-quota" }
    );
  }
  const octets = image ?? (await recadrer(espace.dossierId, entree.photoId));
  const relatif = path.join("dossiers", espace.dossierId, "analyses", `${empreinte}.jpg`);
  const absolu = path.join(resolveUploadsDir(), relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, octets);
  const ligne = await prisma.analysePhoto.upsert({
    where: { empreinte },
    create: { empreinte, piece, dossierId: espace.dossierId, statut: "EN_COURS", photoPath: relatif },
    update: { piece, dossierId: espace.dossierId, statut: "EN_COURS", raison: null, json: null, photoPath: relatif, archiveLe: null, archiveMotif: null },
  });
  await mettreEnFile({ type: TACHE_ANALYSE_PHOTO, cle: `analyse-photo:${empreinte}`, charge: { empreinte }, priorite: 8, tentativesMax: 1, mode: "RECONCILIATION" });
  return reponse(ligne, true);
}

/** L'empreinte était en cache mais la photo cadrée doit être réécrite : on la recadre (rare : après un redémarrage). */
async function recadrer(dossierId: string, photoId: string): Promise<Buffer> {
  empreintes.delete(`${dossierId}/${photoId}`);
  const { image } = await photoCadree(dossierId, photoId);
  if (!image) throw new ErreurMetier("Photo introuvable sur le serveur.", 404);
  return image;
}

/**
 * `POST /simulations/creer` : les zones choisies que l'analyse connue de la
 * photo (cadrée : même empreinte) ne voit pas — refusées AVANT de dépenser,
 * comme `POST /api/simulate` sur le site. Sans analyse connue : aucune (on ne
 * bloque jamais à l'aveugle).
 */
export async function zonesNonVisiblesPourPhotoDuDossier(dossierId: string, photoId: string, zones: string[]): Promise<IdZone[]> {
  const connues = zones.filter(estIdZone);
  if (connues.length === 0) return [];
  const { empreinte } = await photoCadree(dossierId, photoId);
  return zonesNonVisiblesPourEmpreinte(empreinte, connues);
}

/** `GET /simulations/analyse/<empreinte>` : l'état, pour une analyse demandée depuis CET espace seulement (sinon 404). */
export async function suivreAnalyseEspace(espace: Pick<EspaceClient, "dossierId">, empreinte: string): Promise<ReponseAnalyseEspace> {
  if (!/^[0-9a-f]{64}$/.test(empreinte)) throw new ErreurMetier("Analyse introuvable.", 404);
  const ligne = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte, dossierId: espace.dossierId } });
  if (!ligne) throw new ErreurMetier("Analyse introuvable.", 404);
  return reponse(ligne);
}
