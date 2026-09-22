import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { lienPourLeProjet } from "@/lib/espace/liens";
import { programmerEnvoi } from "./envoi-crm";

/**
 * Séquences de mails (mission 7) : un déclencheur, des étapes espacées de
 * quelques jours, une condition d'arrêt. TOUT est construit, RIEN n'est actif :
 * Lucas active une séquence le jour où il aura l'outil d'envoi adapté.
 *
 * Règles tenues ici, pas dans l'écran :
 * - arrêt dès que le client répond, signe, ou agit dans son espace ;
 * - lien de désinscription dans chaque mail ; une désinscription est
 *   définitive et enregistrée (`Desinscription`) ;
 * - mode « validation » par défaut (chaque mail attend le clic de Lucas),
 *   « automatique » au choix ; plafond d'envois par jour ;
 * - le moteur d'envoi est isolé (envoi-crm → envoyeur Gmail aujourd'hui, un
 *   service dédié demain), l'adresse d'expédition est un paramètre.
 */

export type CodeSequence = "INJOIGNABLE" | "DEVIS_NON_SIGNE" | "AVIS" | "REACTIVATION";

type Modele = { code: CodeSequence; nom: string; declencheur: string; description: string; etapes: { delaiJours: number; objet: string; texte: string }[] };

