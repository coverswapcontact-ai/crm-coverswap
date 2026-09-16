import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { CATEGORIES_CLIENT, SOURCES_CLIENT } from "@/lib/clients/constantes";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { estJourValide } from "@/lib/dossiers/dates";
import { mettreEnFile } from "@/lib/taches/file";
import { proposer, rejeterProposition, validerProposition, vueProposition, type NouvelleProposition } from "@/lib/validation/service";
import type { PropositionVue } from "@/lib/validation/types";
import { CATEGORIES_HORS_CLIENTS, LIBELLES_CATEGORIE_MESSAGE, type CategorieHorsClients } from "./constantes";
import { demanderConservationPieces } from "./propositions";
import { TYPE_TACHE_ANALYSE, TYPE_TACHE_BOITE } from "./stockage";
import { objetSansPrefixes } from "./texte";

/**
 * Décisions de la personne depuis la file des messages. Chacune passe par le
 * même circuit que les propositions de l'agent : si l'agent avait proposé la
 * même chose, c'est sa proposition qui est validée (il est crédité) ; sinon
 * une proposition au nom de la personne est créée et validée. Les autres
 * propositions de tri de l'agent sur ce message sont alors rejetées, avec le
 * motif que la décision rend évident : la mesure de l'agent reste juste sans
 * rien demander de plus.
 */

const TYPES_TRI = ["RATTACHER_MESSAGE", "NOUVELLE_DEMANDE", "ARCHIVER_MESSAGE", "CLASSER_MESSAGE"];

/** « Administratif (banque, URSSAF…) » → « administratif (banque, URSSAF…) » : les sigles restent en capitales. */
const minusculeInitiale = (texte: string) => `${texte.charAt(0).toLowerCase()}${texte.slice(1)}`;
const TYPES_SUITES = ["NOTE_DOSSIER", "PROCHAINE_ACTION", "CHANGEMENT_ETAPE"];

async function messageExistant(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new ErreurMetier("Message introuvable.", 404);
  return message;
}

async function decider(messageId: string, nouvelle: NouvelleProposition, corrections: Record<string, unknown> | undefined, action: string): Promise<PropositionVue> {
  let { id } = await proposer(nouvelle);
  const existante = await prisma.proposition.findUnique({ where: { id } });
  if (existante && existante.statut !== "EN_ATTENTE") {
    // Déjà proposée puis rejetée ou expirée : la décision d'aujourd'hui est une nouvelle proposition.
    ({ id } = await proposer({ ...nouvelle, cleUnicite: undefined }));
  }
  const validee = await validerProposition(id, corrections);
  await ecarterConcurrentes(messageId, id, nouvelle.type, action);
  return validee;
}

async function ecarterConcurrentes(messageId: string, gardeeId: string, typeGarde: string, action: string): Promise<void> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { dossierId: true } });
  const enAttente = await prisma.proposition.findMany({
    where: { messageId, statut: "EN_ATTENTE", id: { not: gardeeId }, type: { in: [...TYPES_TRI, ...TYPES_SUITES] } },
  });
  for (const proposition of enAttente) {
    const vue = vueProposition(proposition);
    if (TYPES_SUITES.includes(proposition.type)) {
      // Suites d'un dossier : écartées seulement si le mail n'y est plus rangé.
      if (proposition.dossierId === message?.dossierId) continue;
    }
    const memeGeste = proposition.type === typeGarde && (typeGarde === "RATTACHER_MESSAGE" || TYPES_SUITES.includes(typeGarde));
    await rejeterProposition(proposition.id, {
      motif: memeGeste || TYPES_SUITES.includes(proposition.type) ? "MAUVAISE_CIBLE" : "INEXACT",
      commentaire: `Trié autrement depuis la file des messages : ${action}.`,
    }).catch((erreur) => console.error(`[messages] rejet de la proposition ${vue.id} :`, erreur));
  }
}

/* ── Ranger chez un client ─────────────────────────────────────────── */

export const schemaRattachement = z.object({
  clientId: z.string("Choisis le client.").min(1, "Choisis le client.").max(40),
  dossierId: z.string().max(40).nullable().optional().transform((valeur) => valeur || null),
});

