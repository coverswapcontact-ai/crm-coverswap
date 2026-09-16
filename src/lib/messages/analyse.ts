import prisma from "@/lib/prisma";
import { ficheVivante } from "@/lib/clients/fusion";
import { LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE } from "@/lib/dossiers/constants";
import { IaIndisponible, appelerModele, etatIa } from "@/lib/ia/modele";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { executerSansValidation, proposer, type NouvelleProposition } from "@/lib/validation/service";
import {
  CONFIANCE_PAR_CERTITUDE,
  CONSIGNES_LECTURE,
  OUTIL_LECTURE,
  SCHEMA_OUTIL_LECTURE,
  VERSION_LECTURE,
  construireLecture,
  schemaSortieLecture,
  verifierLecture,
  type SortieLecture,
  type Verification,
} from "./ia-lecture";
import { demanderConservationPieces } from "./propositions";
import { SEUIL_AUTOMATIQUE, trierParRegles, type ClientReconnu, type DecisionTri } from "./regles";
import { conserverPieces, lireEntetes, lireListe } from "./stockage";
import { estAdresseAutomatique, objetSansPrefixes, retirerCitations } from "./texte";

/**
 * L'agent mail : pour chaque message relevé, le tri par les règles sûres
 * (src/lib/messages/regles.ts), la conservation des pièces jointes, puis, si
 * l'IA est active, la lecture du mail par le modèle, qui devient des
 * propositions. Tout ce que l'agent fait ou propose est gardé
 * (`AnalyseMessage`), avec ses raisons.
 */

export const ACTEUR_AGENT_MAIL = "AGENT:mail";
const JOUR_MS = 24 * 60 * 60_000;
const ETAPES_CLOSES = ["ENCAISSE", "PERDU"];

type MessageComplet = NonNullable<Awaited<ReturnType<typeof chargerMessage>>>;

function chargerMessage(id: string) {
  return prisma.message.findUnique({ where: { id }, include: { contenu: true, pieces: { orderBy: { rang: "asc" } } } });
}

const objetCourt = (objet: string | null) => (objet ? `« ${objet.length > 70 ? `${objet.slice(0, 69)}…` : objet} »` : "sans objet");

/** Clients dont une adresse est exactement l'une de celles-ci (fiches fusionnées suivies jusqu'à la fiche vivante). */
async function clientsParAdresses(adresses: string[]): Promise<ClientReconnu[]> {
  const normalisees = [...new Set(adresses.map((adresse) => adresse.trim().toLowerCase()).filter(Boolean))];
  if (normalisees.length === 0) return [];
  const lignes = await prisma.clientEmail.findMany({ where: { adresse: { in: normalisees } }, select: { clientId: true } });
  const clients = new Map<string, ClientReconnu>();
  for (const { clientId } of lignes) {
    const fiche = await ficheVivante(clientId);
    if (!fiche || clients.has(fiche.id)) continue;
    const dossiers = await prisma.dossier.findMany({
      where: { clientId: fiche.id, etape: { notIn: ETAPES_CLOSES } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, objet: true },
    });
    clients.set(fiche.id, { id: fiche.id, nom: fiche.nom, archive: fiche.archiveLe !== null, dossiersEnCours: dossiers });
  }
  return [...clients.values()];
}

async function contexteDuFil(message: MessageComplet) {
  const autres = message.filCanal
    ? await prisma.message.findMany({
        where: { canal: message.canal, filCanal: message.filCanal, id: { not: message.id } },
        orderBy: { recuLe: "asc" },
        take: 30,
        select: { statut: true, sens: true, de: true, extrait: true, recuLe: true, clientId: true, dossierId: true },
      })
    : [];
  const ranges = autres.filter((autre) => autre.statut === "RATTACHE");
  return {
    dossierIds: [...new Set(ranges.map((autre) => autre.dossierId).filter((id): id is string => Boolean(id)))],
    clientIds: [...new Set(ranges.map((autre) => autre.clientId).filter((id): id is string => Boolean(id)))],
    reponduParNous: autres.some((autre) => autre.sens === "SORTANT"),
    precedents: autres.slice(-5),
  };
}

function base(message: MessageComplet, nouvelle: Omit<NouvelleProposition, "messageId">): NouvelleProposition {
  return { ...nouvelle, messageId: message.id };
}

