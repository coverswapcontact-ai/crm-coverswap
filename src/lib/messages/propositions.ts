import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { CATEGORIES_CLIENT, LIBELLES_CATEGORIE_CLIENT, LIBELLES_SOURCE_CLIENT, SOURCES_CLIENT } from "@/lib/clients/constantes";
import { ficheVivante } from "@/lib/clients/fusion";
import { completerCoordonnees, creerClient, trouverClientParCoordonnees } from "@/lib/clients/identification";
import { nomAffichage } from "@/lib/clients/normalisation";
import { FORMATS_PHOTO } from "@/lib/dossiers/constants";
import { estJourValide } from "@/lib/dossiers/dates";
import { ecrireNote, ouvrirDossier, schemaCreation } from "@/lib/dossiers/dossiers";
import { archiverFichiersDossier, enregistrerPhoto, lireFichier } from "@/lib/dossiers/stockage";
import { mettreEnFile } from "@/lib/taches/file";
import { definirProposition } from "@/lib/validation/definitions";
import { CATEGORIES_HORS_CLIENTS, LIBELLES_CATEGORIE_MESSAGE } from "./constantes";
import { TYPE_TACHE_BOITE, TYPE_TACHE_PIECES, lireListe } from "./stockage";

/**
 * Propositions de tri d'un message, faites par l'agent (ou par la personne
 * depuis la file des messages : même circuit, elle en est l'autrice et la
 * décideuse). Aucune n'engage d'argent ni ne part chez un client ; seuls
 * l'archivage du bruit, le rattachement certain et le classement d'un envoi
 * hors clients peuvent s'exécuter sans validation, au-dessus du seuil de
 * confiance (src/lib/messages/regles.ts).
 */

const idMessage = z.string("Message manquant.").min(1, "Message manquant.").max(40);
const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((valeur) => valeur || null);

/** Statuts d'où un message peut encore être trié (pas encore rangé chez un client). */
const STATUTS_A_TRIER = ["A_ANALYSER", "A_TRIER", "IGNORE", "BRUIT"];

async function suitesDuTri(messageId: string): Promise<void> {
  // Import à la demande : l'analyse importe le service de validation (pas de cycle au chargement).
  const { apresRangement } = await import("./analyse");
  await apresRangement(messageId);
}

/** Dans la transaction du tri : remet le message dans la boîte s'il en avait été retiré comme bruit. */
async function remettreSiArchive(tx: Transaction, message: { id: string; canal: string; boiteArchiveLe: Date | null }): Promise<void> {
  if (message.canal === "EMAIL" && message.boiteArchiveLe) {
    await mettreEnFile({ type: TYPE_TACHE_BOITE, cle: `boite:${message.id}`, mode: "RECONCILIATION", charge: { messageId: message.id } }, tx);
  }
}

/**
 * Trace du message dans le dossier (« Mail reçu » ou « Mail envoyé »), une
 * seule fois : pas si le dossier en a déjà une (mail envoyé par le CRM, tri rejoué).
 */
