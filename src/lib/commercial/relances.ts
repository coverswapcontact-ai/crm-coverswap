import prisma from "@/lib/prisma";
import { alerter } from "@/lib/alertes/canaux";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { lienEspace } from "@/lib/espace/liens";
import { estHeureOuvree } from "@/lib/sms/accuse";
import { conversationDuNumero } from "@/lib/sms/conversations";
import { lireModele } from "@/lib/sms/modeles";
import type { MotifSms } from "@/lib/sms/propositions";
import { estMobileFrancais, remplirModele } from "@/lib/sms/texte";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { proposer } from "@/lib/validation/service";

/**
 * Relances commerciales : le CRM sait où en est chaque client et ce qu'il n'a
 * pas fait. Il PROPOSE la relance adaptée, au bon moment ; Lucas valide,
 * corrige ou rejette. Rien ne part seul.
 *
 *   photos non déposées            J+2   rappel doux avec le lien
 *   simulation déposée, sans retour J+3  « qu'en pensez-vous ? »
 *   devis non signé                J+4   « je bloque un créneau… »
 *   devis relu 3 fois, sans accord J+1   « des questions ? » (il hésite)
 *   silence prolongé               J+10  dernière relance, avec une raison réelle
 *   appel sans réponse             J+3   second SMS
 *
 * Garde-fous : cinq SMS au plus en dix jours vers une même personne ; une seule
 * proposition en attente par conversation ; rien vers un numéro en STOP, un
 * fixe ou un client qui vient de répondre ; chaque relance n'est proposée
 * qu'une fois, même rejetée. Après la dernière relance restée sans réponse,
 * le CRM propose de classer le dossier « perdu — sans réponse ».
 */
const JOUR_MS = 86_400_000;
export const SMS_MAX_EN_DIX_JOURS = 5;
export const DELAIS_JOURS = { PHOTOS: 2, SIMULATION: 3, DEVIS: 4, DERNIERE: 10, INJOIGNABLE: 3, PERDU_APRES_DERNIERE: 5 } as const;
const ETAPES_RELANCABLES = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"];

export type ResumeRelancesSms = { examines: number; proposees: number; dejaProposees: number; plafond: number; sansMobile: number; stop: number; perdusProposes: number };

type Candidat = { motif: MotifSms; modele: string; cle: string; titre: string; resume: string; raisonnement: string };

const joursDepuis = (date: Date | null | undefined, maintenant: Date) => (date ? (maintenant.getTime() - date.getTime()) / JOUR_MS : -1);