export async function rattacherMessage(messageId: string, entree: z.output<typeof schemaRattachement>): Promise<PropositionVue> {
  const message = await messageExistant(messageId);
  const client = await prisma.client.findUnique({ where: { id: entree.clientId }, select: { nom: true } });
  if (!client) throw new ErreurMetier("Fiche client introuvable.", 404);
  const dossier = entree.dossierId ? await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { objet: true } }) : null;
  if (entree.dossierId && !dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  return decider(
    messageId,
    {
      type: "RATTACHER_MESSAGE",
      titre: dossier ? `Ranger le mail dans le dossier « ${dossier.objet} » de ${client.nom}` : `Ranger le mail sur la fiche de ${client.nom}`,
      contenu: { messageId, clientId: entree.clientId, dossierId: entree.dossierId, candidats: [] },
      cleUnicite: `message:${messageId}:rattacher:${entree.clientId}:${entree.dossierId ?? "fiche"}`,
      messageId,
      clientId: entree.clientId,
      dossierId: entree.dossierId ?? undefined,
      resume: message.objet ?? undefined,
    },
    undefined,
    dossier ? `rangé dans le dossier « ${dossier.objet} »` : `rangé sur la fiche de ${client.nom}`
  );
}

/* ── Nouvelle demande ──────────────────────────────────────────────── */

const texteFacultatif = (max: number) => z.string().trim().max(max).nullable().optional().transform((valeur) => valeur || null);

export const schemaNouvelleDemande = z.object({
  clientId: z.string().max(40).nullable().optional().transform((valeur) => valeur || null),
  categorieClient: z.enum(CATEGORIES_CLIENT).default("PARTICULIER"),
  prenom: texteFacultatif(80),
  nomFamille: texteFacultatif(80),
  raisonSociale: texteFacultatif(160),
  telephone: texteFacultatif(40),
  source: z.enum(SOURCES_CLIENT).default("INCONNUE"),
  ouvrirDossier: z.enum(["OUI", "NON"], "Indique s'il faut ouvrir le dossier."),
  objet: texteFacultatif(160),
  adresse: texteFacultatif(200),
  codePostal: texteFacultatif(10),
  ville: texteFacultatif(80),
  prochaineAction: texteFacultatif(140),
  prochaineActionDate: z
    .string()
    .nullable()
    .optional()
    .refine((valeur) => !valeur || estJourValide(valeur), "Date de prochaine action invalide.")
    .transform((valeur) => valeur || null),
  note: texteFacultatif(4000),
});

export async function creerNouvelleDemande(messageId: string, entree: z.output<typeof schemaNouvelleDemande>): Promise<PropositionVue> {
  const message = await messageExistant(messageId);
  const { clientId, ...champs } = entree;
  const nom = [entree.prenom, entree.nomFamille].filter(Boolean).join(" ") || entree.raisonSociale || message.deNom || message.de;
  // Le formulaire fait foi : appliqué tel quel (champs vidés compris) à la proposition de l'agent, s'il en a fait une.
  const corrections: Record<string, unknown> = { ...champs };
  return decider(
    messageId,
    {
      type: "NOUVELLE_DEMANDE",
      titre: `Nouvelle demande de ${nom} : ${entree.ouvrirDossier === "OUI" ? "fiche et dossier" : "fiche"}`,
      contenu: { messageId, clientId, ...champs },
      cleUnicite: `message:${messageId}:nouvelle-demande${clientId ? `:${clientId}` : ""}`,
      messageId,
      clientId: clientId ?? undefined,
    },
    corrections,
    entree.ouvrirDossier === "OUI" ? "nouvelle demande, dossier ouvert" : "nouvelle demande, fiche créée"
  );
}

/* ── Bruit, hors clients ───────────────────────────────────────────── */

export async function archiverMessage(messageId: string): Promise<PropositionVue> {
  const message = await messageExistant(messageId);
  return decider(
    messageId,
    {
      type: "ARCHIVER_MESSAGE",
      titre: `Archiver le mail « ${message.objet ?? "sans objet"} » de ${message.deNom ?? message.de}`,
      contenu: { messageId, signaux: [] },
      cleUnicite: `message:${messageId}:archiver`,
      messageId,
    },
    undefined,
    "archivé comme bruit"
  );
}

export async function classerMessage(messageId: string, categorie: CategorieHorsClients): Promise<PropositionVue> {
  if (!(CATEGORIES_HORS_CLIENTS as readonly string[]).includes(categorie)) throw new ErreurMetier("Classement invalide.", 400);
  const message = await messageExistant(messageId);
  return decider(
    messageId,
    {
      type: "CLASSER_MESSAGE",
      titre: `Classer le mail « ${message.objet ?? "sans objet"} » : ${minusculeInitiale(LIBELLES_CATEGORIE_MESSAGE[categorie])}`,
      contenu: { messageId, categorie },
      cleUnicite: `message:${messageId}:classer`,
      messageId,
    },
    { categorie },
    `classé « ${minusculeInitiale(LIBELLES_CATEGORIE_MESSAGE[categorie])} »`
  );
}