/** Les quatre séquences prêtes à l'emploi (textes modifiables dans l'écran Séquences). */
export const SEQUENCES_PAR_DEFAUT: Modele[] = [
  {
    code: "INJOIGNABLE",
    nom: "Lead injoignable",
    declencheur: "Deux appels sans réponse, et une adresse mail connue.",
    description: "Pour un contact que vous n'arrivez pas à joindre : proposer de rappeler au bon moment, ou de passer par son espace.",
    etapes: [
      { delaiJours: 0, objet: "Votre projet de rénovation", texte: "Bonjour {prenom},\n\nJ'ai essayé de vous joindre au sujet de votre projet, sans succès. Dites-moi quel moment vous arrange pour un appel, ou répondez simplement à ce mail.\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 3, objet: "Toujours partant pour votre projet ?", texte: "Bonjour {prenom},\n\nJe reviens vers vous : votre projet est-il toujours d'actualité ? Un simple « oui » en réponse et je vous rappelle quand vous voulez.\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 7, objet: "Je clôture votre demande ?", texte: "Bonjour {prenom},\n\nSans nouvelles de votre part, je vais clôturer votre demande. Si votre projet reste d'actualité, il suffit de répondre à ce mail.\n\nBien cordialement,\nLucas — CoverSwap" },
    ],
  },
  {
    code: "DEVIS_NON_SIGNE",
    nom: "Devis envoyé, non signé",
    declencheur: "Devis émis depuis 3 jours, pas encore d'accord.",
    description: "Relancer en douceur, répondre aux questions, rappeler que le devis est dans son espace.",
    etapes: [
      { delaiJours: 3, objet: "Votre devis {devis}", texte: "Bonjour {prenom},\n\nAvez-vous pu regarder votre devis ? Il est dans votre espace : {lien}\n\nSi une question se pose, répondez à ce mail : je vous réponds rapidement.\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 4, objet: "Une question sur votre devis ?", texte: "Bonjour {prenom},\n\nJe me permets de revenir vers vous au sujet de votre devis {devis}. Un détail à ajuster, une teinte à revoir ? Dites-le-moi, nous le reprenons ensemble.\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 7, objet: "Votre projet, toujours d'actualité ?", texte: "Bonjour {prenom},\n\nVotre devis reste valable ; votre espace le garde : {lien}\nSi votre projet est reporté, dites-le-moi simplement, je n'insisterai pas.\n\nBien cordialement,\nLucas — CoverSwap" },
    ],
  },
  {
    code: "AVIS",
    nom: "Projet terminé : demande d'avis",
    declencheur: "Chantier terminé (facturé), pas encore d'avis dans son espace.",
    description: "Remercier et inviter à laisser un avis, en un clic depuis son espace.",
    etapes: [
      { delaiJours: 2, objet: "Merci pour votre confiance", texte: "Bonjour {prenom},\n\nMerci de nous avoir confié votre projet. Si vous êtes satisfait du résultat, votre avis compte beaucoup : il se donne en un clic depuis votre espace : {lien}\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 7, objet: "Votre avis sur votre rénovation", texte: "Bonjour {prenom},\n\nUn dernier mot : votre avis aide d'autres personnes à se lancer. Il suffit d'une note et de quelques mots, depuis votre espace : {lien}\n\nMerci encore,\nLucas — CoverSwap" },
    ],
  },
  {
    code: "REACTIVATION",
    nom: "Réactivation à 6 mois",
    declencheur: "Lead perdu depuis 6 mois, avec une adresse mail et son accord aux e-mails commerciaux.",
    description: "Reprendre contact simplement, sans relance insistante.",
    etapes: [
      { delaiJours: 0, objet: "Où en est votre projet ?", texte: "Bonjour {prenom},\n\nIl y a quelques mois, vous vous intéressiez à la rénovation de votre intérieur. Où en est votre projet ? Si l'envie revient, répondez à ce mail : je vous prépare une simulation sur vos photos.\n\nBien cordialement,\nLucas — CoverSwap" },
      { delaiJours: 14, objet: "Une simulation de votre pièce ?", texte: "Bonjour {prenom},\n\nPour vous faire une idée sans engagement, je peux vous montrer votre pièce rénovée à partir de quelques photos. Il suffit de répondre à ce mail.\n\nBien cordialement,\nLucas — CoverSwap" },
    ],
  },
];

/** Crée les séquences manquantes (inactives). Rejouable ; ne touche jamais une séquence existante. */
export async function assurerSequences(): Promise<void> {
  for (const modele of SEQUENCES_PAR_DEFAUT) {
    const existe = await prisma.sequenceMail.findUnique({ where: { code: modele.code }, select: { id: true } });
    if (existe) continue;
    await prisma.sequenceMail
      .create({
        data: {
          code: modele.code,
          nom: modele.nom,
          declencheur: modele.declencheur,
          description: modele.description,
          active: false,
          mode: "VALIDATION",
          plafondJour: 10,
          etapes: { create: modele.etapes.map((etape, i) => ({ rang: i + 1, ...etape })) },
        },
      })
      .catch((erreur) => {
        if ((erreur as { code?: string }).code !== "P2002") throw erreur;
      });
  }
}

export async function sequencesActives(): Promise<boolean> {
  return (await prisma.sequenceMail.count({ where: { active: true } })) > 0;
}

/* ── Désinscription (définitive) ───────────────────────────────────── */

function cleDesinscription(): string {
  const racine = process.env.NEXTAUTH_SECRET?.trim();
  if (!racine) throw new Error("NEXTAUTH_SECRET absente : aucun lien de désinscription ne peut être signé.");
  return createHmac("sha256", racine).update("desinscription/v1").digest("hex");
}

export function jetonDesinscription(adresse: string): string {
  return createHmac("sha256", cleDesinscription()).update(adresse.trim().toLowerCase()).digest().subarray(0, 16).toString("base64url");
}

export function lienDesinscription(adresse: string): string {
  const site = (process.env.SITE_URL || "https://coverswap.fr").replace(/\/$/, "");
  const propre = adresse.trim().toLowerCase();
  return `${site}/desinscription?e=${Buffer.from(propre).toString("base64url")}&j=${jetonDesinscription(propre)}`;
}

/**
 * Le lien de désinscription a été suivi : enregistrée pour toujours, séquences
 * arrêtées, et le retrait de l'accord aux e-mails commerciaux inscrit sur la
 * fiche de chaque client qui porte cette adresse (preuve datée).
 */
export async function desinscrire(adresseEncodee: string, jeton: string, source: "LIEN" | "LUCAS" = "LIEN"): Promise<{ adresse: string }> {
  let adresse: string;
  try {
    adresse = Buffer.from(adresseEncodee, "base64url").toString("utf8").trim().toLowerCase();
  } catch {
    throw new ErreurMetier("Lien de désinscription illisible.", 400);
  }
  if (!normaliserEmail(adresse)) throw new ErreurMetier("Lien de désinscription illisible.", 400);
  const attendu = Buffer.from(jetonDesinscription(adresse));
  const recu = Buffer.from(jeton);
  if (source === "LIEN" && (attendu.length !== recu.length || !timingSafeEqual(attendu, recu))) throw new ErreurMetier("Lien de désinscription invalide.", 403);
  const deja = await prisma.desinscription.findUnique({ where: { adresse }, select: { adresse: true } });
  await prisma.desinscription.upsert({ where: { adresse }, create: { adresse, source }, update: {} });
  await prisma.inscriptionSequence.updateMany({ where: { adresse, statut: { in: ["EN_COURS", "EN_VALIDATION"] } }, data: { statut: "ARRETEE", arretMotif: source === "LIEN" ? "Désinscrit (lien du mail)" : "Désinscrit par Lucas" } });
  if (!deja) {
    const clients = await prisma.clientEmail.findMany({ where: { adresse, archiveLe: null, client: { anonymiseLe: null } }, select: { clientId: true }, distinct: ["clientId"] });
    for (const { clientId } of clients) {
      await prisma.consentementMail.create({
        data: { clientId, statut: "RETIRE", moyen: "EMAIL", recueilliLe: new Date(), preuve: source === "LIEN" ? "Lien de désinscription d'un mail de séquence" : "Désinscription notée par Lucas" },
      });
    }
  }
  return { adresse };
}

/* ── Les candidats de chaque déclencheur ───────────────────────────── */

export type Candidat = { cle: string; adresse: string; prenom: string; dossierId: string | null; leadId: string | null; clientId: string | null; devis: string | null; montant: string | null };

const JOUR = 86_400_000;
const prenomDe = (prenom: string | null | undefined, nom: string | null | undefined) => (prenom && !/inconnu/i.test(prenom) ? prenom : nom && !/inconnu/i.test(nom) ? nom : "");

async function candidats(code: CodeSequence, maintenant: Date, limite = 50): Promise<Candidat[]> {
  const desinscrits = new Set((await prisma.desinscription.findMany({ select: { adresse: true } })).map((d) => d.adresse));
  const garder = (c: Candidat) => Boolean(normaliserEmail(c.adresse)) && !desinscrits.has(c.adresse.toLowerCase());
  if (code === "INJOIGNABLE") {
    const leads = await prisma.lead.findMany({
      where: { archiveLe: null, email: { not: null }, dossiers: { none: { archiveLe: null } }, statut: { in: ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE"] }, notesAppel: { some: { issue: "PAS_DE_REPONSE" } } },
      select: { id: true, email: true, prenom: true, nom: true, clientId: true, notesAppel: { where: { issue: "PAS_DE_REPONSE", archiveLe: null }, select: { id: true } } },
      take: limite * 2,
    });
    return leads
      .filter((l) => l.notesAppel.length >= 2)
      .map((l) => ({ cle: `${code}:lead:${l.id}`, adresse: l.email!.toLowerCase(), prenom: prenomDe(l.prenom, l.nom), dossierId: null, leadId: l.id, clientId: l.clientId, devis: null, montant: null }))
      .filter(garder)
      .slice(0, limite);
  }
  if (code === "DEVIS_NON_SIGNE") {
    const dossiers = await prisma.dossier.findMany({
      where: { archiveLe: null, etape: { in: ["DEVIS_ENVOYE", "RELANCE"] }, clientEmail: { not: null }, accords: { none: { retireLe: null } }, documents: { some: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] }, dateEmission: { lte: new Date(maintenant.getTime() - 3 * JOUR) } } } },
      select: { id: true, clientEmail: true, clientNom: true, clientId: true, client: { select: { prenom: true } }, documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { numero: true, totalHt: true } } },
      take: limite,
    });
    return dossiers
      .map((d) => ({ cle: `${code}:dossier:${d.id}`, adresse: d.clientEmail!.toLowerCase(), prenom: prenomDe(d.client?.prenom, d.clientNom.split(" ")[0]), dossierId: d.id, leadId: null, clientId: d.clientId, devis: d.documents[0]?.numero ?? null, montant: d.documents[0] ? `${d.documents[0].totalHt.toLocaleString("fr-FR")} €` : null }))
      .filter(garder);
  }
  if (code === "AVIS") {
    const dossiers = await prisma.dossier.findMany({
      where: { archiveLe: null, etape: { in: ["FACTURE", "ENCAISSE"] }, clientEmail: { not: null }, updatedAt: { gte: new Date(maintenant.getTime() - 60 * JOUR) }, espaces: { some: { avisLe: null, revoqueLe: null } } },
      select: { id: true, clientEmail: true, clientNom: true, clientId: true, client: { select: { prenom: true } } },
      take: limite,
    });
    return dossiers.map((d) => ({ cle: `${code}:dossier:${d.id}`, adresse: d.clientEmail!.toLowerCase(), prenom: prenomDe(d.client?.prenom, d.clientNom.split(" ")[0]), dossierId: d.id, leadId: null, clientId: d.clientId, devis: null, montant: null })).filter(garder);
  }
  // Réactivation : perdu depuis six mois (à une semaine près). C'est de la prospection :
  // seulement avec l'accord aux e-mails commerciaux en cours (la déclaration la plus récente).
  const leads = await prisma.lead.findMany({
    where: { archiveLe: null, statut: "PERDU", email: { not: null }, clientId: { not: null }, updatedAt: { gte: new Date(maintenant.getTime() - 190 * JOUR), lte: new Date(maintenant.getTime() - 180 * JOUR) } },
    select: { id: true, email: true, prenom: true, nom: true, clientId: true, client: { select: { consentements: { orderBy: [{ recueilliLe: "desc" }, { createdAt: "desc" }], take: 1, select: { statut: true } } } } },
    take: limite * 2,
  });
  return leads
    .filter((l) => l.client?.consentements[0]?.statut === "ACCORDE")
    .map((l) => ({ cle: `${code}:lead:${l.id}`, adresse: l.email!.toLowerCase(), prenom: prenomDe(l.prenom, l.nom), dossierId: null, leadId: l.id, clientId: l.clientId, devis: null, montant: null }))
    .filter(garder)
    .slice(0, limite);
}