/* ── Tri par les règles ───────────────────────────────────────────── */

type Fait = { type: string; id: string; execution: string };

async function appliquerDecision(message: MessageComplet, decision: DecisionTri): Promise<Fait[]> {
  const faits: Fait[] = [];
  const expediteur = message.deNom ?? message.de;

  if (decision.action === "ARCHIVER_BRUIT") {
    const nouvelle = base(message, {
      type: "ARCHIVER_MESSAGE",
      titre: `Archiver le mail ${objetCourt(message.objet)} de ${expediteur}`,
      resume: message.extrait ?? undefined,
      raisonnement: decision.raison,
      confiance: decision.confiance,
      contenu: { messageId: message.id, signaux: decision.signaux.map((signal) => signal.libelle) },
      cleUnicite: `message:${message.id}:archiver`,
    });
    if (decision.automatique) {
      const { id, execution } = await executerSansValidation({ ...nouvelle, confiance: decision.confiance }, SEUIL_AUTOMATIQUE);
      faits.push({ type: nouvelle.type, id, execution });
      if (execution !== "AUTOMATIQUE") await passerATrier(message.id);
    } else {
      const { id } = await proposer(nouvelle);
      faits.push({ type: nouvelle.type, id, execution: "PROPOSEE" });
      await passerATrier(message.id);
    }
    return faits;
  }

  if (decision.action === "RATTACHER") {
    const client = await prisma.client.findUnique({ where: { id: decision.clientId }, select: { nom: true } });
    const dossier = decision.dossierId ? await prisma.dossier.findUnique({ where: { id: decision.dossierId }, select: { objet: true } }) : null;
    const nouvelle = base(message, {
      type: "RATTACHER_MESSAGE",
      titre: dossier
        ? `Ranger le mail ${objetCourt(message.objet)} dans le dossier « ${dossier.objet} » de ${client?.nom ?? "ce client"}`
        : `Ranger le mail ${objetCourt(message.objet)} sur la fiche de ${client?.nom ?? "ce client"}`,
      resume: message.extrait ?? undefined,
      raisonnement: decision.raison,
      confiance: decision.confiance,
      contenu: { messageId: message.id, clientId: decision.clientId, dossierId: decision.dossierId, candidats: [] },
      cleUnicite: `message:${message.id}:rattacher:${decision.clientId}:${decision.dossierId ?? "fiche"}`,
      clientId: decision.clientId,
      dossierId: decision.dossierId ?? undefined,
    });
    const { id, execution } = decision.automatique
      ? await executerSansValidation({ ...nouvelle, confiance: decision.confiance }, SEUIL_AUTOMATIQUE)
      : { ...(await proposer(nouvelle)), execution: "PROPOSEE" };
    faits.push({ type: nouvelle.type, id, execution });
    if (execution !== "AUTOMATIQUE") await passerATrier(message.id);
    return faits;
  }

  if (decision.action === "CLASSER") {
    const nouvelle = base(message, {
      type: "CLASSER_MESSAGE",
      titre: `Classer hors clients le mail ${objetCourt(message.objet)}`,
      raisonnement: decision.raison,
      confiance: decision.confiance,
      contenu: { messageId: message.id, categorie: decision.categorie },
      cleUnicite: `message:${message.id}:classer`,
    });
    const { id, execution } = decision.automatique
      ? await executerSansValidation({ ...nouvelle, confiance: decision.confiance }, SEUIL_AUTOMATIQUE)
      : { ...(await proposer(nouvelle)), execution: "PROPOSEE" };
    faits.push({ type: nouvelle.type, id, execution });
    if (execution !== "AUTOMATIQUE") await passerATrier(message.id);
    return faits;
  }

  await passerATrier(message.id);
  if (decision.suggestion) {
    const suggestion = decision.suggestion;
    const client = await prisma.client.findUnique({ where: { id: suggestion.clientId }, select: { nom: true } });
    const { id } = await proposer(
      base(message, {
        type: "RATTACHER_MESSAGE",
        titre: `Ranger le mail ${objetCourt(message.objet)} de ${expediteur} chez ${client?.nom ?? "ce client"}`,
        resume: message.extrait ?? undefined,
        raisonnement: suggestion.raison,
        confiance: suggestion.confiance,
        contenu: { messageId: message.id, clientId: suggestion.clientId, dossierId: suggestion.dossierId, candidats: [] },
        cleUnicite: `message:${message.id}:rattacher:${suggestion.clientId}:${suggestion.dossierId ?? "fiche"}`,
        clientId: suggestion.clientId,
        dossierId: suggestion.dossierId ?? undefined,
      })
    );
    faits.push({ type: "RATTACHER_MESSAGE", id, execution: "PROPOSEE" });
  }
  return faits;
}

