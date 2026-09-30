import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateCourte, euros } from "@/lib/commun/format";
import { deposerDocument, type EntreeDepotDocument } from "@/lib/dossiers/depot-document";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { idPhoto, lireFichier, lirePhotos } from "@/lib/dossiers/stockage";
import type { ChangementEtape } from "@/lib/dossiers/transitions";
import { remplacerJustificatif } from "@/lib/depenses/service";
import { ecrirePhotoAvecVersions } from "@/lib/fichiers/images";
import { enregistrerFichier, lireFichierConserve } from "@/lib/fichiers/stockage";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { modifierPublication } from "@/lib/site/publications";
import { preparerPhotoSite } from "@/lib/site/conversion-photo";
import { resolveUploadsDir } from "@/lib/uploads";
import { detecterFormat, estHeicOuHeif, MESSAGE_FORMAT_REFUSE, type FormatPermis } from "./format";
import { LIBELLES_ENTITE, LIBELLES_TYPE_FICHIER, OCTETS_MAX_FICHIER, type EntiteCible, type TypeFichier, type VoieFichier } from "./types";

/**
 * Mission 17 (partie C) — un fichier reçu, d'où qu'il vienne (lien de dépôt,
 * URL, base64, pièce de mail, fichier conservé), rangé au bon endroit selon sa
 * cible et son type, par LES MÊMES fonctions de service que les écrans :
 *
 * | Cible        | Type                          | Où il va                                                    |
 * |--------------|-------------------------------|-------------------------------------------------------------|
 * | DOSSIER      | PHOTO_AVANT, PHOTO_APRES      | Dossier.photos (`ajouterPhoto`) : proposée au simulateur     |
 * | DOSSIER      | DEVIS, FACTURE (numéro, montant) | document repris (`deposerDocument`, logique de deposer_document) |
 * | DOSSIER      | DEVIS, FACTURE sans numéro    | document conservé « à compléter » (ajouter_fichier le reprend) |
 * | DOSSIER      | PLAN, JUSTIFICATIF, AUTRE     | document conservé du dossier (`deposerDocument` AUTRE)       |
 * | LEAD         | photo                         | PhotoLead (recopiée dans le dossier à son ouverture)         |
 * | LEAD, CLIENT | document                      | Fichier conservé, rattaché ici (FichierDepose)               |
 * | DEPENSE      | JUSTIFICATIF                  | justificatif de la dépense (`remplacerJustificatif`)         |
 * | PUBLICATION  | PHOTO_AVANT, PHOTO_APRES      | photo du dossier de la réalisation, puis `modifierPublication` |
 * | (aucune)     | tout                          | boîte « À ranger » (Fichier conservé), classé par ranger_fichier |
 *
 * Chaque fichier reçu laisse une ligne FichierDepose : sa voie, son empreinte,
 * sa cible, et l'endroit exact où il vit — c'est elle que ranger_fichier
 * retire (archive), remet ou déplace. Rien ne se supprime.
 *
 * Le type est lu dans les octets (format.ts) ; une photo HEIC est convertie en
 * JPEG par le serveur (même conversion que le simulateur du site) pour que le
 * simulateur et Claude puissent la lire.
 */

export type CibleFichier = { entite: EntiteCible; id: string };
export type FichierEntrant = { contenu: Buffer; nom?: string | null };
export type FichierVerifie = { contenu: Buffer; nom: string; format: FormatPermis; avertissements: string[] };

/** Champs d'un devis ou d'une facture repris (ceux de deposer_document). */
export type ChampsDocument = Partial<Omit<EntreeDepotDocument, "type" | "source">>;

export type OptionsEnregistrement = {
  voie: VoieFichier;
  origine?: string | null;
  jetonId?: string | null;
  document?: ChampsDocument;
};

export type ResultatEnregistrement = {
  id: string;
  nom: string;
  typeMime: string;
  taille: number;
  type: TypeFichier | null;
  cible: { entite: EntiteCible; id: string; nom: string } | null;
  /** La phrase qui dit où il est allé (« photo avant ajoutée au dossier de … »). */
  destination: string;
  photoId: string | null;
  fichierId: string | null;
  documentId: string | null;
  numero: string | null;
  aCompleter: boolean;
  avertissements: string[];
  changements: ChangementEtape[];
};

