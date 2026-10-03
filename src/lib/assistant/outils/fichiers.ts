import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourHeure, pluriel } from "@/lib/commun/format";
import { ADRESSE_DEPENSES } from "@/lib/depenses/constantes";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { schemaDepotDocument } from "@/lib/dossiers/depot-document";
import { etapeApresGeneration } from "@/lib/dossiers/devis-envoye";
import { estEtape } from "@/lib/dossiers/regles";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { idPhoto, lireFichier } from "@/lib/dossiers/stockage";
import { gesteDeLucas } from "@/lib/espace/vue-crm";
import { lirePhotosRetirees } from "@/lib/espace/validations";
import { lireFichierConserve } from "@/lib/fichiers/stockage";
import {
  enregistrerFichierRecu,
  ligneDePhotoExistante,
  lireCible,
  rangerFichierDepose,
  remettreFichierDepose,
  retirerFichierDepose,
  type ChampsDocument,
  type CibleFichier,
  type LigneDepot,
  type ResultatEnregistrement,
} from "@/lib/fichiers-depot/enregistrement";
import { creerLienDepot } from "@/lib/fichiers-depot/jetons";
import { lignesDuLien, lireSourceFichier, schemaSourceFichier } from "@/lib/fichiers-depot/source";
import { ENTITES_CIBLE, LIBELLES_ENTITE, LIBELLES_TYPE_FICHIER, MINUTES_VALIDITE_LIEN, TYPES_FICHIER, TYPES_FICHIER_LIEN, type EntiteCible, type TypeFichier } from "@/lib/fichiers-depot/types";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { adresseCrm, definirOutil, format, lien, type ContexteOutil, type DocumentOutil, type ImageOutil, type LienOutil, type ResultatOutil } from "../definition";
import { IMAGES_MAX_PAR_RESULTAT, imagePourResultat, ko } from "../images";
import { cibler } from "./cible";
import { outilVoirPhotos, outilVoirSimulations } from "./images";
import { outilSimulationsSite } from "./site";

/**
 * Mission 17 (partie C) — les fichiers, par quatre outils (docs/MCP-COUVERTURE.md § 4.8) :
 *
 * - `lien_depot` : un lien de dépôt à usage unique, valable 30 minutes, déjà rattaché à sa cible
 *   (ou dépôt libre → « À ranger ») ; Lucas l'ouvre sur son téléphone et y dépose plusieurs
 *   photos ou documents d'un coup.
 * - `ajouter_fichier` : un fichier sur une cible (dossier, lead, client, dépense, réalisation du
 *   site), par l'une des cinq voies (lien de dépôt, URL, base64, pièce de mail, fichier conservé).
 *   Remplace `deposer_document` (même fonction pour un devis ou une facture repris).
 * - `ranger_fichier` : classer un fichier « À ranger », le déplacer, le retirer (archivé) ou le remettre.
 * - `voir_fichiers` : voir photos, simulations, documents, « À ranger » et simulations du site ;
 *   remplace `voir_photos`, `voir_simulations` et `simulations_site` (mêmes paramètres, mêmes
 *   comportements : leurs définitions restent dans images.ts et site.ts, appelées d'ici).
 *
 * Aucune donnée ne sort du CRM (l'URL est téléchargée PAR le CRM, jamais l'inverse) ; rien ne se
 * supprime.
 */

/* ── La cible ──────────────────────────────────────────────────── */

export const schemaCibleFichier = z
  .object({
    entite: z.enum(ENTITES_CIBLE).optional().describe("DOSSIER, LEAD, CLIENT, DEPENSE ou PUBLICATION (réalisation du site). Absente avec un nom : le dossier du contact, sinon son lead, sinon sa fiche client."),
    id: z.string().trim().max(40).optional().describe("Identifiant de l'entité (rendu par « chercher », « lire_fiche », « lister »)."),
    nom: z.string().trim().max(120).optional().describe("À défaut d'identifiant (dossier, lead, client) : le nom tel que Lucas l'a dit."),
  })
  .refine((c) => Boolean(c.id || c.nom), { message: "Donne l'identifiant de la cible, ou le nom du contact." });
export type CibleOutil = z.output<typeof schemaCibleFichier>;

type CibleResolue = { cible: CibleFichier; ambigu?: undefined } | { cible?: undefined; ambigu: ResultatOutil };

/** Résout la cible d'un outil : un identifiant, ou un nom (candidats rendus en cas de doute, jamais de choix à la place de Lucas). */
export async function resoudreCibleFichier(c: CibleOutil): Promise<CibleResolue> {
  const entite = c.entite;
  if (entite === "DEPENSE" || entite === "PUBLICATION") {
    if (!c.id) throw new ErreurMetier(`Une ${LIBELLES_ENTITE[entite]} se désigne par son identifiant (« lister »).`, 400);
    return { cible: { entite, id: c.id } };
  }
  if (c.id && entite) return { cible: { entite, id: c.id } };
  const r = await cibler(c.id ? { dossierId: c.id } : { nom: c.nom }, entite);
  if (r.ambigu) return { ambigu: r.ambigu };
  const { dossierId, leadId, clientId, nom } = r.ids;
  const choix: EntiteCible | null = entite ?? (dossierId ? "DOSSIER" : leadId ? "LEAD" : clientId ? "CLIENT" : null);
  const id = choix === "DOSSIER" ? dossierId : choix === "LEAD" ? leadId : choix === "CLIENT" ? clientId : null;
  if (!choix || !id) throw new ErreurMetier(`${nom} n'a pas de ${entite ? LIBELLES_ENTITE[entite] : "dossier, de lead ni de fiche client"}.`, 409);
  return { cible: { entite: choix, id } };
}

const lienCible = (c: { entite: EntiteCible; id: string }): LienOutil =>
  c.entite === "DOSSIER" ? lien("Dossier", `/dossiers?dossier=${c.id}`) : c.entite === "LEAD" ? lien("Lead", `/leads?lead=${c.id}`) : c.entite === "CLIENT" ? lien("Client", `/clients?client=${c.id}`) : c.entite === "DEPENSE" ? lien("Dépenses", ADRESSE_DEPENSES) : lien("Site", "/site");

async function publicationPubliee(cible: CibleFichier | null | undefined): Promise<boolean> {
  if (cible?.entite !== "PUBLICATION") return false;
  return (await lireCible(cible).catch(() => null))?.publiee ?? false;
}

/* ── lien_depot ────────────────────────────────────────────────── */