async function passerATrier(messageId: string): Promise<void> {
  await prisma.message.updateMany({ where: { id: messageId, statut: "A_ANALYSER" }, data: { statut: "A_TRIER" } });
}

function categorieDe(decision: DecisionTri): string | null {
  switch (decision.action) {
    case "ARCHIVER_BRUIT":
      return "BRUIT";
    case "RATTACHER":
      return "CLIENT";
    case "CLASSER":
      return decision.categorie;
    default:
      return null;
  }
}

/* ── Choix du dossier quand le client en a plusieurs en cours ─────── */

async function proposerChoixDossier(message: MessageComplet, clientId: string, dossierChoisi: string | null, raison: string, confiance: number): Promise<Fait | null> {
  const candidats = await prisma.dossier.findMany({
    where: { clientId, etape: { notIn: ETAPES_CLOSES } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, objet: true },
  });
  if (candidats.length < 2) return null;
  const choisi = candidats.find((candidat) => candidat.id === dossierChoisi) ?? candidats[0];
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { nom: true } });
  const { id } = await proposer(
    base(message, {
      type: "RATTACHER_MESSAGE",
      titre: `Ranger le mail ${objetCourt(message.objet)} dans le dossier « ${choisi.objet} » de ${client?.nom ?? "ce client"}`,
      resume: message.extrait ?? undefined,
      raisonnement: choisi.id === dossierChoisi ? raison : `${raison} Dossier proposé par défaut : le plus récemment actif ; « Corriger » pour en choisir un autre.`,
      confiance: choisi.id === dossierChoisi ? confiance : 0.5,
      contenu: { messageId: message.id, clientId, dossierId: choisi.id, candidats },
      cleUnicite: `message:${message.id}:rattacher:${clientId}:${choisi.id}`,
      clientId,
      dossierId: choisi.id,
    })
  );
  return { type: "RATTACHER_MESSAGE", id, execution: "PROPOSEE" };
}

/* ── Lecture par le modèle ─────────────────────────────────────────── */

function texteUtile(message: MessageComplet): string {
  return retirerCitations(message.contenu?.texte ?? message.extrait ?? "");
}

async function enregistrerAnalyseModele(messageId: string, donnees: { categorie?: string | null; confiance?: number | null; raisonnement?: string | null; resultat?: unknown; erreur?: string | null; appelIaId?: string | null }) {
  await prisma.analyseMessage.create({
    data: {
      messageId,
      methode: "MODELE",
      categorie: donnees.categorie ?? null,
      confiance: donnees.confiance ?? null,
      raisonnement: donnees.raisonnement ?? null,
      resultat: JSON.stringify({ version: VERSION_LECTURE, ...((donnees.resultat as object | undefined) ?? {}) }),
      erreur: donnees.erreur ?? null,
      appelIaId: donnees.appelIaId ?? null,
    },
  });
}