const TYPES_PHOTO: readonly TypeFichier[] = ["PHOTO_AVANT", "PHOTO_APRES"];
const empreinte = (contenu: Buffer) => createHash("sha256").update(contenu).digest("hex");
const versFile = (f: { contenu: Buffer; nom: string; typeMime: string }) => new File([new Uint8Array(f.contenu)], f.nom, { type: f.typeMime });
const ko = (octets: number) => `${Math.max(1, Math.round(octets / 1024))} Ko`;

function nomPropre(nom: string | null | undefined, format: FormatPermis): string {
  const base = (nom ?? "").replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 150) || `fichier-${Date.now().toString(36)}`;
  const sansExtension = base.replace(/\.[a-z0-9]{1,5}$/i, "");
  return `${sansExtension}.${format.extension}`;
}

/**
 * Vérifie un fichier reçu : taille, format par ses octets. Une photo HEIC est convertie en JPEG (1 600 px) ; si la
 * conversion échoue, elle est gardée telle quelle, avec un avertissement (ni le simulateur ni Claude ne la liront).
 */
export async function verifierFichier(entrant: FichierEntrant): Promise<FichierVerifie> {
  if (entrant.contenu.length === 0) throw new ErreurMetier("Le fichier est vide.", 400);
  if (entrant.contenu.length > OCTETS_MAX_FICHIER) throw new ErreurMetier(`Fichier trop lourd : ${Math.round(OCTETS_MAX_FICHIER / 1024 / 1024)} Mo maximum.`, 413);
  const format = detecterFormat(entrant.contenu);
  if (!format) throw new ErreurMetier(MESSAGE_FORMAT_REFUSE, 415);
  if (!estHeicOuHeif(format.typeMime)) return { contenu: entrant.contenu, nom: nomPropre(entrant.nom, format), format, avertissements: [] };
  const preparee = await preparerPhotoSite(entrant.contenu, entrant.nom ?? "", format.typeMime);
  if (preparee.ok) {
    const jpeg: FormatPermis = { typeMime: "image/jpeg", extension: "jpg", image: true };
    return { contenu: Buffer.from(preparee.dataUrl.replace(/^data:image\/jpeg;base64,/, ""), "base64"), nom: nomPropre(entrant.nom, jpeg), format: jpeg, avertissements: [] };
  }
  return { contenu: entrant.contenu, nom: nomPropre(entrant.nom, format), format, avertissements: ["Photo HEIC gardée telle quelle (conversion impossible) : ni le simulateur ni l'assistant ne pourront la lire ; demande-la en JPEG si besoin."] };
}

/* ── Les cibles ────────────────────────────────────────────────── */

export type CibleLue = { entite: EntiteCible; id: string; nom: string; dossierId: string | null; publiee: boolean };

/** Lit la cible : existe-t-elle, comment l'appeler, quel dossier porte ses photos. */
export async function lireCible(cible: CibleFichier): Promise<CibleLue> {
  switch (cible.entite) {
    case "DOSSIER": {
      const d = await prisma.dossier.findUnique({ where: { id: cible.id }, select: { id: true, clientNom: true, objet: true, archiveLe: true } });
      if (!d || d.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
      return { entite: "DOSSIER", id: d.id, nom: `${d.clientNom}${d.objet ? ` (${d.objet})` : ""}`, dossierId: d.id, publiee: false };
    }
    case "LEAD": {
      const l = await prisma.lead.findUnique({ where: { id: cible.id }, select: { id: true, prenom: true, nom: true, archiveLe: true } });
      if (!l || l.archiveLe) throw new ErreurMetier("Lead introuvable ou archivé.", 404);
      return { entite: "LEAD", id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), dossierId: null, publiee: false };
    }
    case "CLIENT": {
      const c = await prisma.client.findUnique({ where: { id: cible.id }, select: { id: true, nom: true, archiveLe: true } });
      if (!c || c.archiveLe) throw new ErreurMetier("Client introuvable ou archivé.", 404);
      return { entite: "CLIENT", id: c.id, nom: c.nom, dossierId: null, publiee: false };
    }
    case "DEPENSE": {
      const d = await prisma.depense.findUnique({ where: { id: cible.id }, select: { id: true, fournisseur: true, montant: true, payeeLe: true, archiveLe: true } });
      if (!d || d.archiveLe) throw new ErreurMetier("Dépense introuvable ou retirée.", 404);
      return { entite: "DEPENSE", id: d.id, nom: `${d.fournisseur}, ${euros(d.montant)} du ${dateCourte(d.payeeLe)}`, dossierId: null, publiee: false };
    }
    case "PUBLICATION": {
      const p = await prisma.publicationSite.findUnique({ where: { id: cible.id }, select: { id: true, titre: true, dossierId: true, publieLe: true, retireLe: true, archiveLe: true } });
      if (!p || p.archiveLe) throw new ErreurMetier("Réalisation introuvable ou archivée.", 404);
      return { entite: "PUBLICATION", id: p.id, nom: `« ${p.titre} »`, dossierId: p.dossierId, publiee: Boolean(p.publieLe && !p.retireLe) };
    }
  }
}