export async function tracerDansDossier(tx: Transaction, messageId: string, dossierId: string, propositionId: string): Promise<void> {
  const message = await tx.message.findUnique({ where: { id: messageId }, include: { pieces: { orderBy: { rang: "asc" } } } });
  if (!message) return;
  const deja = await tx.dossierEvenement.findFirst({
    where: { dossierId, OR: [{ metadata: { contains: `"messageId":"${message.id}"` } }, { metadata: { contains: `"identifiant":"${message.identifiantCanal}"` } }] },
    select: { id: true },
  });
  if (deja) return;
  const pieces = message.pieces.filter((piece) => !piece.enLigne || piece.taille >= 50 * 1024);
  const objet = message.objet ? `« ${message.objet.slice(0, 160)} »` : "(sans objet)";
  const jointes = pieces.length ? ` — ${pieces.length} pièce${pieces.length > 1 ? "s" : ""} jointe${pieces.length > 1 ? "s" : ""}` : "";
  const entrant = message.sens === "ENTRANT";
  await tx.dossierEvenement.create({
    data: {
      dossierId,
      type: message.canal === "WHATSAPP" ? (entrant ? "WHATSAPP_RECU" : "WHATSAPP_ENVOYE") : entrant ? "MAIL_RECU" : "MAIL_ENVOYE",
      direction: entrant ? "ENTRANT" : "SORTANT",
      contenu: entrant ? `Mail de ${message.deNom ?? message.de} : ${objet}${jointes}` : `Mail envoyé depuis la boîte à ${lireListe(message.a).join(", ") || "?"} : ${objet}${jointes}`,
      metadata: JSON.stringify({ messageId: message.id, propositionId, pieces: pieces.map((piece) => ({ id: piece.id, nom: piece.nom })) }),
      createdAt: message.recuLe,
    },
  });
}

/* ── Rattacher un message à un client et à un dossier ─────────────── */

export const propositionRattacherMessage = definirProposition({
  type: "RATTACHER_MESSAGE",
  libelle: "Ranger un mail chez le client",
  schema: z.object({
    messageId: idMessage,
    clientId: z.string("Client manquant.").min(1, "Client manquant.").max(40),
    dossierId: z.string().max(40).nullable().transform((valeur) => valeur || null),
    /** Dossiers en cours entre lesquels choisir. */
    candidats: z.array(z.object({ id: z.string().max(40), objet: z.string().max(200) })).max(20).default([]),
  }),
  sensible: false,
  validationGroupee: true,
  automatisable: true,
  champs: (contenu) =>
    (contenu.candidats ?? []).length > 0
      ? [
          {
            cle: "dossierId",
            libelle: "Dossier",
            nature: "choix",
            aide: "Laisser vide pour ranger le mail sur la fiche du client seulement.",
            options: contenu.candidats.map((candidat) => ({ valeur: candidat.id, libelle: candidat.objet })),
          },
        ]
      : [],
  motifsRejet: [{ code: "PAS_CE_CLIENT", libelle: "Ce mail ne concerne pas ce client" }],
  execution: "IMMEDIATE",
  liens: (contenu) => [
    { libelle: "Lire le mail", href: `/messages?message=${contenu.messageId}` },
    { libelle: "Fiche client", href: `/clients/${contenu.clientId}` },
  ],
  async pertinente(contenu) {
    const message = await prisma.message.findUnique({ where: { id: contenu.messageId }, select: { statut: true, clientId: true, dossierId: true } });
    if (!message) return "le message n'existe plus";
    if (message.statut === "RATTACHE" && message.clientId === contenu.clientId && message.dossierId === contenu.dossierId) return "le mail est déjà rangé ainsi";
    return null;
  },
  async executer(contenu, { tx, decidePar, propositionId }) {
    if (!tx) throw new Error("RATTACHER_MESSAGE s'exécute dans la transaction de la validation");
    const message = await tx.message.findUnique({ where: { id: contenu.messageId } });
    if (!message) throw new ErreurMetier("Message introuvable.", 404);
    const client = await ficheVivante(contenu.clientId, tx);
    if (!client) throw new ErreurMetier("Fiche client introuvable.", 404);
    if (client.archiveLe) throw new ErreurMetier(`La fiche de ${client.nom} est archivée : la restaurer avant d'y ranger un mail.`, 409);
    if (contenu.dossierId) {
      const dossier = await tx.dossier.findUnique({ where: { id: contenu.dossierId }, select: { clientId: true, archiveLe: true } });
      if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
      if (dossier.clientId !== client.id) throw new ErreurMetier(`Ce dossier n'est pas celui de ${client.nom}.`, 409);
    }
    // Déplacé depuis un autre dossier : sa trace y est archivée, jamais effacée.
    if (message.dossierId && message.dossierId !== contenu.dossierId) {
      await tx.dossierEvenement.updateMany({
        where: { dossierId: message.dossierId, metadata: { contains: `"messageId":"${message.id}"` } },
        data: { archiveLe: new Date(), archiveMotif: "Mail rangé dans un autre dossier" },
      });
    }
    await tx.message.update({
      where: { id: message.id },
      data: {
        statut: "RATTACHE",
        categorie: message.categorie === "NOUVELLE_DEMANDE" ? message.categorie : "CLIENT",
        clientId: client.id,
        dossierId: contenu.dossierId,
        trieLe: new Date(),
        triePar: decidePar,
        bruitAnnuleLe: message.statut === "BRUIT" ? new Date() : message.bruitAnnuleLe,
      },
    });
    await remettreSiArchive(tx, message);
    if (contenu.dossierId) await tracerDansDossier(tx, message.id, contenu.dossierId, propositionId);
    return { resultat: { clientId: client.id, dossierId: contenu.dossierId }, apresValidation: () => suitesDuTri(message.id) };
  },
});