async function lireAvecModele(message: MessageComplet, maintenant: Date, signal?: AbortSignal): Promise<{ lu: boolean; raison: string | null }> {
  const ia = await etatIa(maintenant);
  if (!ia.active) {
    // Réglée mais indisponible (pause, budget) : dit sur le message. Non réglée : rien à signaler.
    if (ia.cleApi && ia.manquants.length === 0) await enregistrerAnalyseModele(message.id, { erreur: `Pas lu par l'IA : ${ia.raison}` });
    return { lu: false, raison: ia.raison };
  }

  const clients = message.clientId ? [await ficheVivante(message.clientId)].filter((client) => client !== null) : [];
  const client = clients[0] ?? null;
  const dossiers = client
    ? await prisma.dossier.findMany({
        where: { clientId: client.id, etape: { notIn: ETAPES_CLOSES } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, objet: true, etape: true, createdAt: true, prochaineAction: true },
      })
    : [];
  const fil = await contexteDuFil(message);
  const texteLu = texteUtile(message);
  const lecture = construireLecture({
    maintenant,
    message: { de: message.de, deNom: message.deNom, objet: message.objet, recuLe: message.recuLe, texteUtile: texteLu, pieces: message.pieces },
    client: client ? { nom: client.nom } : null,
    dossiers,
    fil: fil.precedents,
  });

  let appel: Awaited<ReturnType<typeof appelerModele>>;
  try {
    appel = await appelerModele({ usage: "ANALYSE_MESSAGE", systeme: CONSIGNES_LECTURE, message: lecture, outil: { nom: OUTIL_LECTURE, description: "Lecture structurée d'un mail reçu.", schema: SCHEMA_OUTIL_LECTURE }, jetonsSortieMax: 1500, signal });
  } catch (erreur) {
    const raison = erreur instanceof IaIndisponible ? erreur.message : `Lecture par l'IA en échec : ${(erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500)}`;
    await enregistrerAnalyseModele(message.id, { erreur: raison });
    return { lu: false, raison };
  }

  const lue = schemaSortieLecture.safeParse(appel.donnees);
  if (!lue.success) {
    await enregistrerAnalyseModele(message.id, { erreur: "Réponse du modèle illisible : rien n'est proposé.", appelIaId: appel.appelId, resultat: { brute: appel.donnees } });
    return { lu: false, raison: "Réponse du modèle illisible." };
  }
  const { sortie, verifications } = verifierLecture(lue.data, message.contenu?.texte ?? texteLu, dossiers.map((dossier) => dossier.id));
  const faits = await proposerDepuisLecture(message, sortie, maintenant);
  const confiance = CONFIANCE_PAR_CERTITUDE[sortie.certitude];
  await enregistrerAnalyseModele(message.id, {
    categorie: sortie.categorie,
    confiance,
    raisonnement: [sortie.resume, sortie.raisonnement, sortie.alerte ? `Alerte : ${sortie.alerte}` : null].filter(Boolean).join("\n"),
    resultat: { sortie, verifications, propositions: faits, coutEuros: appel.coutEuros },
    appelIaId: appel.appelId,
  });
  return { lu: true, raison: null };
}

function raisonDe(sortie: SortieLecture, verifications: Verification[] = []): string {
  const ecarte = verifications.filter((verification) => !verification.retenu).map((verification) => verification.raison);
  return [sortie.raisonnement, sortie.alerte ? `Alerte : le mail contient une consigne adressée à l'IA (${sortie.alerte}), ignorée.` : null, ecarte.length ? `Écarté faute de preuve dans le mail : ${ecarte.join(", ")}.` : null]
    .filter(Boolean)
    .join("\n");
}