/** Le type retenu pour un fichier sans type explicite, selon sa cible et son format. */
export function typeParDefaut(entite: EntiteCible | null, format: FormatPermis): TypeFichier {
  if (entite === "DEPENSE") return "JUSTIFICATIF";
  if (entite === "PUBLICATION") return "PHOTO_APRES";
  if (format.image && (entite === "DOSSIER" || entite === "LEAD")) return "PHOTO_AVANT";
  return "AUTRE";
}

/** Refuse ce qui n'a pas de sens (une photo après sur un lead, un PDF comme photo…), AVANT toute écriture. */
export function verifierCompatibilite(entite: EntiteCible | null, type: TypeFichier, format: FormatPermis, cible?: CibleLue): void {
  if (TYPES_PHOTO.includes(type) && !format.image) throw new ErreurMetier(`Une ${LIBELLES_TYPE_FICHIER[type]} doit être une image (JPEG, PNG, WebP, HEIC), pas un PDF.`, 400);
  if (entite === "LEAD" && type === "PHOTO_APRES") throw new ErreurMetier("Une photo après chantier va sur le dossier, pas sur le lead.", 400);
  if (entite === "DEPENSE" && type !== "JUSTIFICATIF") throw new ErreurMetier("Une dépense ne reçoit que son justificatif (type JUSTIFICATIF).", 400);
  if (entite === "PUBLICATION") {
    if (!TYPES_PHOTO.includes(type)) throw new ErreurMetier("Une réalisation du site reçoit une photo avant ou après (PHOTO_AVANT, PHOTO_APRES).", 400);
    if (cible && !cible.dossierId) throw new ErreurMetier("Cette réalisation n'est rattachée à aucun dossier : une photo publiée vient toujours d'un dossier. Rattache-la d'abord.", 409);
  }
}

/* ── Photos du dossier : ajout, retrait, remise ────────────────── */

async function cheminDeLaPhoto(dossierId: string, photoId: string): Promise<string> {
  const d = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
  const chemin = lirePhotos(d?.photos ?? "[]").find((c) => idPhoto(c) === photoId);
  if (!chemin) throw new ErreurMetier("Photo introuvable après son ajout.", 500);
  return chemin;
}

/** Retire un chemin de Dossier.photos sans toucher au fichier (il se remet). Optimiste, trois essais. */
async function retirerDuDossier(dossierId: string, chemin: string): Promise<void> {
  for (let essai = 0; essai < 3; essai++) {
    const d = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
    if (!d) throw new ErreurMetier("Dossier introuvable.", 404);
    const chemins = lirePhotos(d.photos);
    if (!chemins.includes(chemin)) return;
    const { count } = await prisma.dossier.updateMany({ where: { id: dossierId, photos: d.photos }, data: { photos: JSON.stringify(chemins.filter((c) => c !== chemin)) } });
    if (count === 1) return;
  }
  throw new ErreurMetier("Les photos du dossier ont changé entre-temps : réessaie.", 409);
}