/* ── Nouvelle demande : fiche client (et dossier) prêts ────────────── */

const jourFacultatif = z
  .string()
  .nullable()
  .optional()
  .refine((valeur) => !valeur || estJourValide(valeur), "Date invalide.")
  .transform((valeur) => valeur || null);

export const propositionNouvelleDemande = definirProposition({
  type: "NOUVELLE_DEMANDE",
  libelle: "Nouvelle demande : fiche et dossier prêts",
  schema: z.object({
    messageId: idMessage,
    /** Client déjà connu (nouveau projet) ; sinon la fiche est créée. */
    clientId: z.string().max(40).nullable().optional().transform((valeur) => valeur || null),
    categorieClient: z.enum(CATEGORIES_CLIENT, "Catégorie de client invalide.").default("PARTICULIER"),
    prenom: texteFacultatif(80),
    nomFamille: texteFacultatif(80),
    raisonSociale: texteFacultatif(160),
    telephone: texteFacultatif(40),
    source: z.enum(SOURCES_CLIENT, "Provenance invalide.").default("INCONNUE"),
    ouvrirDossier: z.enum(["OUI", "NON"], "Indique s'il faut ouvrir le dossier."),
    objet: texteFacultatif(160),
    adresse: texteFacultatif(200),
    codePostal: texteFacultatif(10),
    ville: texteFacultatif(80),
    prochaineAction: texteFacultatif(140),
    prochaineActionDate: jourFacultatif,
    note: texteFacultatif(4000),
  }),
  sensible: false,
  validationGroupee: false,
  champs: [
    { cle: "prenom", libelle: "Prénom", nature: "texte" },
    { cle: "nomFamille", libelle: "Nom", nature: "texte" },
    { cle: "raisonSociale", libelle: "Raison sociale", nature: "texte", aide: "Pour un professionnel." },
    {
      cle: "categorieClient",
      libelle: "Catégorie",
      nature: "choix",
      options: CATEGORIES_CLIENT.map((categorie) => ({ valeur: categorie, libelle: LIBELLES_CATEGORIE_CLIENT[categorie] })),
    },
    { cle: "telephone", libelle: "Téléphone", nature: "texte" },
    {
      cle: "source",
      libelle: "D'où vient ce contact",
      nature: "choix",
      aide: "Ce que dit le mail (« vu votre publicité », « recommandé par… ») ; sinon Inconnue.",
      options: SOURCES_CLIENT.map((source) => ({ valeur: source, libelle: LIBELLES_SOURCE_CLIENT[source] })),
    },
    {
      cle: "ouvrirDossier",
      libelle: "Ouvrir le dossier",
      nature: "choix",
      obligatoire: true,
      aide: "Un dossier s'ouvre avec l'adresse du chantier, un téléphone et au moins une photo reçue.",
      options: [
        { valeur: "OUI", libelle: "Oui : fiche et dossier" },
        { valeur: "NON", libelle: "Non : la fiche seule, pour l'instant" },
      ],
    },
    { cle: "objet", libelle: "Objet du chantier", nature: "texte" },
    { cle: "adresse", libelle: "Adresse du chantier", nature: "texte" },
    { cle: "codePostal", libelle: "Code postal", nature: "texte" },
    { cle: "ville", libelle: "Ville", nature: "texte" },
    { cle: "prochaineAction", libelle: "Prochaine action", nature: "texte" },
    { cle: "prochaineActionDate", libelle: "Date de la prochaine action", nature: "jour" },
    { cle: "note", libelle: "Note au dossier", nature: "texteLong" },
  ],
  motifsRejet: [
    { code: "PAS_UNE_DEMANDE", libelle: "Ce n'est pas une demande de client" },
    { code: "CLIENT_EXISTANT", libelle: "Ce client existe déjà" },
  ],
  execution: "IMMEDIATE",
  liens: (contenu) => [{ libelle: "Lire le mail", href: `/messages?message=${contenu.messageId}` }],
  async pertinente(contenu) {
    const message = await prisma.message.findUnique({ where: { id: contenu.messageId }, select: { de: true, statut: true, dossierId: true } });
    if (!message) return "le message n'existe plus";
    if (message.statut === "RATTACHE" && message.dossierId) return "le mail est déjà rangé dans un dossier";
    if (!contenu.clientId) {
      const existant = await trouverClientParCoordonnees({ emails: [message.de] });
      if (existant) return `un client a déjà cette adresse (« ${existant.nom} ») : ranger le mail sur sa fiche`;
    }
    return null;
  },
  async executer(contenu, { tx, decidePar, propositionId }) {
    if (!tx) throw new Error("NOUVELLE_DEMANDE s'exécute dans la transaction de la validation");
    const message = await tx.message.findUnique({ where: { id: contenu.messageId }, include: { pieces: { orderBy: { rang: "asc" } } } });
    if (!message) throw new ErreurMetier("Message introuvable.", 404);
    if (message.statut === "RATTACHE" && message.dossierId) throw new ErreurMetier("Ce mail est déjà rangé dans un dossier.", 409);
    if (message.sens !== "ENTRANT") throw new ErreurMetier("Une nouvelle demande part d'un mail reçu.", 400);

    let clientId: string;
    let nomClient: string;
    if (contenu.clientId) {
      const client = await ficheVivante(contenu.clientId, tx);
      if (!client) throw new ErreurMetier("Fiche client introuvable.", 404);
      if (client.archiveLe) throw new ErreurMetier(`La fiche de ${client.nom} est archivée : la restaurer d'abord.`, 409);
      await completerCoordonnees(tx, client.id, { emails: [message.sens === "ENTRANT" ? message.de : null], telephones: [contenu.telephone] });
      clientId = client.id;
      nomClient = client.nom;
    } else {
      // Jamais de fusion implicite : une adresse ou un numéro déjà connus arrêtent tout.
      const existant = await trouverClientParCoordonnees({ emails: [message.de], telephones: [contenu.telephone] }, tx);
      if (existant) throw new ErreurMetier(`Un client a déjà cette adresse ou ce numéro : « ${existant.nom} ». Ranger le mail sur sa fiche plutôt.`, 409);
      if (!nomAffichage(contenu)) throw new ErreurMetier("Indique un nom ou une raison sociale.", 400);
      const cree = await creerClient(tx, {
        categorie: contenu.categorieClient,
        prenom: contenu.prenom,
        nomFamille: contenu.nomFamille,
        raisonSociale: contenu.raisonSociale,
        adresse: contenu.adresse,
        codePostal: contenu.codePostal,
        ville: contenu.ville,
        source: contenu.source,
        sourceDetail: "Premier contact par mail",
        premierContactLe: message.recuLe,
        emails: [message.de],
        telephones: [contenu.telephone],
      });
      clientId = cree.id;
      nomClient = cree.nom;
    }

    let dossierId: string | null = null;
    try {
      if (contenu.ouvrirDossier === "OUI") {
        const entree = analyser(schemaCreation, {
          clientNom: nomClient,
          clientAdresse: contenu.adresse ?? "",
          clientCp: contenu.codePostal ?? "",
          clientVille: contenu.ville ?? "",
          clientTelephone: contenu.telephone ?? "",
          clientEmail: message.de,
          objet: contenu.objet ?? "",
          source: "ENTRANT",
          montantEstime: null,
          prochaineAction: contenu.prochaineAction,
          prochaineActionDate: contenu.prochaineActionDate,
          leadId: null,
          prospectId: null,
          clientId,
        });
        const photos = message.pieces.filter((piece) => piece.statut === "CONSERVEE" && piece.fichierId && FORMATS_PHOTO[piece.typeMime]);
        if (photos.length === 0) {
          throw new ErreurMetier("Aucune photo reçue et conservée dans ce mail : un dossier s'ouvre avec au moins une photo. Choisir « Ouvrir le dossier : non » pour créer la fiche seule.", 400);
        }
        const dossier = await ouvrirDossier(tx, entree);
        dossierId = dossier.id;
        const chemins: string[] = [];
        for (const piece of photos) {
          const fichier = await tx.fichier.findUnique({ where: { id: piece.fichierId! }, select: { chemin: true } });
          const octets = fichier ? await lireFichier(fichier.chemin) : null;
          if (!octets) throw new ErreurMetier(`Photo « ${piece.nom} » absente du stockage.`, 409);
          chemins.push(await enregistrerPhoto(dossier.id, new File([new Uint8Array(octets)], piece.nom, { type: piece.typeMime })));
        }
        await tx.dossier.update({ where: { id: dossier.id }, data: { photos: JSON.stringify(chemins) } });
        if (contenu.note) await ecrireNote(tx, dossier.id, { etape: "QUALIFICATION", contenu: contenu.note });
      }

      await tx.message.update({
        where: { id: message.id },
        data: {
          statut: "RATTACHE",
          categorie: "NOUVELLE_DEMANDE",
          clientId,
          dossierId,
          trieLe: new Date(),
          triePar: decidePar,
          bruitAnnuleLe: message.statut === "BRUIT" ? new Date() : message.bruitAnnuleLe,
        },
      });
      await remettreSiArchive(tx, message);
      if (dossierId) await tracerDansDossier(tx, message.id, dossierId, propositionId);
    } catch (erreur) {
      // La transaction est annulée : les photos déjà copiées dans le dossier partent aux archives.
      if (dossierId) await archiverFichiersDossier(dossierId, "creation-interrompue").catch(() => {});
      throw erreur;
    }
    return { resultat: { clientId, dossierId }, apresValidation: () => suitesDuTri(message.id) };
  },
});