export async function proposerRelancesSms(maintenant: Date = new Date()): Promise<ResumeRelancesSms> {
  const resume: ResumeRelancesSms = { examines: 0, proposees: 0, dejaProposees: 0, plafond: 0, sansMobile: 0, stop: 0, perdusProposes: 0 };
  const dossiers = await prisma.dossier.findMany({
    where: { etape: { in: ETAPES_RELANCABLES } },
    include: {
      lead: { select: { id: true, prenom: true } },
      // Seules les simulations publiées comptent : un brouillon, le client ne l'a jamais vu.
      espaces: { where: { archiveLe: null, revoqueLe: null }, take: 1, include: { simulations: { where: { archiveLe: null, statut: "PUBLIEE" }, orderBy: { createdAt: "desc" } } } },
      documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      accords: { where: { retireLe: null }, take: 1, select: { id: true } },
    },
  });

  for (const dossier of dossiers) {
    resume.examines++;
    const espace = dossier.espaces[0] ?? null;
    if (!espace || dossier.accords.length > 0) continue; // sans espace, pas de tunnel à relancer ici
    const numero = normaliserTelephone(dossier.clientTelephone);
    if (!estMobileFrancais(numero)) {
      resume.sansMobile++;
      continue;
    }
    const conversation = await conversationDuNumero(numero!, { leadId: dossier.leadId, clientId: dossier.clientId });
    if (conversation.stopLe) {
      resume.stop++;
      continue;
    }

    const [dernierEntrant, envoisRecents, enAttente, evenements] = await Promise.all([
      prisma.sms.findFirst({ where: { conversationId: conversation.id, sens: "ENTRANT" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.sms.findMany({ where: { conversationId: conversation.id, sens: "SORTANT", statut: { not: "ECHEC" }, createdAt: { gte: new Date(maintenant.getTime() - 10 * JOUR_MS) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, modele: true } }),
      prisma.proposition.count({ where: { type: "ENVOI_SMS", statut: { in: ["EN_ATTENTE", "VALIDEE"] }, dossierId: dossier.id } }),
      prisma.dossierEvenement.findMany({ where: { dossierId: dossier.id, type: { in: ["APPEL", "ESPACE_PHOTOS", "ESPACE_SIMULATION_CHOISIE", "ESPACE_COMMENTAIRE", "ESPACE_SOUHAITS", "ESPACE_VISITE"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { type: true, createdAt: true, metadata: true } }),
    ]);
    if (enAttente > 0) {
      resume.dejaProposees++;
      continue;
    }

    // Dernier signe de vie du client : un SMS, ou un geste dans son espace.
    const gestes = evenements.filter((e) => e.type !== "APPEL" && e.type !== "ESPACE_VISITE");
    const dernierSigne = [dernierEntrant?.createdAt, gestes[0]?.createdAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const dernierEnvoi = envoisRecents[0]?.createdAt ?? null;
    // On ne relance jamais quelqu'un qui vient de recevoir un message : deux jours de silence au moins.
    if (dernierEnvoi && joursDepuis(dernierEnvoi, maintenant) < 2) continue;
    // Ni quelqu'un qui est venu dans son espace ces dernières 24 heures : il avance à son rythme.
    if (espace.dernierAccesLe && joursDepuis(espace.dernierAccesLe, maintenant) < 1) continue;

    const photosRecues = lirePhotos(dossier.photos).length > 0;
    const simulation = espace.simulations[0] ?? null;
    const devis = dossier.documents[0] ?? null;
    const choixFait = Boolean(espace.choixLe) || espace.simulations.some((s) => s.choisieLe);
    const consultationsDevis = devis && espace.devisConsulteId === devis.id ? espace.devisConsultations : 0;
    const dernierAppel = evenements.find((e) => e.type === "APPEL") ?? null;
    const appelSansReponse = dernierAppel && /PAS_DE_REPONSE/.test(dernierAppel.metadata) ? dernierAppel : null;
    const derniereRelance = await prisma.sms.findFirst({ where: { conversationId: conversation.id, sens: "SORTANT", modele: "RELANCE_DERNIERE", statut: { not: "ECHEC" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });

    // Après la dernière relance restée sans réponse : proposer de classer le dossier perdu.
    if (derniereRelance && joursDepuis(derniereRelance.createdAt, maintenant) >= DELAIS_JOURS.PERDU_APRES_DERNIERE && (!dernierSigne || dernierSigne < derniereRelance.createdAt)) {
      const { creee } = await proposer({
        type: "CHANGEMENT_ETAPE",
        titre: `Classer « perdu — sans réponse » : ${dossier.clientNom}`,
        resume: `Dernière relance envoyée le ${derniereRelance.createdAt.toLocaleDateString("fr-FR")}, restée sans réponse. Une réactivation pourra le retrouver dans six mois.`,
        raisonnement: `Aucun SMS ni geste du client dans son espace depuis la dernière relance (${Math.floor(joursDepuis(derniereRelance.createdAt, maintenant))} jours).`,
        contenu: { dossierId: dossier.id, vers: "PERDU", motifPerte: "SANS_REPONSE", perteCommentaire: `Sans réponse après la dernière relance du ${derniereRelance.createdAt.toLocaleDateString("fr-FR")}` },
        cleUnicite: `perdu-sans-reponse:${dossier.id}`,
        dossierId: dossier.id,
        clientId: dossier.clientId ?? undefined,
        expireLe: new Date(maintenant.getTime() + 30 * JOUR_MS),
      }).catch((erreur) => {
        console.error(`[relances] proposition « perdu » impossible pour le dossier ${dossier.id} :`, erreur);
        return { creee: false };
      });
      if (creee) resume.perdusProposes++;
      continue;
    }
    if (derniereRelance) continue; // la dernière relance est partie : plus aucun SMS de relance

    let candidat: Candidat | null = null;
    const reference = (date: Date) => (dernierSigne && dernierSigne > date ? dernierSigne : date);
    const silence = joursDepuis(dernierSigne ?? espace.createdAt, maintenant);

    if (silence >= DELAIS_JOURS.DERNIERE && envoisRecents.length < SMS_MAX_EN_DIX_JOURS && (devis || simulation || photosRecues || joursDepuis(espace.createdAt, maintenant) >= DELAIS_JOURS.DERNIERE)) {
      candidat = { motif: "RELANCE_DERNIERE", modele: "RELANCE_DERNIERE", cle: `relance-sms:${dossier.id}:DERNIERE`, titre: `Dernière relance : ${dossier.clientNom}`, resume: `Aucun signe du client depuis ${Math.floor(silence)} jours.`, raisonnement: "Silence prolongé : dernière relance, avec une raison réelle (validité du devis, planning)." };
    } else if (devis && consultationsDevis >= 3 && joursDepuis(espace.devisConsulteLe, maintenant) >= 0.8) {
      // Trois visites sur le devis sans accord : il hésite. Une question à lever, pas un créneau à bloquer.
      candidat = { motif: "RELANCE_DEVIS", modele: "RELANCE_DEVIS_QUESTIONS", cle: `relance-sms:${dossier.id}:HESITATION:${devis.id}`, titre: `Il hésite : ${dossier.clientNom} a relu son devis ${consultationsDevis} fois`, resume: `Devis ${devis.numero} consulté ${consultationsDevis} fois dans son espace, sans bon pour accord.`, raisonnement: "Un client qui revient plusieurs fois sur son devis sans signer a une question : un appel ou ce message la lève." };
    } else if (devis && ["DEVIS_ENVOYE", "RELANCE"].includes(dossier.etape) && joursDepuis(reference(devis.dateEmission ?? devis.createdAt), maintenant) >= DELAIS_JOURS.DEVIS) {
      candidat = { motif: "RELANCE_DEVIS", modele: "RELANCE_DEVIS", cle: `relance-sms:${dossier.id}:DEVIS:${devis.id}`, titre: `Relancer ${dossier.clientNom} : devis ${devis.numero} non signé`, resume: `Devis émis il y a ${Math.floor(joursDepuis(devis.dateEmission ?? devis.createdAt, maintenant))} jours, pas de bon pour accord.`, raisonnement: `Dossier à l'étape « ${dossier.etape} », devis en vigueur, aucun signe du client depuis ${DELAIS_JOURS.DEVIS} jours au moins.` };
    } else if (!devis && simulation && dossier.etape === "SIMULATION" && !choixFait && joursDepuis(reference(simulation.publieeLe ?? simulation.createdAt), maintenant) >= DELAIS_JOURS.SIMULATION) {
      const vue = Boolean(simulation.vueLe) || Boolean(espace.dernierAccesLe && espace.dernierAccesLe > (simulation.publieeLe ?? simulation.createdAt));
      candidat = { motif: "RELANCE_SIMULATION", modele: "RELANCE_SIMULATION", cle: `relance-sms:${dossier.id}:SIMULATION:${simulation.id}`, titre: `Relancer ${dossier.clientNom} : simulation sans retour`, resume: `Simulation déposée il y a ${Math.floor(joursDepuis(simulation.createdAt, maintenant))} jours — ${vue ? "vue par le client" : "pas encore consultée"}, aucun choix.`, raisonnement: "Simulation déposée, ni choix ni commentaire, aucun SMS du client depuis." };
    } else if (!photosRecues && dossier.etape === "QUALIFICATION") {
      if (appelSansReponse && joursDepuis(reference(appelSansReponse.createdAt), maintenant) >= DELAIS_JOURS.INJOIGNABLE) {
        candidat = { motif: "INJOIGNABLE_J3", modele: "INJOIGNABLE_J3", cle: `relance-sms:${dossier.id}:INJOIGNABLE_J3`, titre: `Toujours injoignable : ${dossier.clientNom}`, resume: `Appel sans réponse il y a ${Math.floor(joursDepuis(appelSansReponse.createdAt, maintenant))} jours, aucune photo déposée.`, raisonnement: "Séquence « pas de réponse » : second SMS à J+3." };
      } else if (!appelSansReponse && joursDepuis(reference(espace.createdAt), maintenant) >= DELAIS_JOURS.PHOTOS) {
        candidat = { motif: "RELANCE_PHOTOS", modele: "RELANCE_PHOTOS", cle: `relance-sms:${dossier.id}:PHOTOS`, titre: `Relancer ${dossier.clientNom} : photos non déposées`, resume: `Espace ouvert il y a ${Math.floor(joursDepuis(espace.createdAt, maintenant))} jours, aucune photo reçue${espace.premierAccesLe ? " (lien consulté)" : " (lien jamais ouvert)"}.`, raisonnement: "Lien envoyé, aucune photo, aucun signe du client depuis deux jours au moins." };
      }
    }
    if (!candidat) continue;

    // Plafond de courtoisie : au-delà de cinq messages en dix jours, on passe pour un harceleur.
    if (envoisRecents.length >= SMS_MAX_EN_DIX_JOURS) {
      resume.plafond++;
      continue;
    }

    const modele = await lireModele(candidat.modele);
    if (!modele?.actif) continue;
    const devisDate = devis ? (devis.dateEmission ?? devis.createdAt) : null;
    const prenom = (dossier.lead?.prenom ?? dossier.clientNom.split(/\s+/)[0] ?? "").trim();
    const texte = remplirModele(modele.texte, {
      prenom: /^(inconnu|client)$/i.test(prenom) ? "" : prenom.split(/\s+/)[0],
      lien: lienEspace(espace),
      validite: devisDate ? new Date(devisDate.getTime() + 30 * JOUR_MS).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "la fin du mois",
      montant: devis ? `${devis.totalHt.toLocaleString("fr-FR")} EUR` : null,
    });

    const { creee } = await proposer({
      type: "ENVOI_SMS",
      titre: candidat.titre,
      resume: `${candidat.resume} ${envoisRecents.length} SMS envoyé(s) sur les dix derniers jours (plafond : ${SMS_MAX_EN_DIX_JOURS}).`,
      raisonnement: candidat.raisonnement,
      contenu: { motif: candidat.motif, conversationId: conversation.id, dossierId: dossier.id, modele: candidat.modele, texte, proposeLe: maintenant.toISOString() },
      cleUnicite: candidat.cle,
      dossierId: dossier.id,
      clientId: dossier.clientId ?? undefined,
      expireLe: new Date(maintenant.getTime() + 7 * JOUR_MS),
    });
    if (creee) resume.proposees++;
    else resume.dejaProposees++;
  }

  // Une seule notification pour toutes les relances du passage, en journée seulement.
  if (resume.proposees + resume.perdusProposes > 0 && estHeureOuvree(maintenant)) {
    const nombre = resume.proposees + resume.perdusProposes;
    await alerter(
      {
        titre: `${nombre} relance${nombre > 1 ? "s" : ""} à valider`,
        texte: `Le CRM a préparé ${nombre} message${nombre > 1 ? "s" : ""} de relance. Relisez, corrigez, envoyez — ou rejetez.`,
        lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/validation`,
        libelleLien: "Ouvrir la file",
        urgence: 3,
        etiquette: "relances",
      },
      { origine: "relances", canaux: ["telegram", "ntfy", "pushweb"] }
    );
  }
  return resume;
}

export function enregistrerTachesCommerciales(): void {
  enregistrerTravailPeriodique({
    nom: "relances-sms",
    libelle: "Relances commerciales proposées (SMS)",
    acteur: "SYSTEME:relances",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      const resume = await proposerRelancesSms();
      if (resume.proposees + resume.perdusProposes > 0) console.log(`[relances] ${JSON.stringify(resume)}`);
    },
  });
}