async function remettreDansDossier(dossierId: string, chemin: string): Promise<void> {
  if (!(await lireFichier(chemin))) throw new ErreurMetier("Le fichier de cette photo n'est plus sur le serveur : elle ne peut pas être remise.", 404);
  for (let essai = 0; essai < 3; essai++) {
    const d = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
    if (!d) throw new ErreurMetier("Dossier introuvable.", 404);
    const chemins = lirePhotos(d.photos);
    if (chemins.includes(chemin)) return;
    const { count } = await prisma.dossier.updateMany({ where: { id: dossierId, photos: d.photos }, data: { photos: JSON.stringify([...chemins, chemin]) } });
    if (count === 1) return;
  }
  throw new ErreurMetier("Les photos du dossier ont changé entre-temps : réessaie.", 409);
}

/** Pose (ou efface) la photo avant / après d'une publication, par la fonction de service de l'écran Site. */
async function poserPhotoPublication(publicationId: string, quelle: "photoAvant" | "photoApres", chemin: string | null): Promise<void> {
  const p = await prisma.publicationSite.findUnique({ where: { id: publicationId } });
  if (!p) throw new ErreurMetier("Réalisation introuvable.", 404);
  await modifierPublication(publicationId, {
    type: p.type,
    titre: p.titre,
    texte: p.texte,
    ville: p.ville,
    typeProjet: p.typeProjet,
    note: p.note,
    auteur: p.auteur,
    dossierId: p.dossierId,
    clientId: p.clientId,
    photoAvant: quelle === "photoAvant" ? chemin : p.photoAvant,
    photoApres: quelle === "photoApres" ? chemin : p.photoApres,
    accordClientLe: p.accordClientLe?.toISOString() ?? null,
    ordre: p.ordre,
  });
}

/* ── Enregistrer ───────────────────────────────────────────────── */

/**
 * Enregistre un fichier reçu sur sa cible (null : « À ranger »). Le type absent se déduit (typeParDefaut). Rend
 * l'identifiant de la ligne FichierDepose et la phrase qui dit où le fichier est allé.
 */