export const outilLienDepot = definirOutil({
  nom: "lien_depot",
  titre: "Lien de dépôt de fichiers (téléphone)",
  description:
    "Rend un lien de dépôt à usage unique, valable 30 minutes, déjà rattaché à sa cible (dossier, lead, client, dépense, réalisation du site) : Lucas l'ouvre sur son téléphone, prend des photos ou choisit plusieurs photos ou documents, et tout s'enregistre au bon endroit (photos du dossier, proposées au simulateur ; photo d'un lead ; document ; justificatif d'une dépense ; photo avant ou après d'une réalisation). Sans cible : dépôt libre, les fichiers arrivent dans « À ranger » et se classent avec « ranger_fichier ». « type » fixe la nature de ce qui sera déposé (PHOTO_AVANT, PHOTO_APRES, PLAN, DEVIS, FACTURE, JUSTIFICATIF, AUTRE) ; sans type, une image devient une photo avant et un PDF un document. Le lien est consommé à la première soumission du formulaire (tous les fichiers choisis partent en une fois). Donne le lien à Lucas, pas au client. Ensuite : « voir_fichiers » pour voir ce qui est arrivé, « ajouter_fichier » (source.lien_depot) pour compléter un devis déposé (numéro, montant).",
  niveau: "REVERSIBLE",
  schema: z.object({
    cible: schemaCibleFichier.optional().describe("Où iront les fichiers ; absente : dépôt libre (« À ranger »)."),
    type: z.enum(TYPES_FICHIER_LIEN).optional(),
  }),
  // Une réalisation déjà publiée : la photo déposée changera le site public.
  sensible: async (e) => (e.cible?.entite === "PUBLICATION" && e.cible.id ? publicationPubliee({ entite: "PUBLICATION", id: e.cible.id }) : false),
  apercu: async (e) => `Je vais créer un lien de dépôt pour la réalisation ${e.cible?.id} : elle est déjà publiée, la photo déposée (${e.type ? LIBELLES_TYPE_FICHIER[e.type] : "photo après"}) sera visible tout de suite sur coverswap.fr.`,
  executer: async (e, contexte) => {
    let cible: CibleFichier | null = null;
    if (e.cible) {
      const r = await resoudreCibleFichier(e.cible);
      if (r.ambigu) return r.ambigu;
      cible = r.cible;
    }
    const cree = await creerLienDepot({ cible, type: e.type ?? null, creePar: contexte.utilisateur, maintenant: contexte.maintenant });
    const adresse = `${adresseCrm()}${cree.chemin}`;
    const pour = cree.cible ? `${e.type ? `${LIBELLES_TYPE_FICHIER[e.type]} — ` : ""}${LIBELLES_ENTITE[cree.cible.entite]} ${cree.cible.nom}` : `dépôt libre (${e.type ? LIBELLES_TYPE_FICHIER[e.type] : "photos ou documents"}), rangé ensuite dans « À ranger »`;
    return {
      texte: `Lien de dépôt prêt pour ${pour} : ${adresse}\nValable ${MINUTES_VALIDITE_LIEN} minutes (jusqu'à ${jourHeure(cree.expireLe)}), pour un seul envoi de ${cree.fichiersMax === 1 ? "1 fichier" : `${cree.fichiersMax} fichiers au plus`} (photos compressées sur le téléphone, PDF acceptés). Identifiant du dépôt : ${cree.id} (pour « voir_fichiers » ou « ajouter_fichier » source.lien_depot).`,
      donnees: { depot_id: cree.id, lien: adresse, expireLe: cree.expireLe.toISOString(), cible: cree.cible, type: cree.type, fichiers_max: cree.fichiersMax },
      liens: [{ libelle: "Lien de dépôt (à ouvrir sur le téléphone)", href: adresse }, ...(cree.cible ? [lienCible(cree.cible)] : [])],
    };
  },
});

/* ── ajouter_fichier ───────────────────────────────────────────── */

const schemaChampsDocument = schemaDepotDocument.omit({ type: true, source: true });

const schemaAjouterFichier = z.object({
  cible: schemaCibleFichier,
  type: z.enum(TYPES_FICHIER).describe("PHOTO_AVANT, PHOTO_APRES (photos du dossier ; réalisation du site), PLAN, DEVIS, FACTURE (dossier : numéro et montant pour un document repris), JUSTIFICATIF (dépense), AUTRE, SIMULATION (image rendue, déposée en brouillon sur le dossier), PDF_DOCUMENT (le PDF d'un document repris : document_id)."),
  source: schemaSourceFichier,
  ...schemaChampsDocument.shape,
  titre: z.string().trim().max(120).optional().describe("SIMULATION : son titre."),
  description: z.string().trim().max(1000).optional().describe("SIMULATION : sa description."),
  origine_simulation: z.enum(["CHATGPT", "MANUEL"]).optional().describe("SIMULATION : CHATGPT (rendu d'une préparation) ou MANUEL (défaut)."),
  preparation_id: z.string().max(40).optional().describe("SIMULATION : la préparation d'où vient l'image (« auto » par défaut : la dernière préparation ChatGPT du dossier, 72 h)."),
  document_id: z.string().max(40).optional().describe("PDF_DOCUMENT : le document repris dont c'est le PDF ([document:…] de voir_fichiers documents)."),
});
type EntreeAjouter = z.output<typeof schemaAjouterFichier>;

const estDocumentRepris = (e: EntreeAjouter) => ((e.type === "DEVIS" || e.type === "FACTURE") && Boolean(e.numero && e.montant)) || e.type === "PDF_DOCUMENT";
const optionsSimulation = (e: EntreeAjouter) => ({ simulation: { titre: e.titre ?? null, description: e.description ?? null, source: e.origine_simulation ?? "MANUEL", preparationId: e.preparation_id ?? "auto" }, documentRepris: e.document_id ?? null });
const champsDocument = (e: EntreeAjouter): ChampsDocument => ({ numero: e.numero, libelle: e.libelle, montant: e.montant, date_emission: e.date_emission, statut: e.statut, acompte_pct: e.acompte_pct, objet: e.objet, visible_espace: e.visible_espace, inscrire_au_registre: e.inscrire_au_registre });

function origineLisible(s: EntreeAjouter["source"]): string {
  if (s.lien_depot) return `reçu par le lien de dépôt ${s.lien_depot}`;
  if (s.url) return `téléchargé depuis ${s.url.slice(0, 120)}`;
  if (s.piece_mail) return `pièce ${s.piece_mail.piece} du mail ${s.piece_mail.message_id}`;
  if (s.fichier_id) return `fichier conservé ${s.fichier_id}`;
  return `contenu fourni${s.nom ? ` (${s.nom})` : ""}`;
}

function texteResultats(resultats: ResultatEnregistrement[]): string {
  return resultats
    .map((r) => {
      const etapes = r.changements.map((c) => ` Le dossier passe de « ${LIBELLES_ETAPE[c.de]} » à « ${LIBELLES_ETAPE[c.vers]} » : la main passe au client, le délai de relance court à partir d'aujourd'hui.`).join("");
      return `- ${r.nom} (${ko(r.taille)}) : ${r.destination}.${etapes}${r.avertissements.length ? ` ${r.avertissements.join(" ")}` : ""} [fichier:${r.id}]`;
    })
    .join("\n");
}