/* ── Archiver le bruit ─────────────────────────────────────────────── */

export const propositionArchiverMessage = definirProposition({
  type: "ARCHIVER_MESSAGE",
  libelle: "Archiver un mail sans intérêt",
  schema: z.object({
    messageId: idMessage,
    /** Ce qui fait penser à du bruit (règles ou modèle). */
    signaux: z.array(z.string().max(300)).max(10).default([]),
  }),
  sensible: false,
  validationGroupee: true,
  automatisable: true,
  motifsRejet: [{ code: "PAS_DU_BRUIT", libelle: "Ce n'est pas du bruit" }],
  execution: "IMMEDIATE",
  liens: (contenu) => [{ libelle: "Lire le mail", href: `/messages?message=${contenu.messageId}` }],
  async pertinente(contenu) {
    const message = await prisma.message.findUnique({ where: { id: contenu.messageId }, select: { statut: true } });
    if (!message) return "le message n'existe plus";
    return ["A_ANALYSER", "A_TRIER", "IGNORE"].includes(message.statut) ? null : "le mail a déjà été rangé";
  },
  async executer(contenu, { tx, decidePar }) {
    if (!tx) throw new Error("ARCHIVER_MESSAGE s'exécute dans la transaction de la validation");
    const message = await tx.message.findUnique({ where: { id: contenu.messageId }, select: { id: true, canal: true } });
    if (!message) throw new ErreurMetier("Message introuvable.", 404);
    const { count } = await tx.message.updateMany({
      where: { id: message.id, statut: { in: ["A_ANALYSER", "A_TRIER", "IGNORE"] } },
      data: { statut: "BRUIT", categorie: "BRUIT", trieLe: new Date(), triePar: decidePar },
    });
    if (count !== 1) throw new ErreurMetier("Ce mail a déjà été rangé : recharge la file.", 409);
    // Retiré de la boîte de réception par la file de tâches (jamais supprimé).
    if (message.canal === "EMAIL") {
      await mettreEnFile({ type: TYPE_TACHE_BOITE, cle: `boite:${message.id}`, mode: "RECONCILIATION", charge: { messageId: message.id } }, tx);
    }
    return { resultat: { archive: true } };
  },
});