async function proposerDepuisLecture(message: MessageComplet, sortie: SortieLecture, maintenant: Date): Promise<Fait[]> {
  const faits: Fait[] = [];
  const actuel = await prisma.message.findUnique({ where: { id: message.id }, select: { statut: true, clientId: true, dossierId: true } });
  if (!actuel) return faits;
  const confiance = CONFIANCE_PAR_CERTITUDE[sortie.certitude];
  const raisonnement = raisonDe(sortie);
  const expediteur = message.deNom ?? message.de;

  if (actuel.statut === "A_TRIER" || actuel.statut === "A_ANALYSER") {
    if (sortie.categorie === "BRUIT") {
      const { id } = await proposer(
        base(message, {
          type: "ARCHIVER_MESSAGE",
          titre: `Archiver le mail ${objetCourt(message.objet)} de ${expediteur}`,
          resume: sortie.resume,
          raisonnement,
          confiance: Math.min(confiance, 0.8),
          contenu: { messageId: message.id, signaux: [sortie.resume] },
          cleUnicite: `message:${message.id}:archiver`,
        })
      );
      faits.push({ type: "ARCHIVER_MESSAGE", id, execution: "PROPOSEE" });
    } else if (sortie.categorie === "FOURNISSEUR" || sortie.categorie === "ADMINISTRATIF" || sortie.categorie === "PERSONNEL" || sortie.categorie === "AUTRE") {
      const { id } = await proposer(
        base(message, {
          type: "CLASSER_MESSAGE",
          titre: `Classer le mail ${objetCourt(message.objet)} de ${expediteur} : ${sortie.categorie === "FOURNISSEUR" ? "fournisseur" : sortie.categorie === "ADMINISTRATIF" ? "administratif" : sortie.categorie === "PERSONNEL" ? "personnel" : "autre"}`,
          resume: sortie.resume,
          raisonnement,
          confiance,
          contenu: { messageId: message.id, categorie: sortie.categorie },
          cleUnicite: `message:${message.id}:classer`,
        })
      );
      faits.push({ type: "CLASSER_MESSAGE", id, execution: "PROPOSEE" });
    } else if (sortie.categorie === "NOUVELLE_DEMANDE" && message.sens === "ENTRANT") {
      faits.push(await proposerNouvelleDemande(message, sortie, null, raisonnement, confiance));
    }
  } else if (actuel.statut === "RATTACHE" && actuel.clientId && !actuel.dossierId) {
    const enCours = await prisma.dossier.count({ where: { clientId: actuel.clientId, etape: { notIn: ETAPES_CLOSES } } });
    if (enCours >= 2) {
      const fait = await proposerChoixDossier(message, actuel.clientId, sortie.dossierId, raisonnement, confiance);
      if (fait) faits.push(fait);
    } else if (enCours === 0 && (sortie.categorie === "NOUVELLE_DEMANDE" || sortie.projet) && message.sens === "ENTRANT") {
      faits.push(await proposerNouvelleDemande(message, sortie, actuel.clientId, raisonnement, confiance));
    }
  }

  // Suites portées par un dossier : proposées dès que le dossier est connu (sinon, après le rangement).
  if (actuel.dossierId) faits.push(...(await proposerSuites(message, sortie, actuel.dossierId, actuel.clientId, maintenant)));

  if (sortie.reponse && message.sens === "ENTRANT" && !estAdresseAutomatique(message.de)) {
    const { id } = await proposer(
      base(message, {
        type: "ENVOI_MAIL",
        titre: `Répondre à ${expediteur} : ${objetCourt(message.objet)}`,
        resume: sortie.resume,
        raisonnement,
        confiance,
        contenu: {
          motif: "REPONSE",
          dossierId: actuel.dossierId,
          clientId: actuel.clientId,
          a: message.de,
          objet: `Re: ${objetSansPrefixes(message.objet) || "votre message"}`.slice(0, 200),
          texte: sortie.reponse.texte,
          documentIds: [],
          enReponseA: message.id,
        },
        cleUnicite: `message:${message.id}:reponse`,
        clientId: actuel.clientId ?? undefined,
        dossierId: actuel.dossierId ?? undefined,
        expireLe: new Date(maintenant.getTime() + 14 * JOUR_MS),
      })
    );
    faits.push({ type: "ENVOI_MAIL", id, execution: "PROPOSEE" });
  }
  return faits;
}

async function proposerNouvelleDemande(message: MessageComplet, sortie: SortieLecture, clientId: string | null, raisonnement: string, confiance: number): Promise<Fait> {
  const contact = sortie.contact;
  const photos = message.pieces.filter((piece) => piece.statut === "CONSERVEE" && piece.typeMime.startsWith("image/")).length;
  const complet = Boolean(contact?.adresse && contact.codePostal && contact.ville && contact.telephone && sortie.projet?.objet && photos > 0);
  const manque = [
    !contact?.adresse || !contact.codePostal || !contact.ville ? "adresse du chantier" : null,
    !contact?.telephone ? "téléphone" : null,
    photos === 0 ? "photo" : null,
  ].filter(Boolean);
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { nom: true } }) : null;
  const qui = client?.nom ?? ([contact?.prenom, contact?.nom].filter(Boolean).join(" ") || contact?.raisonSociale || message.deNom || message.de);
  const { id } = await proposer(
    base(message, {
      type: "NOUVELLE_DEMANDE",
      titre: complet
        ? `Nouvelle demande de ${qui} : ${clientId ? "dossier" : "fiche et dossier"} « ${sortie.projet!.objet} » prêts`
        : `Nouvelle demande de ${qui} : ${clientId ? "à compléter" : "fiche prête"} (manque : ${manque.join(", ")})`,
      resume: [sortie.resume, sortie.projet?.details].filter(Boolean).join("\n"),
      raisonnement,
      confiance,
      contenu: {
        messageId: message.id,
        clientId,
        categorieClient: contact?.raisonSociale ? "PROFESSIONNEL" : "PARTICULIER",
        prenom: contact?.prenom ?? null,
        nomFamille: contact?.nom ?? (contact?.prenom || contact?.raisonSociale ? null : (message.deNom ?? null)),
        raisonSociale: contact?.raisonSociale ?? null,
        telephone: contact?.telephone ?? null,
        source: sortie.source ?? "INCONNUE",
        ouvrirDossier: complet ? "OUI" : "NON",
        objet: sortie.projet?.objet ?? null,
        adresse: contact?.adresse ?? null,
        codePostal: contact?.codePostal ?? null,
        ville: contact?.ville ?? null,
        prochaineAction: sortie.prochaineAction?.action ?? (complet ? "Appeler pour convenir d'une visite" : null),
        prochaineActionDate: sortie.prochaineAction?.date ?? null,
        note: sortie.note ?? sortie.projet?.details ?? null,
      },
      cleUnicite: `message:${message.id}:nouvelle-demande${clientId ? `:${clientId}` : ""}`,
      clientId: clientId ?? undefined,
    })
  );
  return { type: "NOUVELLE_DEMANDE", id, execution: "PROPOSEE" };
}