/* ── Rendu d'une étape (aperçu avec un vrai client, envoi) ─────────── */

async function lienDuCandidat(candidat: Candidat): Promise<string> {
  if (!candidat.dossierId) return "";
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId: candidat.dossierId, archiveLe: null } });
  return espace ? ((await lienPourLeProjet(espace)) ?? "") : "";
}

export async function rendreEtape(etape: { objet: string; texte: string }, candidat: Candidat): Promise<{ objet: string; texte: string; manques: string[] }> {
  const lien = await lienDuCandidat(candidat);
  const valeurs: Record<string, string> = { prenom: candidat.prenom, lien, devis: candidat.devis ?? "", montant: candidat.montant ?? "" };
  const manques: string[] = [];
  const remplir = (texte: string) =>
    texte.replace(/\{(\w+)\}/g, (_tout, nom: string) => {
      const valeur = valeurs[nom];
      if (valeur) return valeur;
      if (nom === "prenom") return "";
      manques.push(nom);
      return "[à compléter]";
    });
  const texte = remplir(etape.texte).replace(/^Bonjour ,/m, "Bonjour,");
  const pied = `\n\n—\nVous ne souhaitez plus recevoir ces messages ? Désinscription en un clic : ${lienDesinscription(candidat.adresse)}`;
  return { objet: remplir(etape.objet), texte: `${texte}${pied}`, manques };
}