/* ── Classer hors clients ──────────────────────────────────────────── */

export const propositionClasserMessage = definirProposition({
  type: "CLASSER_MESSAGE",
  libelle: "Classer un mail hors clients",
  schema: z.object({
    messageId: idMessage,
    categorie: z.enum(CATEGORIES_HORS_CLIENTS, "Classement invalide."),
  }),
  sensible: false,
  validationGroupee: true,
  automatisable: true,
  champs: [
    {
      cle: "categorie",
      libelle: "Classement",
      nature: "choix",
      obligatoire: true,
      options: CATEGORIES_HORS_CLIENTS.map((categorie) => ({ valeur: categorie, libelle: LIBELLES_CATEGORIE_MESSAGE[categorie] })),
    },
  ],
  execution: "IMMEDIATE",
  liens: (contenu) => [{ libelle: "Lire le mail", href: `/messages?message=${contenu.messageId}` }],
  async pertinente(contenu) {
    const message = await prisma.message.findUnique({ where: { id: contenu.messageId }, select: { statut: true } });
    if (!message) return "le message n'existe plus";
    return STATUTS_A_TRIER.includes(message.statut) ? null : "le mail est déjà rangé chez un client";
  },
  async executer(contenu, { tx, decidePar }) {
    if (!tx) throw new Error("CLASSER_MESSAGE s'exécute dans la transaction de la validation");
    const message = await tx.message.findUnique({ where: { id: contenu.messageId }, select: { id: true, canal: true, statut: true, boiteArchiveLe: true, bruitAnnuleLe: true } });
    if (!message) throw new ErreurMetier("Message introuvable.", 404);
    const { count } = await tx.message.updateMany({
      where: { id: message.id, statut: { in: STATUTS_A_TRIER } },
      data: {
        statut: "IGNORE",
        categorie: contenu.categorie,
        trieLe: new Date(),
        triePar: decidePar,
        bruitAnnuleLe: message.statut === "BRUIT" ? new Date() : message.bruitAnnuleLe,
      },
    });
    if (count !== 1) throw new ErreurMetier("Ce mail est déjà rangé chez un client : recharge la file.", 409);
    await remettreSiArchive(tx, message);
    return { resultat: { categorie: contenu.categorie } };
  },
});

/** Pièces d'un message à conserver dans le CRM (après un tri qui le rend utile). */
export async function demanderConservationPieces(messageId: string): Promise<void> {
  await mettreEnFile({ type: TYPE_TACHE_PIECES, cle: `pieces:${messageId}`, mode: "RECONCILIATION", charge: { messageId } });
}