async function proposerSuites(message: MessageComplet, sortie: SortieLecture, dossierId: string, clientId: string | null, maintenant: Date): Promise<Fait[]> {
  const faits: Fait[] = [];
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { objet: true, etape: true, archiveLe: true } });
  if (!dossier || dossier.archiveLe) return faits;
  const confiance = CONFIANCE_PAR_CERTITUDE[sortie.certitude];
  const raisonnement = raisonDe(sortie);
  const commun = { clientId: clientId ?? undefined, dossierId, expireLe: new Date(maintenant.getTime() + 14 * JOUR_MS), raisonnement, confiance };

  if (sortie.note) {
    const { id } = await proposer(
      base(message, {
        ...commun,
        type: "NOTE_DOSSIER",
        titre: `Noter au dossier « ${dossier.objet} » ce que dit le mail ${objetCourt(message.objet)}`,
        resume: sortie.note,
        contenu: { dossierId, texte: sortie.note },
        cleUnicite: `message:${message.id}:note:${dossierId}`,
      })
    );
    faits.push({ type: "NOTE_DOSSIER", id, execution: "PROPOSEE" });
  }
  if (sortie.prochaineAction) {
    const { id } = await proposer(
      base(message, {
        ...commun,
        type: "PROCHAINE_ACTION",
        titre: `Prochaine action pour « ${dossier.objet} » : ${sortie.prochaineAction.action}`,
        contenu: { dossierId, action: sortie.prochaineAction.action, date: sortie.prochaineAction.date },
        cleUnicite: `message:${message.id}:action:${dossierId}`,
      })
    );
    faits.push({ type: "PROCHAINE_ACTION", id, execution: "PROPOSEE" });
  }
  if (sortie.etape && sortie.etape.vers !== dossier.etape) {
    const { id } = await proposer(
      base(message, {
        ...commun,
        type: "CHANGEMENT_ETAPE",
        titre: `Passer « ${dossier.objet} » à l'étape ${LIBELLES_ETAPE[sortie.etape.vers]}`,
        resume: `Le client écrit : « ${sortie.etape.citation} »${sortie.etape.vers === "PERDU" && sortie.etape.motifPerte ? ` (motif : ${LIBELLES_MOTIF_PERTE[sortie.etape.motifPerte].toLowerCase()})` : ""}`,
        confiance: Math.min(confiance, 0.7),
        contenu: {
          dossierId,
          vers: sortie.etape.vers,
          ...(sortie.etape.vers === "PERDU" ? { motifPerte: sortie.etape.motifPerte ?? "AUTRE", perteCommentaire: sortie.etape.citation } : {}),
        },
        cleUnicite: `message:${message.id}:etape:${dossierId}:${sortie.etape.vers}`,
      })
    );
    faits.push({ type: "CHANGEMENT_ETAPE", id, execution: "PROPOSEE" });
  }
  return faits;
}

/* ── Point d'entrée ───────────────────────────────────────────────── */

export type BilanAnalyse = { decision: string | null; faits: Fait[]; modele: { lu: boolean; raison: string | null } | null };