export const outilAjouterFichier = definirOutil({
  nom: "ajouter_fichier",
  titre: "Ajouter un fichier (photo, plan, devis, facture, justificatif…)",
  description:
    "Ajoute un fichier sur une cible — dossier, lead, client, dépense, réalisation du site — par l'une des cinq voies de « source » : lien_depot (ce qu'un lien de dépôt a reçu), url (lien public ou lien de partage Google Drive : le CRM le télécharge, 9 Mo au plus, photo ou PDF ; adresses internes refusées), base64 (+ nom), piece_mail { message_id, piece } (« lire_mail » liste les pièces), fichier_id (fichier déjà conservé). Selon la cible et le type : DOSSIER › PHOTO_AVANT / PHOTO_APRES → photos du dossier (proposées au simulateur) ; DOSSIER › DEVIS / FACTURE avec numero et montant → document repris, comme le dépôt d'un document repris (un devis visible, émis ou envoyé, vaut devis envoyé : le dossier passe en « Devis envoyé » depuis Qualification, Simulation ou Relance) — sans numéro ni montant, il est gardé « à compléter » ; DOSSIER › PLAN / JUSTIFICATIF / AUTRE → document du dossier ; LEAD › photo → photo du lead, autre → document rattaché ; CLIENT → document rattaché ; DOSSIER › SIMULATION → simulation déposée en brouillon (« Déposer une simulation » : titre, description, origine_simulation, preparation_id ; l'image de ChatGPT après « preparer_simulation ») ; DOSSIER › PDF_DOCUMENT + document_id → PDF d'un devis ou d'une facture repris (« importer le PDF ») ; DEPENSE › JUSTIFICATIF → justificatif (l'ancien part aux archives) ; PUBLICATION › PHOTO_AVANT / PHOTO_APRES → photo de la réalisation (prise dans son dossier). Le type du fichier est vérifié par son contenu (JPEG, PNG, WebP, HEIC converti, PDF). Réversible (« ranger_fichier » retirer: true) ; sensible — aperçu puis confirmation — quand un devis ou une facture repris devient visible du client ou change l'étape, ou quand la réalisation est déjà publiée.",
  niveau: "REVERSIBLE",
  schema: schemaAjouterFichier,
  sensible: async (e) => {
    if (e.cible.entite === "PUBLICATION" && e.cible.id) return publicationPubliee({ entite: "PUBLICATION", id: e.cible.id });
    return estDocumentRepris(e);
  },
  apercu: async (e) => {
    const r = await resoudreCibleFichier(e.cible);
    if (r.ambigu) return r.ambigu.texte;
    const lue = await lireCible(r.cible);
    const origine = origineLisible(e.source);
    if (lue.entite === "PUBLICATION") return `Je vais poser une ${LIBELLES_TYPE_FICHIER[e.type]} (${origine}) sur la réalisation ${lue.nom}, déjà publiée : elle sera visible tout de suite sur coverswap.fr.`;
    if (lue.entite !== "DOSSIER") throw new ErreurMetier(`Un ${LIBELLES_TYPE_FICHIER[e.type]} repris (numéro, montant) va sur un dossier.`, 400);
    if (e.type === "PDF_DOCUMENT") {
      const d = e.document_id ? await prisma.document.findFirst({ where: { id: e.document_id, dossierId: lue.id }, select: { type: true, numero: true, totalHt: true, pdfPath: true } }) : null;
      if (!d) throw new ErreurMetier("Document repris introuvable dans ce dossier (document_id, rendu par « voir_fichiers » documents).", 404);
      return `Je vais importer le PDF (${origine}) du ${d.type === "DEVIS" ? "devis" : "document"} repris ${d.numero ?? ""} (${format.euros(d.totalHt)} HT) du dossier de ${lue.nom}${d.pdfPath ? " ; l'ancien PDF reste aux archives" : ""}. C'est ce PDF que le client et les exports verront.`;
    }
    const dossier = await prisma.dossier.findUnique({ where: { id: lue.id }, select: { etape: true } });
    const vers = e.type === "DEVIS" && e.visible_espace !== false && (e.statut ?? "ENVOYE") === "ENVOYE" && dossier && estEtape(dossier.etape) ? etapeApresGeneration("DEVIS", dossier.etape) : null;
    const passage = vers && dossier ? ` Le dossier passera de « ${LIBELLES_ETAPE[dossier.etape as EtapeDossier]} » à « ${LIBELLES_ETAPE[vers]} » : la main au client, le délai de relance court à partir du dépôt.` : "";
    return `Je vais rattacher au dossier de ${lue.nom} ${e.type === "DEVIS" ? "le devis" : "la facture"} ${e.numero}${e.libelle ? ` « ${e.libelle} »` : ""} : ${format.euros(e.montant!)} HT, ${e.date_emission ?? "daté d'aujourd'hui"}, PDF ${origine}${e.type === "DEVIS" ? `, ${e.visible_espace === false ? "masqué dans son espace" : "visible dans son espace, à côté des autres devis proposés"}` : ""}. Aucun mail n'est envoyé.${passage}${e.inscrire_au_registre ? " Le numéro sera inscrit au registre s'il n'y est pas." : ""}`;
  },
  executer: async (e) => {
    if (e.type === "PDF_DOCUMENT" && !e.document_id) throw new ErreurMetier("PDF_DOCUMENT : donne document_id (le document repris).", 400);
    if ((e.type === "DEVIS" || e.type === "FACTURE") && Boolean(e.numero) !== Boolean(e.montant)) throw new ErreurMetier(`Un ${LIBELLES_TYPE_FICHIER[e.type]} repris demande son numéro ET son montant HT (sans les deux, il est gardé « à compléter »).`, 400);
    const r = await resoudreCibleFichier(e.cible);
    if (r.ambigu) return r.ambigu;
    const document = champsDocument(e);
    let resultats: ResultatEnregistrement[];
    if (e.source.lien_depot) {
      const lignes = await lignesDuLien(e.source.lien_depot);
      if (lignes.length === 0) throw new ErreurMetier("Aucun fichier reçu par ce lien qui reste à placer (déjà rangés ou retirés) : « voir_fichiers » pour les voir.", 409);
      if (estDocumentRepris(e) && lignes.length > 1) throw new ErreurMetier("Plusieurs fichiers reçus par ce lien : désigne le devis ou la facture par l'identifiant du fichier reçu.", 409);
      resultats = [];
      for (const ligne of lignes) resultats.push(await rangerFichierDepose(ligne.id, r.cible, e.type, document, optionsSimulation(e)));
    } else {
      const source = await lireSourceFichier(e.source);
      resultats = [await enregistrerFichierRecu(r.cible, e.type, { contenu: source.contenu, nom: source.nom }, { voie: source.voie, origine: source.origine, document, ...optionsSimulation(e) })];
    }
    const cible = resultats[0].cible!;
    return {
      texte: `${pluriel(resultats.length, "fichier ajouté", "fichiers ajoutés")} (${LIBELLES_ENTITE[cible.entite]} ${cible.nom}) :\n${texteResultats(resultats)}\nPour le retirer : « ranger_fichier » avec fichier = l'identifiant entre crochets et retirer: true.`,
      donnees: { fichiers: resultats.map((x) => ({ id: x.id, nom: x.nom, typeMime: x.typeMime, octets: x.taille, type: x.type, photoId: x.photoId, fichierId: x.fichierId, documentId: x.documentId, numero: x.numero, aCompleter: x.aCompleter, avertissements: x.avertissements, etape: x.changements.at(-1)?.vers ?? null })), cible },
      liens: [lienCible(cible)],
    };
  },
});

/* ── ranger_fichier ────────────────────────────────────────────── */

const schemaRanger = z
  .object({
    fichier: z.string().trim().min(1).max(60).describe("Le fichier : identifiant entre crochets [fichier:…] rendu par ajouter_fichier ou voir_fichiers ; « photo:<id> » pour une photo du dossier ou d'un lead ([photo:…] de voir_fichiers) ; ou l'identifiant d'un dépôt (tous ses fichiers encore à ranger)."),
    cible: schemaCibleFichier.optional().describe("Où le ranger (depuis « À ranger », ou pour le déplacer)."),
    type: z.enum(TYPES_FICHIER).optional().describe("Sa nature à sa nouvelle place (sinon celle qu'il avait, ou déduite)."),
    retirer: z.literal(true).optional().describe("Retirer le fichier de là où il est : il est archivé, jamais supprimé (« remettre » le replace)."),
    remettre: z.literal(true).optional().describe("Remettre un fichier retiré, à sa place d'avant (aussi une photo retirée par le client dans son espace)."),
    motif: z.string().trim().max(300).optional(),
  })
  .refine((e) => [e.cible ? 1 : 0, e.retirer ? 1 : 0, e.remettre ? 1 : 0].reduce((a, b) => a + b, 0) === 1, { message: "Donne UNE action : cible (ranger), retirer: true, ou remettre: true." });
type EntreeRanger = z.output<typeof schemaRanger>;

async function lignesDuFichier(fichier: string, pourRemettre: boolean): Promise<LigneDepot[]> {
  const photo = /^photo:(.+)$/.exec(fichier)?.[1];
  if (photo) {
    if (pourRemettre) {
      const ligne = await prisma.fichierDepose.findFirst({ where: { ...AVEC_ARCHIVES, archiveLe: { not: null }, rangeLe: null, OR: [{ photoLeadId: photo }, { photoChemin: { contains: `/${photo}.` } }] }, orderBy: { updatedAt: "desc" } });
      return ligne ? [ligne] : [];
    }
    return [await ligneDePhotoExistante(photo)];
  }
  const id = fichier.replace(/^(fichier|depot):/, "");
  const ligne = await prisma.fichierDepose.findUnique({ where: { id } });
  if (ligne) return [ligne];
  const jeton = await prisma.jetonDepot.findUnique({ where: { id } });
  if (jeton) return prisma.fichierDepose.findMany({ where: pourRemettre ? { jetonId: id, archiveLe: { not: null }, rangeLe: null } : { jetonId: id }, orderBy: { createdAt: "asc" } });
  throw new ErreurMetier(`Fichier introuvable : ${fichier}. Les identifiants sont rendus par « voir_fichiers » et « ajouter_fichier ».`, 404);
}