export type ApercuEtape = { candidat: Candidat | null; candidats: { cle: string; nom: string }[]; objet: string; texte: string; manques: string[] };

/**
 * Aperçu d'une étape avec les données d'un vrai client : celui demandé (un
 * contact qui attend la validation, même s'il ne correspond plus au
 * déclencheur), sinon le premier concerné aujourd'hui. Rend aussi les autres
 * contacts concernés, pour en choisir un autre.
 */
export async function apercuEtape(code: CodeSequence, rang: number, cle?: string): Promise<ApercuEtape> {
  await assurerSequences();
  const sequence = await prisma.sequenceMail.findUnique({ where: { code }, include: { etapes: { orderBy: { rang: "asc" } } } });
  const etape = sequence?.etapes.find((e) => e.rang === rang);
  if (!sequence || !etape) throw new ErreurMetier("Étape introuvable.", 404);
  const liste = await candidats(code, new Date(), cle ? 200 : 20);
  let candidat = (cle ? liste.find((c) => c.cle === cle) : liste[0]) ?? null;
  if (!candidat && cle) {
    const inscription = await prisma.inscriptionSequence.findUnique({ where: { cle } });
    if (inscription) candidat = { cle, adresse: inscription.adresse, prenom: "", dossierId: inscription.dossierId, leadId: inscription.leadId, clientId: inscription.clientId, devis: null, montant: null };
  }
  const autres = liste.slice(0, 20).map((c) => ({ cle: c.cle, nom: c.prenom ? `${c.prenom} · ${c.adresse}` : c.adresse }));
  if (!candidat) return { candidat: null, candidats: autres, objet: etape.objet, texte: etape.texte, manques: [] };
  return { candidat, candidats: autres, ...(await rendreEtape(etape, candidat)) };
}

/* ── Le moteur (ne tourne que si une séquence est active) ──────────── */