/**
 * Analyse d'un message relevé (tâche ANALYSE_MESSAGE, au nom de l'agent).
 * `relire` : nouvelle lecture par le modèle demandée par la personne (le tri
 * par les règles n'est pas refait).
 */
export async function analyserMessage(messageId: string, options: { relire?: boolean; maintenant?: Date; signal?: AbortSignal } = {}): Promise<BilanAnalyse> {
  const maintenant = options.maintenant ?? new Date();
  let message = await chargerMessage(messageId);
  if (!message) throw new ErreurDefinitive(`Message ${messageId} introuvable`);
  const bilan: BilanAnalyse = { decision: null, faits: [], modele: null };

  if (message.statut === "A_ANALYSER") {
    const entetes = lireEntetes(message.contenu?.entetes);
    const adresses = message.sens === "ENTRANT" ? [message.de] : lireListe(message.a);
    const clients = await clientsParAdresses(adresses);
    const fil = await contexteDuFil(message);
    const decision = trierParRegles({
      sens: message.sens === "SORTANT" ? "SORTANT" : "ENTRANT",
      de: message.de,
      compte: message.compte,
      entetes,
      libelles: (entetes.libelles ?? "").split(" ").filter(Boolean),
      pieces: message.pieces,
      clients,
      fil,
    });
    bilan.decision = decision.action;
    bilan.faits = await appliquerDecision(message, decision);
    await prisma.analyseMessage.create({
      data: {
        messageId,
        methode: "REGLES",
        categorie: categorieDe(decision),
        confiance: "confiance" in decision ? decision.confiance : null,
        raisonnement: decision.raison,
        resultat: JSON.stringify({ decision, propositions: bilan.faits }),
      },
    });
  } else if (!options.relire) {
    return bilan;
  }

  message = (await chargerMessage(messageId))!;
  if (message.statut !== "BRUIT") {
    try {
      await conserverPieces(messageId);
    } catch (erreur) {
      // Boîte déconnectée entre le relevé et l'analyse : le tri continue, les pièces seront reprises au rangement.
      console.error("[messages] pièces jointes non conservées :", erreur instanceof Error ? erreur.message : erreur);
    }
    message = (await chargerMessage(messageId))!;
  }

  // Lecture par le modèle : pour ce qui reste à trier, et pour les mails de clients.
  const utile = message.sens === "ENTRANT" && (message.statut === "A_TRIER" || message.statut === "RATTACHE");
  const bruitProbable = bilan.faits.some((fait) => fait.type === "ARCHIVER_MESSAGE");
  if (utile && (options.relire || !bruitProbable)) {
    bilan.modele = await lireAvecModele(message, maintenant, options.signal);
  }

  // Sans lecture par le modèle, un client aux dossiers multiples reçoit quand même la question du dossier.
  if (!bilan.modele?.lu && message.statut === "RATTACHE" && message.clientId && !message.dossierId && message.sens === "ENTRANT") {
    const fait = await proposerChoixDossier(message, message.clientId, null, "Adresse du client ; plusieurs dossiers en cours.", 0.5);
    if (fait) bilan.faits.push(fait);
  }
  return bilan;
}

/**
 * Après un rangement (validé ou automatique) : pièces jointes conservées, et
 * suites de la dernière lecture par le modèle (note, prochaine action, étape)
 * proposées pour le dossier désormais connu.
 */
export async function apresRangement(messageId: string): Promise<void> {
  const message = await chargerMessage(messageId);
  if (!message) return;
  if (message.statut !== "BRUIT" && message.pieces.some((piece) => piece.statut === "A_CONSERVER")) await demanderConservationPieces(messageId);
  // Une nouvelle demande validée a déjà repris la note et la prochaine action proposées.
  if (!message.dossierId || message.categorie === "NOUVELLE_DEMANDE") return;
  const lecture = await prisma.analyseMessage.findFirst({
    where: { messageId, methode: "MODELE", erreur: null },
    orderBy: { createdAt: "desc" },
    select: { resultat: true },
  });
  if (!lecture) return;
  const sortie = schemaSortieLecture.safeParse((JSON.parse(lecture.resultat) as { sortie?: unknown }).sortie);
  if (!sortie.success) return;
  await proposerSuites(message, sortie.data, message.dossierId, message.clientId, new Date());
}
