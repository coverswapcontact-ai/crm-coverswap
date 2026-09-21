import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { JOURS_A_TRAITER, LIBELLES_STATUT_LEAD, type StatutLead } from "@/lib/prospects/constantes";
import { RANG_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { compterPropositionsEnAttente } from "@/lib/validation/service";
import { GROUPES_A_MOI, GROUPES_CLIENT, type Affaire, type GroupeAffaire, type PilotageCommercial } from "./types";

/**
 * Pilotage commercial : toutes les affaires vivantes sur un seul écran — les
 * contacts pas encore rappelés et les dossiers jusqu'à la planification du
 * chantier — avec pour chacune son étape, son dernier échange, sa prochaine
 * action, et surtout À QUI EST LA MAIN.
 *
 * La main se lit dans les faits, pas dans l'étape seule : un dossier en
 * qualification attend le client tant que ses photos ne sont pas là, puis
 * attend Lucas dès qu'elles arrivent ; un SMS reçu sans réponse rend toujours
 * la main à Lucas.
 */
const JOUR_MS = 86_400_000;
const ETAPES_COMMERCIALES: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "SIGNE"];

const finDeJournee = (maintenant: Date) => {
  const fin = new Date(maintenant);
  fin.setHours(23, 59, 59, 999);
  return fin;
};

const nomComplet = (prenom: string, nom: string) => {
  const p = prenom.trim();
  const n = nom.trim();
  return (!p || p.toLowerCase() === n.toLowerCase() ? n || p : `${p} ${n}`) || "Sans nom";
};

const villeLisible = (ville: string | null | undefined) => (ville && !/^(non renseign|inconnue?$)/i.test(ville.trim()) ? ville.trim() : null);