/** Le client a répondu, signé, ou agi dans son espace depuis son inscription : la séquence s'arrête. */
async function raisonDArret(inscription: { createdAt: Date; adresse: string; dossierId: string | null; leadId: string | null }, code: string): Promise<string | null> {
  if (await prisma.desinscription.findUnique({ where: { adresse: inscription.adresse } })) return "Désinscrit";
  const repondu = await prisma.message.count({ where: { canal: "EMAIL", sens: "ENTRANT", de: inscription.adresse, recuLe: { gt: inscription.createdAt } } });
  if (repondu > 0) return "Le client a répondu";
  if (inscription.dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: inscription.dossierId }, select: { etape: true, archiveLe: true } });
    if (!dossier || dossier.archiveLe) return "Dossier archivé";
    if (code !== "AVIS" && ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(dossier.etape)) return "Devis signé";
    const geste = await prisma.dossierEvenement.count({ where: { dossierId: inscription.dossierId, direction: "ENTRANT", createdAt: { gt: inscription.createdAt } } });
    if (geste > 0) return "Le client a agi (espace, mail ou SMS)";
    if (code === "AVIS" && (await prisma.espaceClient.count({ where: { dossierId: inscription.dossierId, avisLe: { not: null } } })) > 0) return "Avis donné";
  }
  if (inscription.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: inscription.leadId }, select: { archiveLe: true, statut: true, dossiers: { where: { archiveLe: null }, select: { id: true } } } });
    if (!lead || lead.archiveLe) return "Lead archivé";
    if (code === "INJOIGNABLE" && lead.dossiers.length > 0) return "Dossier ouvert";
    if (code === "REACTIVATION" && lead.statut !== "PERDU") return "Lead de nouveau actif";
  }
  return null;
}

/** Un passage : nouvelles inscriptions, arrêts, envois dus (validation ou automatique), plafond du jour. */
export async function avancerSequences(maintenant: Date = new Date()): Promise<{ inscrits: number; arretes: number; prepares: number; programmes: number }> {
  const bilan = { inscrits: 0, arretes: 0, prepares: 0, programmes: 0 };
  const actives = await prisma.sequenceMail.findMany({ where: { active: true }, include: { etapes: { orderBy: { rang: "asc" } } } });
  for (const sequence of actives) {
    const premiere = sequence.etapes[0];
    if (!premiere) continue;
    for (const candidat of await candidats(sequence.code as CodeSequence, maintenant)) {
      const existe = await prisma.inscriptionSequence.findUnique({ where: { cle: candidat.cle }, select: { id: true } });
      if (existe) continue;
      await prisma.inscriptionSequence.create({ data: { sequenceId: sequence.id, cle: candidat.cle, adresse: candidat.adresse, dossierId: candidat.dossierId, leadId: candidat.leadId, clientId: candidat.clientId, prochainEnvoiLe: new Date(maintenant.getTime() + premiere.delaiJours * JOUR) } });
      bilan.inscrits++;
    }
    const debutJour = new Date(maintenant);
    debutJour.setHours(0, 0, 0, 0);
    let envoisDuJour = await prisma.envoiMail.count({ where: { nature: "SEQUENCE", createdAt: { gte: debutJour }, modele: { startsWith: `${sequence.code}:` } } });
    const dues = await prisma.inscriptionSequence.findMany({ where: { sequenceId: sequence.id, statut: { in: ["EN_COURS", "EN_VALIDATION"] }, prochainEnvoiLe: { lte: maintenant } }, orderBy: { prochainEnvoiLe: "asc" }, take: 100 });
    for (const inscription of dues) {
      const arret = await raisonDArret(inscription, sequence.code);
      if (arret) {
        await prisma.inscriptionSequence.update({ where: { id: inscription.id }, data: { statut: "ARRETEE", arretMotif: arret } });
        bilan.arretes++;
        continue;
      }
      // Déjà en attente de votre clic : rien de plus à faire tant que vous n'avez pas tranché.
      if (inscription.statut === "EN_VALIDATION") continue;
      const etape = sequence.etapes[inscription.etapeFaite];
      if (!etape) {
        await prisma.inscriptionSequence.update({ where: { id: inscription.id }, data: { statut: "TERMINEE" } });
        continue;
      }
      if (sequence.mode !== "AUTOMATIQUE") {
        // Mode validation : l'étape attend le clic de Lucas dans l'écran Séquences.
        await prisma.inscriptionSequence.update({ where: { id: inscription.id }, data: { statut: "EN_VALIDATION" } });
        bilan.prepares++;
        continue;
      }
      if (envoisDuJour >= sequence.plafondJour) break;
      await envoyerEtape(inscription.id);
      envoisDuJour++;
      bilan.programmes++;
    }
  }
  return bilan;
}