/** « Ce n'est pas du bruit » : le mail revient à trier et dans la boîte de réception. */
export async function annulerBruit(messageId: string): Promise<void> {
  const message = await messageExistant(messageId);
  if (message.statut !== "BRUIT") throw new ErreurMetier("Ce mail n'est pas rangé comme bruit.", 409);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.message.updateMany({
      where: { id: messageId, statut: "BRUIT" },
      data: { statut: "A_TRIER", categorie: null, bruitAnnuleLe: new Date(), trieLe: new Date() },
    });
    if (count !== 1) throw new ErreurMetier("Ce mail vient d'être rangé ailleurs : recharge la file.", 409);
    if (message.canal === "EMAIL") {
      await mettreEnFile({ type: TYPE_TACHE_BOITE, cle: `boite:${messageId}`, mode: "RECONCILIATION", charge: { messageId } }, tx);
    }
  });
  await demanderConservationPieces(messageId);
}

/** Nouvelle lecture par l'IA, demandée par la personne (coût d'un appel). */
export async function demanderRelecture(messageId: string): Promise<void> {
  const message = await messageExistant(messageId);
  if (message.statut === "A_ANALYSER") throw new ErreurMetier("L'analyse de ce mail est déjà en cours.", 409);
  if (message.sens !== "ENTRANT") throw new ErreurMetier("Seul un mail reçu se relit.", 400);
  await mettreEnFile({ type: TYPE_TACHE_ANALYSE, cle: `relecture:${messageId}`, mode: "RECONCILIATION", charge: { messageId, relire: true } });
}

/* ── Répondre ──────────────────────────────────────────────────────── */

export const schemaReponse = z.object({
  objet: z.string("Objet manquant.").trim().min(1, "Objet manquant.").max(200, "Objet trop long."),
  texte: z.string("Message vide.").trim().min(1, "Message vide.").max(10_000, "Message trop long."),
});

export async function brouillonReponse(messageId: string): Promise<{ a: string; objet: string; texte: string; propositionId: string | null }> {
  const message = await messageExistant(messageId);
  const proposee = await prisma.proposition.findFirst({ where: { messageId, type: "ENVOI_MAIL", statut: "EN_ATTENTE" }, orderBy: { createdAt: "desc" } });
  if (proposee) {
    const contenu = vueProposition(proposee).contenu as { a?: string; objet?: string; texte?: string };
    return { a: contenu.a ?? message.de, objet: contenu.objet ?? "", texte: contenu.texte ?? "", propositionId: proposee.id };
  }
  const client = message.clientId ? await prisma.client.findUnique({ where: { id: message.clientId }, select: { prenom: true } }) : null;
  return {
    a: message.de,
    objet: `Re: ${objetSansPrefixes(message.objet) || "votre message"}`.slice(0, 200),
    texte: `${client?.prenom ? `Bonjour ${client.prenom},` : "Bonjour,"}\n\n\n\nBien cordialement,\n\nLucas Villemin\nCoverSwap\n${EMETTEUR.telephone}`,
    propositionId: null,
  };
}

export async function repondreAuMessage(messageId: string, entree: z.output<typeof schemaReponse>): Promise<PropositionVue> {
  const message = await messageExistant(messageId);
  if (message.sens !== "ENTRANT") throw new ErreurMetier("On répond à un mail reçu.", 400);
  const nouvelle: NouvelleProposition = {
    type: "ENVOI_MAIL",
    titre: `Répondre à ${message.deNom ?? message.de} : « ${entree.objet} »`,
    contenu: {
      motif: "REPONSE",
      dossierId: message.dossierId,
      clientId: message.clientId,
      a: message.de,
      objet: entree.objet,
      texte: entree.texte,
      documentIds: [],
      enReponseA: messageId,
    },
    cleUnicite: `message:${messageId}:reponse`,
    messageId,
    clientId: message.clientId ?? undefined,
    dossierId: message.dossierId ?? undefined,
  };
  let { id } = await proposer(nouvelle);
  const existante = await prisma.proposition.findUnique({ where: { id } });
  if (!existante || existante.statut !== "EN_ATTENTE") ({ id } = await proposer({ ...nouvelle, cleUnicite: undefined }));
  // Le texte de la personne est celui qui part (correction du brouillon de l'agent, le cas échéant).
  return validerProposition(id, { objet: entree.objet, texte: entree.texte });
}