export const outilRangerFichier = definirOutil({
  nom: "ranger_fichier",
  titre: "Ranger, retirer ou remettre un fichier",
  description:
    "Trois gestes sur un fichier du CRM. Ranger : un fichier de la boîte « À ranger » (dépôt libre) va sur sa cible (cible + type, mêmes règles qu'« ajouter_fichier ») ; un fichier déjà placé peut aussi changer de cible ou de type (photo mise sur le mauvais dossier, photo avant qui est une photo après). Retirer (retirer: true) : le fichier quitte sa place — photo du dossier (DP24), photo d'un lead, document, justificatif, photo d'une réalisation — et reste gardé (archivé, jamais supprimé). Remettre (remettre: true) : le fichier retiré revient à sa place ; marche aussi pour une photo que le client a retirée de son espace. Désigner le fichier par l'identifiant [fichier:…] ou [photo:…] rendu par « voir_fichiers » ou « ajouter_fichier ». Un devis ou une facture repris ne se retire pas ici (« annuler_document »). Réversible ; sensible si une réalisation déjà publiée change.",
  niveau: "REVERSIBLE",
  schema: schemaRanger,
  sensible: async (e) => {
    if (e.cible?.entite === "PUBLICATION" && e.cible.id && (await publicationPubliee({ entite: "PUBLICATION", id: e.cible.id }))) return true;
    const id = e.fichier.replace(/^(fichier|depot):/, "");
    const ligne = /^photo:/.test(e.fichier) ? null : await prisma.fichierDepose.findUnique({ where: { id }, select: { cibleEntite: true, cibleId: true } });
    return ligne?.cibleEntite === "PUBLICATION" && ligne.cibleId ? publicationPubliee({ entite: "PUBLICATION", id: ligne.cibleId }) : false;
  },
  apercu: async (e) => `Je vais ${e.retirer ? "retirer" : e.remettre ? "remettre" : "déplacer"} le fichier ${e.fichier}, qui touche une réalisation déjà publiée : le changement sera visible tout de suite sur coverswap.fr.`,
  executer: async (e: EntreeRanger) => {
    if (e.retirer) {
      const lignes = await lignesDuFichier(e.fichier, false);
      const faites: LigneDepot[] = [];
      for (const l of lignes.filter((x) => !x.archiveLe)) faites.push(await retirerFichierDepose(l.id, e.motif || "Retiré par Lucas (assistant)"));
      if (faites.length === 0) throw new ErreurMetier("Rien à retirer : ce fichier est déjà retiré.", 409);
      return { texte: `${pluriel(faites.length, "fichier retiré", "fichiers retirés")} : ${faites.map((l) => `${l.nom ?? "fichier"} (${l.cibleEntite ? `${LIBELLES_ENTITE[l.cibleEntite as EntiteCible]} ${l.cibleNom ?? l.cibleId}` : "À ranger"}) [fichier:${l.id}]`).join(" ; ")}. Gardé${faites.length > 1 ? "s" : ""} aux archives : « ranger_fichier » remettre: true le${faites.length > 1 ? "s" : ""} remet.`, donnees: { retires: faites.map((l) => ({ id: l.id, nom: l.nom, cibleEntite: l.cibleEntite, cibleId: l.cibleId })) } };
    }
    if (e.remettre) {
      const lignes = await lignesDuFichier(e.fichier, true);
      const photo = /^photo:(.+)$/.exec(e.fichier)?.[1];
      if (lignes.length === 0 && photo) {
        // Une photo retirée par le client dans son espace (DP36) : le geste « remettre » du bloc Espace client.
        const espaces = await prisma.espaceClient.findMany({ where: { ...AVEC_ARCHIVES, photosRetirees: { contains: photo } }, select: { dossierId: true, photosRetirees: true } });
        const espace = espaces.find((x) => lirePhotosRetirees(x.photosRetirees).some((p) => p.id === photo));
        if (!espace) throw new ErreurMetier(`Aucune photo retirée « ${photo} ».`, 404);
        await gesteDeLucas(espace.dossierId, { geste: "remettre-photo", photoId: photo });
        return { texte: `Photo ${photo} remise dans le dossier (le client l'avait retirée de son espace).`, donnees: { photoId: photo, dossierId: espace.dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${espace.dossierId}`)] };
      }
      if (lignes.length === 0) throw new ErreurMetier("Rien à remettre : ce fichier n'est pas retiré.", 409);
      const faites: LigneDepot[] = [];
      for (const l of lignes) faites.push(await remettreFichierDepose(l.id));
      return { texte: `${pluriel(faites.length, "fichier remis", "fichiers remis")} à sa place : ${faites.map((l) => `${l.nom ?? "fichier"} (${l.cibleEntite ? `${LIBELLES_ENTITE[l.cibleEntite as EntiteCible]} ${l.cibleNom ?? l.cibleId}` : "À ranger"}) [fichier:${l.id}]`).join(" ; ")}.`, donnees: { remis: faites.map((l) => ({ id: l.id, nom: l.nom, cibleEntite: l.cibleEntite, cibleId: l.cibleId })) } };
    }
    const r = await resoudreCibleFichier(e.cible!);
    if (r.ambigu) return r.ambigu;
    const lignes = (await lignesDuFichier(e.fichier, false)).filter((l) => !l.archiveLe && !l.rangeLe);
    if (lignes.length === 0) throw new ErreurMetier("Rien à ranger : ce fichier est déjà rangé ou retiré.", 409);
    const resultats: ResultatEnregistrement[] = [];
    for (const l of lignes) resultats.push(await rangerFichierDepose(l.id, r.cible, (e.type as TypeFichier | undefined) ?? null));
    const cible = resultats[0].cible!;
    return { texte: `${pluriel(resultats.length, "fichier rangé", "fichiers rangés")} (${LIBELLES_ENTITE[cible.entite]} ${cible.nom}) :\n${texteResultats(resultats)}`, donnees: { fichiers: resultats.map((x) => ({ id: x.id, nom: x.nom, type: x.type, photoId: x.photoId, fichierId: x.fichierId, aCompleter: x.aCompleter })), anciens: lignes.map((l) => l.id), cible }, liens: [lienCible(cible)] };
  },
});

/* ── voir_fichiers ─────────────────────────────────────────────── */

const GENRES = ["photos", "simulations", "documents", "a_ranger", "site", "preparations", "banc", "piece_mail"] as const;

const schemaVoir = z.object({
  genre: z.enum(GENRES).optional().describe("photos (défaut) : photos avant / après d'un dossier ou d'un lead ; simulations : simulations d'un dossier (avant / après) ; documents : devis, factures, documents déposés, justificatif, documents d'un lead (ancien CRM, PDF des simulations du site) ; a_ranger : la boîte des dépôts libres ; site : simulations faites sur coverswap.fr et générations en cours ou en échec ; preparations : le simulateur d'un dossier (type suggéré, photos avant, préparations récentes) ou une préparation (preparation_id : état, prompt, photo) ; banc : un rendu du banc (rendu_id) ; piece_mail : une pièce jointe (message_id, piece)."),
  cible: schemaCibleFichier.optional().describe("Le dossier, lead, client, dépense ou réalisation (pas pour a_ranger ni site)."),
  nombre: z.number().int().min(1).max(IMAGES_MAX_PAR_RESULTAT).optional().describe("Combien d'éléments (photos : 6 par défaut, 12 au plus ; simulations : 4, 8 au plus)."),
  decalage: z.number().int().min(0).max(200).optional().describe("photos, a_ranger : sauter les N plus récents (déjà vus)."),
  apres: z.boolean().optional().describe("photos : les photos après chantier aussi (portfolio)."),
  photo_id: z.string().max(80).optional().describe("photos : une seule photo, par son identifiant."),
  retirees: z.boolean().optional().describe("photos : montrer aussi les photos retirées (par le client dans son espace, ou par ranger_fichier), à remettre au besoin."),
  simulation_id: z.string().max(40).optional().describe("simulations : une seule simulation."),
  sans_avant: z.boolean().optional().describe("simulations : ne pas joindre les photos avant."),
  avec_prompt: z.boolean().optional().describe("simulations : le prompt donné au modèle et la direction artistique."),
  jours: z.number().int().min(1).max(365).optional().describe("site : fenêtre en jours (7 par défaut)."),
  rattachees: z.boolean().optional().describe("site : vrai, celles rattachées à un lead ; faux, les anonymes."),
  lead_id: z.string().max(40).optional().describe("site : celles d'un lead."),
  sans_images: z.boolean().optional().describe("site, documents, a_ranger : description seule, aucune image."),
  document_id: z.string().max(80).optional().describe("documents : le document à ouvrir, joint en entier (PDF) — l'identifiant entre crochets de la liste ([document:…], [fichier:…], [ancien_devis:…], [ancienne_facture:…], [simulation_pdf:…])."),
  preparation_id: z.string().max(40).optional().describe("preparations : une préparation (état de la génération, étape, erreur, prompt, photo cadrée)."),
  rendu_id: z.string().max(40).optional().describe("banc : un rendu du banc (image, photo d'origine, prompt)."),
  message_id: z.string().max(40).optional().describe("piece_mail : le mail (rendu par « lire_mail »)."),
  piece: z.string().max(80).optional().describe("piece_mail : l'identifiant de la pièce (« lire_mail » les liste)."),
});
type EntreeVoir = z.output<typeof schemaVoir>;

/** La cible au format des anciens outils voir_photos / voir_simulations (dossierId, leadId, clientId, nom). */
async function cibleAncienne(c: CibleOutil | undefined): Promise<{ dossierId?: string; leadId?: string; clientId?: string; nom?: string }> {
  if (!c) throw new ErreurMetier("Donne la cible (dossier, lead ou client).", 400);
  if (!c.id) return { nom: c.nom };
  if (c.entite === "LEAD") return { leadId: c.id };
  if (c.entite === "CLIENT") return { clientId: c.id };
  return { dossierId: c.id };
}

/** `cle` : l'identifiant que « document_id » désigne pour joindre le fichier entier (PDF). */
type Element = { libelle: string; octets: () => Promise<Buffer | null>; typeMime: string; lien: string | null; cle?: string };

const OCTETS_MAX_DOCUMENT = 9 * 1024 * 1024;

/** Un document entier (PDF), joint comme ressource embarquée ; null s'il ne se lit pas ou dépasse 9 Mo. */
async function documentJoint(el: Element): Promise<DocumentOutil | null> {
  const contenu = await el.octets().catch(() => null);
  if (!contenu || contenu.length > OCTETS_MAX_DOCUMENT) return null;
  return { libelle: el.libelle, mimeType: el.typeMime, base64: contenu.toString("base64"), octets: contenu.length, uri: el.lien ? `${adresseCrm()}${el.lien}` : `coverswap://fichier/${el.cle ?? "document"}` };
}

/**
 * Un PDF que l'écran produit dans sa route (PDF d'une simulation du site, devis et facture de l'ancien CRM) : la même
 * route est appelée ici, en lecture, et son contenu rendu tel quel.
 */
async function contenuDeLaRoute(module: "simulation" | "ancien-devis" | "ancienne-facture", id: string): Promise<{ contenu: Buffer; typeMime: string } | null> {
  const { NextRequest } = await import("next/server");
  const route = module === "simulation" ? await import("@/app/api/simulations/[id]/pdf/route") : module === "ancien-devis" ? await import("@/app/api/pdf/devis/[id]/route") : await import("@/app/api/pdf/facture/[id]/route");
  const chemin = module === "simulation" ? `/api/simulations/${id}/pdf` : module === "ancien-devis" ? `/api/pdf/devis/${id}` : `/api/pdf/facture/${id}`;
  const reponse = await route.GET(new NextRequest(`${adresseCrm()}${chemin}`), { params: Promise.resolve({ id }) });
  if (!reponse.ok) return null;
  return { contenu: Buffer.from(await reponse.arrayBuffer()), typeMime: (reponse.headers.get("content-type") ?? "application/pdf").split(";")[0] };
}

async function rendreElements(titre: string, elements: Element[], e: EntreeVoir, donnees: unknown, liens: LienOutil[]): Promise<ResultatOutil> {
  const images: ImageOutil[] = [];
  const documents: DocumentOutil[] = [];
  const lignes: string[] = [];
  for (const el of elements) {
    if (e.document_id && el.cle === e.document_id.replace(/^\[|\]$/g, "")) {
      if (el.typeMime === "text/html") {
        const html = (await el.octets().catch(() => null))?.toString("utf8") ?? "";
        lignes.push(`${el.libelle} — contenu :\n${html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000)}`);
        continue;
      }
      const joint = el.typeMime.startsWith("image/") ? null : await documentJoint(el);
      if (joint) {
        documents.push(joint);
        lignes.push(`${el.libelle} (document joint en entier, ${ko(joint.octets)})`);
        continue;
      }
    }
    const estImage = el.typeMime.startsWith("image/");
    if (estImage && !e.sans_images && images.length < IMAGES_MAX_PAR_RESULTAT) {
      const image = await imagePourResultat(await el.octets().catch(() => null), el.libelle);
      if (image) {
        images.push(image);
        lignes.push(`${el.libelle} (image jointe, ${ko(image.octets)})`);
        continue;
      }
      lignes.push(`${el.libelle} (illisible ici${el.typeMime.includes("hei") ? " : HEIC" : ""})${el.lien ? ` — ${adresseCrm()}${el.lien}` : ""}`);
      continue;
    }
    lignes.push(`${el.libelle}${el.lien ? ` — ${adresseCrm()}${el.lien}` : ""}`);
  }
  if (e.document_id && documents.length === 0 && !lignes.some((l) => l.includes("contenu :")) && !elements.some((el) => el.cle === e.document_id && el.typeMime.startsWith("image/"))) lignes.push(`Document ${e.document_id} introuvable ou illisible ici : reprends l'identifiant entre crochets de la liste.`);
  return { texte: [titre, ...lignes].join("\n"), images, documents, donnees, liens };
}

async function voirDocuments(e: EntreeVoir): Promise<ResultatOutil> {
  if (!e.cible) throw new ErreurMetier("Donne la cible dont voir les documents.", 400);
  const r = await resoudreCibleFichier(e.cible);
  if (r.ambigu) return r.ambigu;
  const lue = await lireCible(r.cible);
  const elements: Element[] = [];
  const depots = await prisma.fichierDepose.findMany({ where: { cibleEntite: lue.entite, cibleId: lue.id }, orderBy: { createdAt: "desc" } });
  const parFichier = new Map(depots.filter((d) => d.fichierId).map((d) => [d.fichierId!, d]));
  const deFichier = (fichierId: string) => async () => (await lireFichierConserve(fichierId).catch(() => null))?.contenu ?? null;

  if (lue.entite === "DOSSIER") {
    const documents = await prisma.document.findMany({ where: { dossierId: lue.id, numero: { not: null } }, orderBy: { createdAt: "desc" } });
    for (const d of documents) elements.push({ libelle: `${d.type === "DEVIS" ? "Devis" : d.type === "FACTURE" ? "Facture" : d.type} ${d.numero}${d.libelleVariante ? ` « ${d.libelleVariante} »` : ""} — ${format.euros(d.totalHt)} HT — ${d.statut.toLowerCase()} — ${format.jourCourt(d.createdAt)}${d.pdfPath || d.origine !== "REPRISE" ? "" : " (PDF non importé : ajouter_fichier PDF_DOCUMENT)"} [document:${d.id}]`, octets: async () => (await lirePdfDocument(lue.id, d.id)).contenu, typeMime: "application/pdf", lien: `/api/dossiers/${lue.id}/documents/${d.id}/pdf`, cle: `document:${d.id}` });
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId: lue.id, type: "DOCUMENT_DEPOSE" }, orderBy: { createdAt: "desc" } });
    for (const ev of evenements) {
      let meta: { fichierId?: string; typeMime?: string; libelle?: string; nom?: string } = {};
      try {
        meta = JSON.parse(ev.metadata);
      } catch {
        // métadonnée illisible : l'événement est dit sans lien
      }
      if (!meta.fichierId) continue;
      const depot = parFichier.get(meta.fichierId);
      elements.push({ libelle: `${meta.libelle ?? meta.nom ?? "Document"}${meta.nom && meta.nom !== meta.libelle ? ` (${meta.nom})` : ""} — déposé le ${format.jourCourt(ev.createdAt)}${depot?.aCompleter ? " — À COMPLÉTER (numéro, montant : ajouter_fichier source.lien_depot)" : ""} [${depot ? `fichier:${depot.id}` : `fichier_conserve:${meta.fichierId}`}]`, octets: deFichier(meta.fichierId), typeMime: meta.typeMime ?? "application/pdf", lien: `/api/fichiers/${meta.fichierId}`, cle: depot ? `fichier:${depot.id}` : `fichier_conserve:${meta.fichierId}` });
    }
  } else if (lue.entite === "DEPENSE") {
    const d = await prisma.depense.findUnique({ where: { id: lue.id }, select: { justificatifId: true, justificatif: { select: { typeMime: true } } } });
    if (d?.justificatifId) elements.push({ libelle: `Justificatif de la dépense ${lue.nom} [${parFichier.get(d.justificatifId) ? `fichier:${parFichier.get(d.justificatifId)!.id}` : "justificatif"}]`, octets: deFichier(d.justificatifId), typeMime: d.justificatif?.typeMime ?? "application/pdf", lien: `/api/depenses/${lue.id}/justificatif`, cle: parFichier.get(d.justificatifId) ? `fichier:${parFichier.get(d.justificatifId)!.id}` : "justificatif" });
  } else if (lue.entite === "PUBLICATION") {
    const p = await prisma.publicationSite.findUnique({ where: { id: lue.id }, select: { photoAvant: true, photoApres: true } });
    for (const [quelle, chemin] of [["avant", p?.photoAvant], ["après", p?.photoApres]] as const) if (chemin) elements.push({ libelle: `Photo ${quelle} de la réalisation ${lue.nom} [photo:${idPhoto(chemin)}]`, octets: () => lireFichier(chemin), typeMime: "image/jpeg", lien: null });
  }
  if (lue.entite === "LEAD" || lue.entite === "CLIENT") {
    for (const d of depots.filter((x) => x.fichierId)) elements.push({ libelle: `${d.nom ?? "Fichier"} — ${d.type ? LIBELLES_TYPE_FICHIER[d.type as TypeFichier] : "document"} — déposé le ${format.jourCourt(d.createdAt)} [fichier:${d.id}]`, octets: deFichier(d.fichierId!), typeMime: d.typeMime, lien: `/api/fichiers/${d.fichierId}`, cle: `fichier:${d.id}` });
  }
  if (lue.entite === "LEAD") {
    // La fiche du lead (LF22, LF25) : le PDF « avant / après » de ses simulations du site, et les devis, factures et
    // chantier de l'ancien CRM — les mêmes PDF que les liens de la fiche.
    const lead = await prisma.lead.findUnique({ where: { id: lue.id }, select: { simulations: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, referenceChoisie: true, prixDevis: true } }, devis: { orderBy: { createdAt: "desc" }, select: { id: true, numero: true, statut: true, prixVente: true, createdAt: true, facture: { select: { id: true, numero: true, statut: true } } } }, chantier: { select: { dateIntervention: true, statut: true, adresse: true } } } });
    for (const sim of lead?.simulations ?? []) elements.push({ libelle: `PDF avant / après de la simulation du ${format.jourCourt(sim.createdAt)}${sim.referenceChoisie ? ` (teinte ${sim.referenceChoisie})` : ""}${sim.prixDevis ? `, prix simulé ${format.euros(sim.prixDevis)}` : ""} [simulation_pdf:${sim.id}]`, octets: async () => (await contenuDeLaRoute("simulation", sim.id))?.contenu ?? null, typeMime: "application/pdf", lien: `/api/simulations/${sim.id}/pdf`, cle: `simulation_pdf:${sim.id}` });
    for (const dv of lead?.devis ?? []) {
      elements.push({ libelle: `Ancien CRM — devis ${dv.numero}, ${format.euros(dv.prixVente)} (${dv.statut.toLowerCase()}), du ${format.jourCourt(dv.createdAt)} [ancien_devis:${dv.id}]`, octets: async () => (await contenuDeLaRoute("ancien-devis", dv.id))?.contenu ?? null, typeMime: "application/pdf", lien: `/api/pdf/devis/${dv.id}`, cle: `ancien_devis:${dv.id}` });
      if (dv.facture) elements.push({ libelle: `Ancien CRM — facture ${dv.facture.numero} (${dv.facture.statut.toLowerCase()}) [ancienne_facture:${dv.facture.id}]`, octets: async () => (await contenuDeLaRoute("ancienne-facture", dv.facture!.id))?.contenu ?? null, typeMime: "text/html", lien: `/api/pdf/facture/${dv.facture.id}`, cle: `ancienne_facture:${dv.facture.id}` });
    }
    if (lead?.chantier) elements.push({ libelle: `Ancien CRM — chantier du ${format.jourCourt(lead.chantier.dateIntervention)} (${lead.chantier.statut.toLowerCase()})${lead.chantier.adresse ? `, ${lead.chantier.adresse}` : ""}`, octets: async () => null, typeMime: "text/plain", lien: null });
  }
  const choisis = e.document_id ? elements.filter((el) => el.cle === e.document_id!.replace(/^\[|\]$/g, "")) : elements.slice(e.decalage ?? 0, (e.decalage ?? 0) + (e.nombre ?? 12));
  const titre = elements.length === 0 ? `Aucun document pour ${LIBELLES_ENTITE[lue.entite]} ${lue.nom}.` : `${LIBELLES_ENTITE[lue.entite].charAt(0).toUpperCase()}${LIBELLES_ENTITE[lue.entite].slice(1)} ${lue.nom} : ${pluriel(elements.length, "document")}${choisis.length < elements.length ? ` (${choisis.length} ici)` : ""}.`;
  return rendreElements(titre, choisis, e, { total: elements.length, cible: { entite: lue.entite, id: lue.id } }, [lienCible(lue)]);
}

async function voirARanger(e: EntreeVoir): Promise<ResultatOutil> {
  const tous = await prisma.fichierDepose.findMany({ where: { cibleEntite: null }, orderBy: { createdAt: "desc" }, take: 200 });
  const decalage = e.decalage ?? 0;
  const choisis = tous.slice(decalage, decalage + (e.nombre ?? 6));
  const elements: Element[] = choisis.map((d) => ({ libelle: `${d.nom ?? "fichier"} — ${d.type ? LIBELLES_TYPE_FICHIER[d.type as TypeFichier] : "à classer"} — reçu le ${format.jourCourt(d.createdAt)}${d.voie === "LIEN_DEPOT" ? " par lien de dépôt" : ""} [fichier:${d.id}]`, octets: async () => (d.fichierId ? ((await lireFichierConserve(d.fichierId).catch(() => null))?.contenu ?? null) : null), typeMime: d.typeMime, lien: d.fichierId ? `/api/fichiers/${d.fichierId}` : null }));
  const titre = tous.length === 0 ? "La boîte « À ranger » est vide." : `« À ranger » : ${pluriel(tous.length, "fichier")}${tous.length > decalage + choisis.length ? `, ${tous.length - decalage - choisis.length} de plus avec decalage=${decalage + choisis.length}` : ""}. Classe chacun avec « ranger_fichier » (fichier, cible, type).`;
  return rendreElements(titre, elements, e, { total: tous.length, fichiers: choisis.map((d) => ({ id: d.id, nom: d.nom, typeMime: d.typeMime, octets: d.taille, type: d.type, recuLe: d.createdAt.toISOString(), jetonId: d.jetonId })) }, []);
}

/** DP35 : les photos retirées d'un dossier (par le client dans son espace, ou par ranger_fichier), à remettre au besoin. */
async function photosRetirees(dossierId: string): Promise<Element[]> {
  const espace = await prisma.espaceClient.findFirst({ where: { ...AVEC_ARCHIVES, dossierId }, select: { photosRetirees: true } });
  const parClient: Element[] = lirePhotosRetirees(espace?.photosRetirees).map((p) => ({ libelle: `Photo retirée par ${p.par === "CLIENT" ? "le client dans son espace" : "Lucas"} le ${format.jourCourt(p.le)} [photo:${p.id}]`, octets: () => lireFichier(p.chemin), typeMime: "image/jpeg", lien: `/api/dossiers/${dossierId}/espace/photos-retirees/${p.id}` }));
  const parOutil = await prisma.fichierDepose.findMany({ where: { cibleEntite: "DOSSIER", cibleId: dossierId, photoChemin: { not: null }, archiveLe: { not: null }, rangeLe: null }, orderBy: { updatedAt: "desc" } });
  return [...parClient, ...parOutil.map((d) => ({ libelle: `Photo retirée le ${format.jourCourt(d.archiveLe!)}${d.archiveMotif ? ` (${d.archiveMotif})` : ""} [fichier:${d.id}]`, octets: () => lireFichier(d.photoChemin!), typeMime: d.typeMime, lien: null }))];
}

/** S3, S10, S11 : le simulateur d'un dossier (type suggéré, photos avant, préparations récentes), ou une préparation. */
async function voirPreparations(e: EntreeVoir): Promise<ResultatOutil> {
  const { lirePreparation, photoDePreparation, photosAvantDuDossier, preparationsRecentes } = await import("@/lib/simulateur/preparation");
  const lignePreparation = (p: Awaited<ReturnType<typeof lirePreparation>>) => `${p.mode === "API" ? "Génération par l'API" : "Paquet ChatGPT"} du ${format.jourCourt(p.le)} — ${p.typeLibelle} — ${p.zones.map((z) => `${z.libelle} → ${z.nom} (${z.ref})`).join(", ")} — ${p.statut.toLowerCase()}${p.etape ? ` (étape ${p.etape})` : ""}${p.erreur ? ` — erreur : ${p.erreur}` : ""}${p.resultatId ? ` — rendu : simulation ${p.resultatId} (brouillon)` : ""}${p.scoreControle !== null ? ` — contrôle ${p.scoreControle}/100${p.sousSeuil ? " (sous le seuil)" : ""}` : ""} [preparation:${p.id}]`;
  if (e.preparation_id) {
    const p = await lirePreparation(e.preparation_id);
    const photo = e.sans_images ? null : await imagePourResultat((await photoDePreparation(p.id).catch(() => null))?.contenu ?? null, "Photo cadrée de la préparation");
    return { texte: [lignePreparation(p), p.prompt ? `Prompt${p.promptVersion ? ` (version ${p.promptVersion})` : ""} :\n${p.prompt}` : "", p.directionArtistique ? `Direction artistique : ${p.directionArtistique}` : ""].filter(Boolean).join("\n"), images: photo ? [photo] : [], donnees: p, liens: [lien("Rouvrir dans le simulateur", `/simulateur?dossier=${p.dossierId}&preparation=${p.id}`)] };
  }
  if (!e.cible) throw new ErreurMetier("Donne le dossier (cible), ou preparation_id.", 400);
  const r = await resoudreCibleFichier({ ...e.cible, entite: e.cible.entite ?? "DOSSIER" });
  if (r.ambigu) return r.ambigu;
  if (r.cible.entite !== "DOSSIER") throw new ErreurMetier("Le simulateur travaille sur un dossier.", 400);
  const dossierId = r.cible.id;
  const [{ repererTypeSurface }, { lireProjet }, { famillesDe, lireSelection }] = await Promise.all([import("@/lib/simulateur/preparation-assistant"), import("@/lib/espace/projet"), import("@/lib/prestations/prestations")]);
  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { clientNom: true, prestations: true, lead: { select: { typeProjet: true } }, espaces: { take: 1, select: { souhaits: true } } } });
  const selection = lireSelection(dossier.prestations);
  const projet = lireProjet(dossier.espaces[0]?.souhaits ?? null, selection, dossier.lead?.typeProjet);
  const type = (() => {
    try {
      return repererTypeSurface(null, famillesDe(selection)[0] ?? dossier.lead?.typeProjet ?? "CUISINE", projet?.zones ?? []);
    } catch {
      return null;
    }
  })();
  const [photos, preparations] = await Promise.all([photosAvantDuDossier(dossierId), preparationsRecentes(dossierId)]);
  const texte = [
    `Simulateur — ${dossier.clientNom} : type suggéré ${type ? `${type.libelle} (${type.id})` : "à choisir"}${projet?.zones?.length ? ` ; zones du projet : ${projet.zones.join(", ")}` : ""} ; ${pluriel(photos.length, "photo avant")}${photos.length ? ` (${photos.slice(0, 6).map((p) => p.id).join(", ")})` : ""}.`,
    preparations.length ? `Préparations des deux dernières semaines :\n${preparations.map((p) => `- ${lignePreparation(p)}`).join("\n")}` : "Aucune préparation récente.",
  ].join("\n");
  return { texte, donnees: { dossierId, typeSuggere: type?.id ?? null, zonesProjet: projet?.zones ?? [], photos, preparations }, liens: [lien("Simulateur", `/simulateur?dossier=${dossierId}`)] };
}