export async function enregistrerFichierRecu(cible: CibleFichier | null, typeDemande: TypeFichier | null, entrant: FichierEntrant | FichierVerifie, options: OptionsEnregistrement): Promise<ResultatEnregistrement> {
  const fichier = "format" in entrant ? entrant : await verifierFichier(entrant);
  const lue = cible ? await lireCible(cible) : null;
  const type = typeDemande ?? typeParDefaut(cible?.entite ?? null, fichier.format);
  verifierCompatibilite(cible?.entite ?? null, type, fichier.format, lue ?? undefined);

  const avertissements = [...fichier.avertissements];
  const base = { jetonId: options.jetonId ?? null, voie: options.voie, origine: options.origine?.slice(0, 500) ?? null, nom: fichier.nom, typeMime: fichier.format.typeMime, taille: fichier.contenu.length, empreinte: empreinte(fichier.contenu), type, cibleEntite: lue?.entite ?? null, cibleId: lue?.id ?? null, cibleNom: lue?.nom ?? null };
  const resultat = (ligne: { id: string }, destination: string, extra: Partial<ResultatEnregistrement> = {}): ResultatEnregistrement => ({
    id: ligne.id,
    nom: fichier.nom,
    typeMime: fichier.format.typeMime,
    taille: fichier.contenu.length,
    type,
    cible: lue ? { entite: lue.entite, id: lue.id, nom: lue.nom } : null,
    destination,
    photoId: null,
    fichierId: null,
    documentId: null,
    numero: null,
    aCompleter: false,
    avertissements,
    changements: [],
    ...extra,
  });
  const fichierPourFile = { contenu: fichier.contenu, nom: fichier.nom, typeMime: fichier.format.typeMime };

  // Dépôt libre : la boîte « À ranger ».
  if (!lue) {
    const conserve = await enregistrerFichier("a-ranger", versFile(fichierPourFile));
    const ligne = await prisma.fichierDepose.create({ data: { ...base, fichierId: conserve.id } });
    return resultat(ligne, `${fichier.nom} (${ko(fichier.contenu.length)}) posé dans « À ranger »`, { fichierId: conserve.id });
  }

  switch (lue.entite) {
    case "DOSSIER": {
      if (TYPES_PHOTO.includes(type)) {
        const photo = await ajouterPhoto(lue.id, versFile(fichierPourFile), type === "PHOTO_APRES");
        const chemin = await cheminDeLaPhoto(lue.id, photo.id);
        const ligne = await prisma.fichierDepose.create({ data: { ...base, photoChemin: chemin } });
        return resultat(ligne, `${LIBELLES_TYPE_FICHIER[type]} ajoutée au dossier de ${lue.nom}${type === "PHOTO_AVANT" ? " (proposée au simulateur)" : ""}`, { photoId: photo.id });
      }
      const champs = options.document ?? {};
      const source = { contenu_base64: fichier.contenu.toString("base64"), nom: fichier.nom, type_mime: fichier.format.typeMime };
      if ((type === "DEVIS" || type === "FACTURE") && fichier.format.typeMime === "application/pdf" && champs.numero && champs.montant) {
        const depot = await deposerDocument(lue.id, { ...champs, type, source } as EntreeDepotDocument);
        if (depot.nature !== "DOCUMENT") throw new ErreurMetier("Dépôt inattendu.", 500);
        const ligne = await prisma.fichierDepose.create({ data: { ...base, documentId: depot.documentId } });
        avertissements.push(...depot.avertissements);
        return resultat(ligne, `${type === "DEVIS" ? "devis" : "facture"} ${depot.numero} rattaché${type === "FACTURE" ? "e" : ""} au dossier de ${lue.nom}`, { documentId: depot.documentId, numero: depot.numero, changements: depot.changements });
      }
      const aCompleter = (type === "DEVIS" || type === "FACTURE") && fichier.format.typeMime === "application/pdf";
      if ((type === "DEVIS" || type === "FACTURE") && !aCompleter) avertissements.push(`Un ${LIBELLES_TYPE_FICHIER[type]} se reprend en PDF : cette image est gardée comme simple document du dossier.`);
      const libelle = champs.libelle || (aCompleter ? `${type === "DEVIS" ? "Devis" : "Facture"} déposé${type === "FACTURE" ? "e" : ""}, à compléter (numéro, montant)` : `${LIBELLES_TYPE_FICHIER[type].charAt(0).toUpperCase()}${LIBELLES_TYPE_FICHIER[type].slice(1)} : ${fichier.nom}`);
      const depot = await deposerDocument(lue.id, { type: "AUTRE", libelle: libelle.slice(0, 80), source } as EntreeDepotDocument);
      if (depot.nature !== "FICHIER") throw new ErreurMetier("Dépôt inattendu.", 500);
      const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: lue.id, type: "DOCUMENT_DEPOSE", metadata: { contains: depot.fichierId } }, select: { id: true } });
      const ligne = await prisma.fichierDepose.create({ data: { ...base, fichierId: depot.fichierId, evenementId: evenement?.id ?? null, aCompleter } });
      return resultat(ligne, aCompleter ? `${LIBELLES_TYPE_FICHIER[type]} déposé sur le dossier de ${lue.nom}, à compléter (numéro et montant, par ajouter_fichier)` : `${LIBELLES_TYPE_FICHIER[type]} déposé sur le dossier de ${lue.nom}`, { fichierId: depot.fichierId, aCompleter });
    }
    case "LEAD": {
      if (fichier.format.image && type === "PHOTO_AVANT") {
        const chemin = path.posix.join(lue.id, "photos", `${randomUUID()}.${fichier.format.extension}`);
        await ecrirePhotoAvecVersions(path.resolve(resolveUploadsDir()), chemin, fichier.contenu, fichier.format.typeMime);
        const photo = await prisma.photoLead.create({ data: { leadId: lue.id, chemin, origine: "DEPOT_CRM" } });
        const ligne = await prisma.fichierDepose.create({ data: { ...base, photoLeadId: photo.id } });
        return resultat(ligne, `photo ajoutée au lead ${lue.nom} (recopiée dans son dossier à l'ouverture)`, { photoId: photo.id });
      }
      const conserve = await enregistrerFichier("leads", versFile(fichierPourFile));
      const ligne = await prisma.fichierDepose.create({ data: { ...base, fichierId: conserve.id } });
      return resultat(ligne, `${LIBELLES_TYPE_FICHIER[type]} rattaché au lead ${lue.nom}`, { fichierId: conserve.id });
    }
    case "CLIENT": {
      const conserve = await enregistrerFichier("clients", versFile(fichierPourFile));
      const ligne = await prisma.fichierDepose.create({ data: { ...base, fichierId: conserve.id } });
      return resultat(ligne, `${LIBELLES_TYPE_FICHIER[type]} rattaché à la fiche client ${lue.nom}`, { fichierId: conserve.id });
    }
    case "DEPENSE": {
      const avant = await prisma.depense.findUnique({ where: { id: lue.id }, select: { justificatifId: true } });
      await remplacerJustificatif(lue.id, versFile(fichierPourFile));
      const apres = await prisma.depense.findUnique({ where: { id: lue.id }, select: { justificatifId: true } });
      // L'ancien justificatif est parti aux archives (service des dépenses) : sa ligne de dépôt suit.
      if (avant?.justificatifId) await prisma.fichierDepose.updateMany({ where: { cibleEntite: "DEPENSE", cibleId: lue.id, fichierId: avant.justificatifId, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "Remplacé par un nouveau justificatif" } });
      const ligne = await prisma.fichierDepose.create({ data: { ...base, fichierId: apres?.justificatifId ?? null } });
      if (avant?.justificatifId) avertissements.push("L'ancien justificatif est remplacé (gardé aux archives).");
      return resultat(ligne, `justificatif posé sur la dépense ${lue.nom}`, { fichierId: apres?.justificatifId ?? null });
    }
    case "PUBLICATION": {
      const dossierId = lue.dossierId!;
      const photo = await ajouterPhoto(dossierId, versFile(fichierPourFile), type === "PHOTO_APRES");
      const chemin = await cheminDeLaPhoto(dossierId, photo.id);
      await poserPhotoPublication(lue.id, type === "PHOTO_APRES" ? "photoApres" : "photoAvant", chemin);
      const ligne = await prisma.fichierDepose.create({ data: { ...base, photoChemin: chemin } });
      return resultat(ligne, `${LIBELLES_TYPE_FICHIER[type]} de la réalisation ${lue.nom}${lue.publiee ? " (déjà publiée : visible sur coverswap.fr)" : ""}`, { photoId: photo.id });
    }
  }
}