/** Envoie l'étape due d'une inscription (automatique, ou validée par Lucas), puis prépare la suivante. */
export async function envoyerEtape(inscriptionId: string): Promise<{ envoiId: string }> {
  const inscription = await prisma.inscriptionSequence.findUnique({ where: { id: inscriptionId }, include: { sequence: { include: { etapes: { orderBy: { rang: "asc" } } } } } });
  if (!inscription) throw new ErreurMetier("Inscription introuvable.", 404);
  if (!["EN_COURS", "EN_VALIDATION"].includes(inscription.statut)) throw new ErreurMetier("Cette séquence est arrêtée ou terminée pour ce contact.", 409);
  const arret = await raisonDArret(inscription, inscription.sequence.code);
  if (arret) {
    await prisma.inscriptionSequence.update({ where: { id: inscription.id }, data: { statut: "ARRETEE", arretMotif: arret } });
    throw new ErreurMetier(`Séquence arrêtée : ${arret.toLowerCase()}.`, 409);
  }
  const etape = inscription.sequence.etapes[inscription.etapeFaite];
  if (!etape) throw new ErreurMetier("Plus aucune étape à envoyer.", 409);
  const candidat: Candidat = { cle: inscription.cle, adresse: inscription.adresse, prenom: "", dossierId: inscription.dossierId, leadId: inscription.leadId, clientId: inscription.clientId, devis: null, montant: null };
  const complet = (await candidats(inscription.sequence.code as CodeSequence, new Date(), 200)).find((c) => c.cle === inscription.cle) ?? candidat;
  const rendu = await rendreEtape(etape, complet);
  if (rendu.manques.length) throw new ErreurMetier(`Il manque des informations pour ce mail : ${rendu.manques.join(", ")}.`, 409);
  const { id } = await programmerEnvoi({
    cle: `sequence:${inscription.id}:${etape.rang}`,
    nature: "SEQUENCE",
    modele: `${inscription.sequence.code}:${etape.rang}`,
    a: inscription.adresse,
    objet: rendu.objet,
    texte: rendu.texte,
    dossierId: inscription.dossierId,
    clientId: inscription.clientId,
    leadId: inscription.leadId,
    entetes: { "List-Unsubscribe": `<${lienDesinscription(inscription.adresse)}>` },
  });
  const suivante = inscription.sequence.etapes[inscription.etapeFaite + 1];
  await prisma.inscriptionSequence.update({
    where: { id: inscription.id },
    data: { etapeFaite: inscription.etapeFaite + 1, statut: suivante ? "EN_COURS" : "TERMINEE", prochainEnvoiLe: suivante ? new Date(Date.now() + suivante.delaiJours * JOUR) : null },
  });
  return { envoiId: id };
}

/** L'écran Séquences : chaque séquence, ses étapes, ses inscrits, et ce qui attend une validation. */
export async function listerSequences() {
  await assurerSequences();
  const sequences = await prisma.sequenceMail.findMany({ orderBy: { createdAt: "asc" }, include: { etapes: { orderBy: { rang: "asc" } }, inscriptions: { where: { statut: { in: ["EN_COURS", "EN_VALIDATION"] } }, orderBy: { prochainEnvoiLe: "asc" }, select: { id: true, cle: true, statut: true, adresse: true, etapeFaite: true, prochainEnvoiLe: true } } } });
  const maintenant = new Date();
  return Promise.all(
    sequences.map(async (s) => ({
      id: s.id,
      code: s.code as CodeSequence,
      nom: s.nom,
      declencheur: s.declencheur,
      description: s.description,
      mode: s.mode as "VALIDATION" | "AUTOMATIQUE",
      active: s.active,
      plafondJour: s.plafondJour,
      etapes: s.etapes.map((e) => ({ id: e.id, rang: e.rang, delaiJours: e.delaiJours, objet: e.objet, texte: e.texte })),
      enCours: s.inscriptions.length,
      aValider: s.inscriptions.filter((i) => i.statut === "EN_VALIDATION").map((i) => ({ id: i.id, cle: i.cle, adresse: i.adresse, etape: i.etapeFaite + 1 })),
      candidatsAujourdhui: (await candidats(s.code as CodeSequence, maintenant, 50)).length,
    }))
  );
}

export type SequenceVue = Awaited<ReturnType<typeof listerSequences>>[number];