/** S17 : un rendu du banc — l'image, la photo d'origine du cas, le prompt. */
async function voirRenduBanc(e: EntreeVoir): Promise<ResultatOutil> {
  if (!e.rendu_id) throw new ErreurMetier("Donne rendu_id (« etat_crm » BANC liste les rendus).", 400);
  const { imageRenduBanc } = await import("@/lib/simulateur/banc/banc");
  const r = await prisma.renduBanc.findUnique({ where: { id: e.rendu_id }, select: { id: true, cas: true, variante: true, statut: true, moteur: true, qualite: true, score: true, defauts: true, coutDollars: true, dureeMs: true, promptTexte: true, directionArtistique: true, erreur: true, dossierId: true, photoId: true, termineLe: true } });
  if (!r) throw new ErreurMetier("Rendu du banc introuvable.", 404);
  const images: ImageOutil[] = [];
  if (!e.sans_images) {
    const rendu = r.statut === "PRET" ? await imagePourResultat((await imageRenduBanc(r.id).catch(() => null))?.contenu ?? null, `Rendu ${r.cas} / ${r.variante}`) : null;
    if (rendu) images.push(rendu);
    const d = await prisma.dossier.findUnique({ where: { id: r.dossierId }, select: { photos: true } });
    const chemin = (await import("@/lib/dossiers/stockage")).lirePhotos(d?.photos ?? "[]").find((c) => idPhoto(c) === r.photoId);
    const photo = chemin ? await imagePourResultat(await lireFichier(chemin), `Photo d'origine du cas ${r.cas}`) : null;
    if (photo) images.push(photo);
  }
  return { texte: [`Banc — cas ${r.cas}, variante ${r.variante}, ${r.statut.toLowerCase()}${r.moteur ? `, moteur ${r.moteur}` : ""}${r.qualite ? `, qualité ${r.qualite}` : ""}${r.score !== null ? `, contrôle ${r.score}/100` : ""}${r.coutDollars !== null ? `, ${r.coutDollars.toFixed(3)} $` : ""}${r.erreur ? ` — erreur : ${r.erreur}` : ""}.`, r.promptTexte ? `Prompt :\n${r.promptTexte}` : "", r.directionArtistique ? `Direction artistique : ${r.directionArtistique}` : ""].filter(Boolean).join("\n"), images, donnees: r, liens: [lien("Banc", "/simulateur/banc")] };
}