/* ── Retirer, remettre, ranger ─────────────────────────────────── */

export type LigneDepot = NonNullable<Awaited<ReturnType<typeof prisma.fichierDepose.findUnique>>>;

export async function lireLigneDepot(id: string): Promise<LigneDepot> {
  const ligne = await prisma.fichierDepose.findUnique({ where: { id } });
  if (!ligne) throw new ErreurMetier(`Fichier déposé introuvable : ${id}.`, 404);
  return ligne;
}

/** Les octets d'un fichier déposé, là où il vit maintenant. */
export async function octetsDuDepot(ligne: LigneDepot): Promise<Buffer | null> {
  if (ligne.fichierId) return (await lireFichierConserve(ligne.fichierId).catch(() => null))?.contenu ?? null;
  if (ligne.photoChemin) return lireFichier(ligne.photoChemin);
  if (ligne.photoLeadId) {
    const p = await prisma.photoLead.findUnique({ where: { id: ligne.photoLeadId }, select: { chemin: true } });
    return p ? lireFichier(p.chemin) : null;
  }
  if (ligne.documentId) {
    const d = await prisma.document.findUnique({ where: { id: ligne.documentId }, select: { pdfPath: true } });
    return d?.pdfPath ? lireFichier(d.pdfPath) : null;
  }
  return null;
}