export async function pilotageCommercial(maintenant: Date = new Date()): Promise<PilotageCommercial> {
  const limiteContacts = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  const ceSoir = finDeJournee(maintenant);
  // En retard = l'échéance était hier ou avant : une action prévue ce matin n'est pas encore un retard.
  const debutDuJour = new Date(ceSoir.getTime() - 86_400_000 + 1);

  const [contacts, dossiers, conversations, relancesAValider] = await Promise.all([
    prisma.lead.findMany({
      where: { dossiers: { none: { archiveLe: null } }, OR: [{ statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] }, createdAt: { gte: limiteContacts } }, { statut: "CONTACTE", updatedAt: { gte: limiteContacts } }] },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, prenom: true, nom: true, telephone: true, ville: true, statut: true, priorite: true, prioriteMotif: true, rappelLe: true, createdAt: true, source: true,
        interactions: { where: { archiveLe: null, type: { in: ["APPEL", "SMS", "EMAIL", "NOTE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { type: true, contenu: true, createdAt: true } },
      },
    }),
    prisma.dossier.findMany({
      where: { etape: { in: ETAPES_COMMERCIALES } },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true, leadId: true, clientId: true, clientNom: true, clientVille: true, clientTelephone: true, etape: true, photos: true, prochaineAction: true, prochaineActionDate: true, dateChantier: true, montantEstime: true, updatedAt: true, createdAt: true,
        documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { totalHt: true, numero: true, createdAt: true, dateEmission: true } },
        espaces: { where: { archiveLe: null }, take: 1, select: { createdAt: true, premierAccesLe: true, simulations: { where: { archiveLe: null }, select: { choisieLe: true, createdAt: true } } } },
        evenements: { where: { archiveLe: null, type: { notIn: ["CHANGEMENT_ETAPE", "ESPACE_VISITE", "ESPACE_LIEN_CREE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { type: true, contenu: true, createdAt: true } },
      },
    }),
    prisma.conversationSms.findMany({ where: { OR: [{ leadId: { not: null } }, { clientId: { not: null } }] }, select: { id: true, leadId: true, clientId: true, dernierSens: true, dernierExtrait: true, dernierMessageLe: true, nonLus: true, stopLe: true } }),
    compterPropositionsEnAttente(),
  ]);

  const conversationDe = (leadId: string | null, clientId: string | null) => conversations.find((c) => (leadId && c.leadId === leadId) || (clientId && c.clientId === clientId)) ?? null;
  const jours = (date: Date) => Math.max(0, Math.floor((maintenant.getTime() - date.getTime()) / JOUR_MS));
  const affaires: Affaire[] = [];

  for (const lead of contacts) {
    const conversation = conversationDe(lead.id, null);
    const premier = lead.interactions[0] ?? null;
    const dernier = premier && !(premier.type === "NOTE" && /^(Lead |Contact saisi|Statut :)/.test(premier.contenu)) ? premier : null;
    const aRappeler = lead.statut !== "CONTACTE" || (lead.rappelLe !== null && lead.rappelLe <= ceSoir);
    const repondre = conversation?.dernierSens === "ENTRANT" && !conversation.stopLe;
    let groupe: GroupeAffaire;
    let action: string;
    if (repondre) [groupe, action] = ["REPONDRE", "Répondre à son SMS"];
    else if (lead.priorite === "A_ECARTER" && lead.statut !== "CONTACTE") [groupe, action] = ["ECARTER", "Hors zone : à classer sans suite, ou à traiter quand même"];
    else if (aRappeler) [groupe, action] = ["RAPPELER", lead.rappelLe ? (lead.statut === "CONTACTE" ? "Rappeler (rappel prévu)" : "Rappeler : pas de réponse au premier appel") : "Appeler : nouveau contact"];
    else if (lead.rappelLe) [groupe, action] = ["PLUS_TARD", "Rappel prévu"];
    else [groupe, action] = ["DECIDER", "Contacté, sans suite donnée : envoyer le lien de son espace, ou classer"];
    affaires.push({
      cle: `contact-${lead.id}`,
      genre: "CONTACT",
      leadId: lead.id,
      dossierId: null,
      conversationId: conversation?.id ?? null,
      nom: nomComplet(lead.prenom, lead.nom),
      ville: villeLisible(lead.ville),
      telephone: normaliserTelephone(lead.telephone),
      etape: LIBELLES_STATUT_LEAD[lead.statut as StatutLead] ?? lead.statut,
      priorite: lead.priorite,
      prioriteMotif: lead.prioriteMotif,
      main: groupe === "PLUS_TARD" ? "CLIENT" : "MOI",
      groupe,
      action,
      echeance: lead.rappelLe?.toISOString() ?? null,
      enRetard: Boolean(lead.rappelLe && lead.rappelLe < debutDuJour),
      depuisJours: jours(dernier?.createdAt ?? lead.createdAt),
      recuLe: lead.createdAt.toISOString(),
      dernier: repondre && conversation?.dernierExtrait ? { type: "SMS reçu", texte: conversation.dernierExtrait, le: (conversation.dernierMessageLe ?? maintenant).toISOString() } : dernier ? { type: dernier.type, texte: dernier.contenu.slice(0, 160), le: dernier.createdAt.toISOString() } : null,
      montant: null,
      nonLus: conversation?.nonLus ?? 0,
    });
  }

  for (const dossier of dossiers) {
    const conversation = conversationDe(dossier.leadId, dossier.clientId);
    const espace = dossier.espaces[0] ?? null;
    const devis = dossier.documents[0] ?? null;
    const nbPhotos = lirePhotos(dossier.photos).length;
    const simulations = espace?.simulations ?? [];
    const choisie = simulations.some((s) => s.choisieLe);
    const rappelDu = dossier.prochaineActionDate !== null && dossier.prochaineActionDate <= ceSoir && /rappel|appeler/i.test(dossier.prochaineAction ?? "");
    const repondre = conversation?.dernierSens === "ENTRANT" && !conversation.stopLe;
    const etape = dossier.etape as EtapeDossier;

    let groupe: GroupeAffaire;
    let action: string;
    if (repondre) [groupe, action] = ["REPONDRE", "Répondre à son SMS"];
    else if (etape === "SIGNE") [groupe, action] = dossier.dateChantier ? ["PLUS_TARD", "Chantier daté : à planifier"] : ["PLANIFIER", "Appeler : fixer la date du chantier, suivre l'acompte"];
    else if (rappelDu) [groupe, action] = ["RAPPELER", dossier.prochaineAction ?? "Rappeler"];
    else if (etape === "QUALIFICATION") [groupe, action] = nbPhotos > 0 ? ["SIMULATION", `Préparer la simulation (${nbPhotos} photo${nbPhotos > 1 ? "s" : ""} reçue${nbPhotos > 1 ? "s" : ""})`] : espace ? ["ATTENTE_PHOTOS", espace.premierAccesLe ? "Attend ses photos (lien consulté)" : "Attend ses photos (lien pas encore ouvert)"] : ["DECIDER", "Envoyer le lien de son espace pour recevoir ses photos"];
    else if (etape === "SIMULATION") [groupe, action] = simulations.length === 0 ? ["SIMULATION", "Préparer la simulation"] : choisie && !devis ? ["DEVIS", "Faire le devis (simulation choisie)"] : ["ATTENTE_SIMULATION", "Attend son retour sur la simulation"];
    else [groupe, action] = ["ATTENTE_DEVIS", `Attend sa signature${devis?.numero ? ` (devis ${devis.numero})` : ""}`];

    const main = ["ATTENTE_PHOTOS", "ATTENTE_SIMULATION", "ATTENTE_DEVIS", "PLUS_TARD"].includes(groupe) ? "CLIENT" : "MOI";
    const dernier = dossier.evenements[0] ?? null;
    const reference = main === "CLIENT" ? (groupe === "ATTENTE_DEVIS" ? (devis?.dateEmission ?? devis?.createdAt) : groupe === "ATTENTE_SIMULATION" ? simulations.map((s) => s.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] : espace?.createdAt) : null;
    affaires.push({
      cle: `dossier-${dossier.id}`,
      genre: "DOSSIER",
      leadId: dossier.leadId,
      dossierId: dossier.id,
      conversationId: conversation?.id ?? null,
      nom: dossier.clientNom,
      ville: villeLisible(dossier.clientVille),
      telephone: normaliserTelephone(dossier.clientTelephone),
      etape: LIBELLES_ETAPE[etape] ?? dossier.etape,
      priorite: null,
      prioriteMotif: null,
      main,
      groupe,
      action,
      echeance: dossier.prochaineActionDate?.toISOString() ?? null,
      enRetard: Boolean(dossier.prochaineActionDate && dossier.prochaineActionDate < debutDuJour && main === "MOI"),
      depuisJours: jours(reference ?? dernier?.createdAt ?? dossier.updatedAt),
      recuLe: dossier.createdAt.toISOString(),
      dernier: repondre && conversation?.dernierExtrait ? { type: "SMS reçu", texte: conversation.dernierExtrait, le: (conversation.dernierMessageLe ?? maintenant).toISOString() } : dernier ? { type: dernier.type, texte: dernier.contenu.slice(0, 160), le: dernier.createdAt.toISOString() } : null,
      montant: devis?.totalHt ?? dossier.montantEstime ?? null,
      nonLus: conversation?.nonLus ?? 0,
    });
  }

  const rang = (a: Affaire) => RANG_PRIORITE[(a.priorite as Priorite) ?? "INCONNUE"] ?? RANG_PRIORITE.INCONNUE;
  // Un ordre total, groupe par groupe : les appels dans l'ordre de valeur (retards d'abord,
  // puis prioritaire, standard, secondaire, le plus récent devant) ; le reste, le plus long silence d'abord.
  const ordreGroupe = (a: Affaire) => [...GROUPES_A_MOI, ...GROUPES_CLIENT].indexOf(a.groupe);
  affaires.sort(
    (a, b) =>
      ordreGroupe(a) - ordreGroupe(b) ||
      (a.groupe === "RAPPELER" ? Number(b.enRetard) - Number(a.enRetard) || rang(a) - rang(b) || b.recuLe.localeCompare(a.recuLe) : b.depuisJours - a.depuisJours || a.nom.localeCompare(b.nom, "fr"))
  );

  const compter = (groupe: GroupeAffaire) => affaires.filter((a) => a.groupe === groupe).length;
  return {
    genereLe: maintenant.toISOString(),
    affaires,
    compteurs: {
      aMoi: affaires.filter((a) => a.main === "MOI" && a.groupe !== "ECARTER").length,
      chezLeClient: affaires.filter((a) => a.main === "CLIENT").length,
      rappeler: compter("RAPPELER"),
      repondre: compter("REPONDRE"),
      simulations: compter("SIMULATION"),
      devis: compter("DEVIS"),
      planifier: compter("PLANIFIER"),
      relancesAValider,
    },
  };
}