/** M15 : une pièce jointe d'un mail — image montrée, PDF joint en entier. */
async function voirPieceMail(e: EntreeVoir): Promise<ResultatOutil> {
  if (!e.message_id || !e.piece) throw new ErreurMetier("Donne message_id et piece (« lire_mail » liste les pièces).", 400);
  const { lirePieceMessage } = await import("@/lib/messages/consultation");
  const p = await lirePieceMessage(e.message_id, e.piece);
  const el: Element = { libelle: `Pièce « ${p.nom} » (${p.typeMime})`, octets: async () => p.contenu, typeMime: p.typeMime, lien: `/api/messages/${e.message_id}/pieces/${e.piece}`, cle: "piece" };
  if (p.typeMime.startsWith("image/")) return rendreElements(`Pièce jointe du mail ${e.message_id} :`, [el], e, { nom: p.nom, typeMime: p.typeMime, octets: p.contenu.length }, [lien("Mail", "/mail")]);
  return rendreElements(`Pièce jointe du mail ${e.message_id} :`, [el], { ...e, document_id: "piece" }, { nom: p.nom, typeMime: p.typeMime, octets: p.contenu.length }, [lien("Mail", "/mail")]);
}

/** L25 : les générations du site des N derniers jours encore en cours ou en échec, avec la raison. */
async function texteTravauxSite(jours: number, maintenant: Date): Promise<{ texte: string; donnees: unknown }> {
  const { travauxSiteRecents } = await import("@/lib/simulations/travaux-lecture");
  const t = await travauxSiteRecents(jours, maintenant);
  if (!t.lignes.length) return { texte: `Générations du site : aucune en cours ni en échec sur ${pluriel(jours, "jour")}.`, donnees: t };
  return { texte: `Générations du site sur ${pluriel(jours, "jour")} : ${t.enCours} en cours, ${pluriel(t.enEchec, "en échec", "en échec")} :\n${t.lignes.map((l) => `- ${format.jourCourt(l.le)} ${l.projetLibelle} (${l.teintes}) — ${l.statut.toLowerCase()}${l.erreurRaison ? ` : ${l.erreurRaison}${l.erreurMessage ? ` (${l.erreurMessage})` : ""}` : ""}${l.prevenir ? ` — le visiteur veut être prévenu${l.notifie ? " (prévenu)" : ""}` : ""}`).join("\n")}`, donnees: t };
}