/** Retire un fichier de là où il est (il reste gardé ; « remettre » le replace). */
export async function retirerFichierDepose(id: string, motif: string): Promise<LigneDepot> {
  const ligne = await lireLigneDepot(id);
  if (ligne.archiveLe) throw new ErreurMetier("Ce fichier est déjà retiré.", 409);
  if (ligne.documentId) throw new ErreurMetier("Un devis ou une facture repris ne se retire pas ici : il s'annule (« annuler_document »).", 409);
  if (ligne.photoChemin && ligne.cibleEntite === "DOSSIER" && ligne.cibleId) await retirerDuDossier(ligne.cibleId, ligne.photoChemin);
  if (ligne.photoChemin && ligne.cibleEntite === "PUBLICATION" && ligne.cibleId) {
    const p = await prisma.publicationSite.findUnique({ where: { id: ligne.cibleId }, select: { photoAvant: true, photoApres: true, dossierId: true } });
    if (p?.photoAvant === ligne.photoChemin) await poserPhotoPublication(ligne.cibleId, "photoAvant", null);
    if (p?.photoApres === ligne.photoChemin) await poserPhotoPublication(ligne.cibleId, "photoApres", null);
    if (p?.dossierId) await retirerDuDossier(p.dossierId, ligne.photoChemin);
  }
  if (ligne.photoLeadId) await prisma.photoLead.updateMany({ where: { id: ligne.photoLeadId, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: motif.slice(0, 300) } });
  if (ligne.evenementId) await prisma.dossierEvenement.updateMany({ where: { id: ligne.evenementId, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: motif.slice(0, 300) } });
  if (ligne.cibleEntite === "DEPENSE" && ligne.cibleId && ligne.fichierId) await prisma.depense.updateMany({ where: { id: ligne.cibleId, justificatifId: ligne.fichierId }, data: { justificatifId: null } });
  return prisma.fichierDepose.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif.slice(0, 300) } });
}

/** Remet un fichier retiré à l'endroit exact d'où il avait été retiré. */
export async function remettreFichierDepose(id: string): Promise<LigneDepot> {
  const ligne = await lireLigneDepot(id);
  if (!ligne.archiveLe) throw new ErreurMetier("Ce fichier n'est pas retiré.", 409);
  if (ligne.rangeLe) throw new ErreurMetier("Ce fichier a été rangé ailleurs (voir sa nouvelle place avec voir_fichiers).", 409);
  if (/^Remplacé/.test(ligne.archiveMotif ?? "")) throw new ErreurMetier("Ce justificatif a été remplacé : dépose-le de nouveau pour le reprendre.", 409);
  if (ligne.photoChemin && ligne.cibleEntite === "DOSSIER" && ligne.cibleId) await remettreDansDossier(ligne.cibleId, ligne.photoChemin);
  if (ligne.photoChemin && ligne.cibleEntite === "PUBLICATION" && ligne.cibleId) {
    const p = await prisma.publicationSite.findUnique({ where: { id: ligne.cibleId }, select: { dossierId: true } });
    if (!p?.dossierId) throw new ErreurMetier("La réalisation n'a plus de dossier : la photo ne peut pas être remise.", 409);
    await remettreDansDossier(p.dossierId, ligne.photoChemin);
    await poserPhotoPublication(ligne.cibleId, ligne.type === "PHOTO_AVANT" ? "photoAvant" : "photoApres", ligne.photoChemin);
  }
  if (ligne.photoLeadId) await prisma.photoLead.updateMany({ where: { ...AVEC_ARCHIVES, id: ligne.photoLeadId }, data: { archiveLe: null, archiveMotif: null } });
  if (ligne.evenementId) await prisma.dossierEvenement.updateMany({ where: { ...AVEC_ARCHIVES, id: ligne.evenementId }, data: { archiveLe: null, archiveMotif: null } });
  if (ligne.cibleEntite === "DEPENSE" && ligne.cibleId && ligne.fichierId) {
    const { count } = await prisma.depense.updateMany({ where: { id: ligne.cibleId, justificatifId: null }, data: { justificatifId: ligne.fichierId } });
    if (count === 0) throw new ErreurMetier("La dépense a déjà un autre justificatif : retire-le d'abord.", 409);
  }
  return prisma.fichierDepose.update({ where: { id }, data: { archiveLe: null, archiveMotif: null } });
}