export const outilVoirFichiers = definirOutil({
  nom: "voir_fichiers",
  titre: "Voir les fichiers : photos, simulations, documents, À ranger, site",
  description:
    "Rend les fichiers du CRM comme de vraies images (blocs image, compressées), les PDF en liste avec leur lien. genre photos (défaut) : les photos d'un dossier ou d'un lead avec date, origine et zone — 6 plus récentes, « nombre » (12 au plus), « decalage », « apres » (photos après chantier), « photo_id », « retirees » (photos retirées par le client ou par ranger_fichier, à remettre) ; à regarder AVANT de conseiller une teinte ou de préparer une simulation (ex-voir_photos). genre simulations : les simulations d'un dossier, après puis avant, teintes, statut, vue ou choisie par le client, contrôle — « nombre » (8 au plus), « simulation_id », « sans_avant », « avec_prompt » (ex-voir_simulations). genre documents : devis et factures (lien du PDF), documents déposés (plans, BAT, devis à compléter), justificatif d'une dépense, photos d'une réalisation, documents rattachés à un lead ou un client. genre a_ranger : les fichiers des dépôts libres, à classer avec « ranger_fichier ». genre site : les simulations faites sur coverswap.fr, anonymes ou rattachées — « jours », « rattachees », « lead_id », « nombre », « sans_images » (ex-simulations_site) — et les générations en cours ou en échec avec leur raison. genre documents avec document_id : le document entier joint (PDF d'un devis ou d'une facture, justificatif, document déposé, PDF d'une simulation du site, devis et factures de l'ancien CRM d'un lead). genre preparations : le simulateur d'un dossier (type suggéré, photos avant, préparations récentes) ou une préparation (preparation_id : état d'une génération par l'API, prompt, photo). genre banc : un rendu du banc (rendu_id : image, photo d'origine, prompt). genre piece_mail : une pièce jointe (message_id, piece). Chaque fichier porte son identifiant entre crochets ([photo:…], [fichier:…]) pour « ranger_fichier ».",
  niveau: "LECTURE",
  schema: schemaVoir,
  executer: async (e, contexte: ContexteOutil) => {
    const genre = e.genre ?? "photos";
    if (genre === "site") {
      const r = await outilSimulationsSite.executer({ jours: e.jours, rattachees: e.rattachees, lead_id: e.lead_id ?? (e.cible?.entite === "LEAD" ? e.cible.id : undefined), nombre: e.nombre ? Math.min(e.nombre, 8) : undefined, sans_images: e.sans_images }, contexte);
      if (e.lead_id || e.cible) return r;
      const travaux = await texteTravauxSite(e.jours ?? 7, contexte.maintenant);
      return { ...r, texte: `${r.texte}\n${travaux.texte}`, donnees: { ...(r.donnees as object), travaux: travaux.donnees } };
    }
    if (genre === "preparations") return voirPreparations(e);
    if (genre === "banc") return voirRenduBanc(e);
    if (genre === "piece_mail") return voirPieceMail(e);
    if (genre === "a_ranger") return voirARanger(e);
    if (genre === "documents") return voirDocuments(e);
    if (genre === "simulations") return outilVoirSimulations.executer({ ...(await cibleAncienne(e.cible)), nombre: e.nombre ? Math.min(e.nombre, 8) : undefined, simulation_id: e.simulation_id, sans_avant: e.sans_avant, avec_prompt: e.avec_prompt }, contexte);
    // photos
    if (e.cible?.entite === "PUBLICATION" || e.cible?.entite === "DEPENSE") return voirDocuments(e);
    const resultat = await outilVoirPhotos.executer({ ...(await cibleAncienne(e.cible)), nombre: e.nombre, decalage: e.decalage, apres: e.apres, photo_id: e.photo_id }, contexte);
    if (!e.retirees) return resultat;
    const r = await resoudreCibleFichier(e.cible!);
    const dossierId = r.cible?.entite === "DOSSIER" ? r.cible.id : r.cible ? (await cibler(r.cible.entite === "LEAD" ? { leadId: r.cible.id } : { clientId: r.cible.id })).ids?.dossierId : null;
    if (!dossierId) return { ...resultat, texte: `${resultat.texte}\nAucune photo retirée : pas de dossier.` };
    const retirees = await photosRetirees(dossierId);
    const suite = await rendreElements(retirees.length ? `Photos retirées (${retirees.length}) — « ranger_fichier » remettre: true pour en remettre une :` : "Aucune photo retirée.", retirees.slice(0, Math.max(0, IMAGES_MAX_PAR_RESULTAT - (resultat.images?.length ?? 0))), e, null, []);
    return { ...resultat, texte: `${resultat.texte}\n${suite.texte}`, images: [...(resultat.images ?? []), ...(suite.images ?? [])] };
  },
});

export const OUTILS_FICHIERS = [outilLienDepot, outilAjouterFichier, outilRangerFichier, outilVoirFichiers];