/**
 * Range un fichier : un fichier « À ranger » va sur sa cible ; un fichier déjà placé change de cible ou de type (il
 * est posé à sa nouvelle place, puis retiré de l'ancienne, gardé). Un devis « à compléter » devient un devis repris
 * quand `document` porte son numéro et son montant.
 */
export async function rangerFichierDepose(id: string, cible: CibleFichier, type: TypeFichier | null, document?: ChampsDocument): Promise<ResultatEnregistrement> {
  const ligne = await lireLigneDepot(id);
  if (ligne.archiveLe && !ligne.rangeLe) throw new ErreurMetier("Ce fichier est retiré : remets-le d'abord (remettre: true).", 409);
  if (ligne.rangeLe) throw new ErreurMetier("Ce fichier est déjà rangé ailleurs.", 409);
  if (ligne.documentId) throw new ErreurMetier("Un devis ou une facture repris ne se déplace pas : annule-le (« annuler_document ») et dépose-le de nouveau.", 409);
  const contenu = await octetsDuDepot(ligne);
  if (!contenu) throw new ErreurMetier("Le fichier n'est plus lisible sur le serveur.", 404);
  const nouveau = await enregistrerFichierRecu(cible, type ?? (ligne.type as TypeFichier | null), { contenu, nom: ligne.nom }, { voie: ligne.voie as VoieFichier, origine: ligne.origine, jetonId: ligne.jetonId, document });
  const motif = `Rangé : ${LIBELLES_ENTITE[cible.entite]} ${nouveau.cible?.nom ?? cible.id} (${nouveau.id})`;
  if (ligne.cibleEntite) await retirerFichierDepose(id, motif);
  else await prisma.fichierDepose.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif.slice(0, 300) } });
  await prisma.fichierDepose.update({ where: { id }, data: { rangeLe: new Date() } });
  return nouveau;
}

/**
 * Une photo déjà dans le CRM, pas passée par un dépôt (déposée par le client, jointe à sa demande) : elle reçoit sa
 * ligne FichierDepose (voie EXISTANT) pour être retirée et remise de la même façon.
 */
export async function ligneDePhotoExistante(photoId: string, dossierId?: string | null): Promise<LigneDepot> {
  const deja = await prisma.fichierDepose.findFirst({ where: { ...AVEC_ARCHIVES, OR: [{ photoLeadId: photoId }, { photoChemin: { contains: `/${photoId}.` } }], rangeLe: null }, orderBy: { createdAt: "desc" } });
  if (deja) return deja;
  const lead = await prisma.photoLead.findFirst({ where: { ...AVEC_ARCHIVES, id: photoId } });
  if (lead) {
    const contenu = await lireFichier(lead.chemin);
    return prisma.fichierDepose.create({ data: { voie: "EXISTANT", nom: path.posix.basename(lead.chemin), typeMime: contenu ? (detecterFormat(contenu)?.typeMime ?? "image/jpeg") : "image/jpeg", taille: contenu?.length ?? 0, empreinte: contenu ? empreinte(contenu) : "", type: "PHOTO_AVANT", cibleEntite: "LEAD", cibleId: lead.leadId, photoLeadId: lead.id } });
  }
  const dossier = dossierId
    ? await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, clientNom: true, photos: true } })
    : await prisma.dossier.findFirst({ where: { photos: { contains: `/${photoId}.` } }, select: { id: true, clientNom: true, photos: true } });
  const chemin = dossier ? lirePhotos(dossier.photos).find((c) => idPhoto(c) === photoId) : undefined;
  if (!dossier || !chemin) throw new ErreurMetier(`Photo introuvable : ${photoId}.`, 404);
  const contenu = await lireFichier(chemin);
  return prisma.fichierDepose.create({ data: { voie: "EXISTANT", nom: path.posix.basename(chemin), typeMime: contenu ? (detecterFormat(contenu)?.typeMime ?? "image/jpeg") : "image/jpeg", taille: contenu?.length ?? 0, empreinte: contenu ? empreinte(contenu) : "", type: chemin.includes("/photos-apres/") ? "PHOTO_APRES" : "PHOTO_AVANT", cibleEntite: "DOSSIER", cibleId: dossier.id, cibleNom: dossier.clientNom, photoChemin: chemin } });
}
