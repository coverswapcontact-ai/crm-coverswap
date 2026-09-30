import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { estMotifRepondre } from "@/lib/dossiers/main";
import { mainDe } from "@/lib/dossiers/pilotage";
import { pluriel } from "@/lib/commun/format";
import { JOURS_A_TRAITER, LIBELLES_STATUT_LEAD, type StatutLead } from "@/lib/prospects/constantes";
import { LEAD_SANS_DOSSIER } from "@/lib/prospects/leads";
import { RANG_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { compterPropositionsEnAttente } from "@/lib/validation/service";
import { aHeureParis } from "./quand";
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
 *
 * Mission 14 (partie 3) : les contacts suivent la règle des deux listes de
 * Leads. Jamais appelé (« À appeler ») : à appeler ; déjà appelé (« À
 * rappeler ») : à rappeler si le rappel est en retard ou pour aujourd'hui,
 * plus tard s'il est daté après, à décider s'il n'a pas de date. « Aujourd'hui »
 * est la journée de Paris (le serveur tourne en UTC).
 */
const JOUR_MS = 86_400_000;
const ETAPES_COMMERCIALES: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "SIGNE"];

/** Le dernier instant de la journée, heure de Paris. */
const finDeJournee = (maintenant: Date) => new Date(aHeureParis(maintenant, 1, 0).getTime() - 1);

const nomComplet = (prenom: string, nom: string) => {
  const p = prenom.trim();
  const n = nom.trim();
  return (!p || p.toLowerCase() === n.toLowerCase() ? n || p : `${p} ${n}`) || "Sans nom";
};

const villeLisible = (ville: string | null | undefined) => (ville && !/^(non renseign|inconnue?$)/i.test(ville.trim()) ? ville.trim() : null);

export async function pilotageCommercial(maintenant: Date = new Date()): Promise<PilotageCommercial> {
  const limiteContacts = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  const ceSoir = finDeJournee(maintenant);
  // Dossier en retard = l'échéance était hier ou avant : une action prévue ce matin n'est pas encore un retard.
  const debutDuJour = aHeureParis(maintenant, 0, 0);

  const [contacts, dossiers, conversations, relancesAValider] = await Promise.all([
    // Les leads des deux listes, sans dossier (le dossier a sa propre ligne) : tout rappel daté, quel que soit son âge
    // (un retard reste un retard), et les leads arrivés ou appelés depuis moins de 60 jours. Les rappels d'abord.
    prisma.lead.findMany({
      where: { AND: [LEAD_SANS_DOSSIER, { OR: [{ rappelLe: { not: null } }, { createdAt: { gte: limiteContacts } }, { dernierAppelLe: { gte: limiteContacts } }, { dernierContactLe: { gte: limiteContacts } }] }] },
      orderBy: [{ rappelLe: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true, prenom: true, nom: true, telephone: true, ville: true, statut: true, priorite: true, prioriteMotif: true, rappelLe: true, dernierAppelLe: true, dernierContactLe: true, tentatives: true, createdAt: true, source: true,
        interactions: { where: { archiveLe: null, type: { in: ["APPEL", "SMS", "EMAIL", "NOTE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { type: true, contenu: true, createdAt: true } },
      },
    }),
    prisma.dossier.findMany({
      where: { etape: { in: ETAPES_COMMERCIALES } },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true, leadId: true, clientId: true, clientNom: true, clientVille: true, clientTelephone: true, etape: true, photos: true, prochaineAction: true, prochaineActionDate: true, dateChantier: true, main: true, mainMotif: true, montantEstime: true, updatedAt: true, createdAt: true,
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
    // « À appeler » : jamais appelé ni contacté par écrit (mission 17), sans rappel daté (même règle que la liste de Leads).
    const aAppeler = !lead.dernierAppelLe && !lead.dernierContactLe && !lead.rappelLe;
    const rappelDu = lead.rappelLe !== null && lead.rappelLe <= ceSoir;
    const repondre = conversation?.dernierSens === "ENTRANT" && !conversation.stopLe;
    let groupe: GroupeAffaire;
    let action: string;
    if (repondre) [groupe, action] = ["REPONDRE", "Répondre à son SMS"];
    else if (aAppeler && lead.priorite === "A_ECARTER") [groupe, action] = ["ECARTER", "Hors zone : à classer sans suite, ou à appeler quand même"];
    else if (aAppeler) [groupe, action] = ["RAPPELER", "Appeler : nouveau contact"];
    else if (rappelDu) [groupe, action] = ["RAPPELER", lead.tentatives > 0 ? `Rappeler : ${pluriel(lead.tentatives, "appel")} sans réponse` : "Rappeler (rappel prévu)"];
    else if (lead.rappelLe) [groupe, action] = ["PLUS_TARD", "Rappel prévu"];
    else [groupe, action] = ["DECIDER", `${lead.dernierAppelLe ? "Appelé" : "Contacté"}, sans rappel daté : envoyer le lien de son espace, dater un rappel, ou classer`];
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
      // Même retard que la liste « À rappeler » et l'onglet Leads : le rappel est passé.
      enRetard: Boolean(lead.rappelLe && lead.rappelLe < maintenant),
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

    // Mission 14 (R2) : un mail ou un message d'espace sans réponse épingle la main : « Répondre à … », avant l'étape.
    const repondreMessage = dossier.main === "MOI" && estMotifRepondre(dossier.mainMotif);
    let groupe: GroupeAffaire;
    let action: string;
    if (repondre) [groupe, action] = ["REPONDRE", "Répondre à son SMS"];
    else if (repondreMessage) [groupe, action] = ["REPONDRE", dossier.mainMotif!];
    else if (etape === "SIGNE") [groupe, action] = dossier.dateChantier ? ["PLUS_TARD", "Chantier daté : à planifier"] : ["PLANIFIER", "Appeler : fixer la date du chantier, suivre l'acompte"];
    else if (rappelDu) [groupe, action] = ["RAPPELER", dossier.prochaineAction ?? "Rappeler"];
    else if (etape === "QUALIFICATION") [groupe, action] = nbPhotos > 0 ? ["SIMULATION", `Préparer la simulation (${nbPhotos} photo${nbPhotos > 1 ? "s" : ""} reçue${nbPhotos > 1 ? "s" : ""})`] : espace ? ["ATTENTE_PHOTOS", espace.premierAccesLe ? "Attend ses photos (lien consulté)" : "Attend ses photos (lien pas encore ouvert)"] : ["DECIDER", "Envoyer le lien de son espace pour recevoir ses photos"];
    else if (etape === "SIMULATION") [groupe, action] = simulations.length === 0 ? ["SIMULATION", "Préparer la simulation"] : choisie && !devis ? ["DEVIS", "Faire le devis (simulation choisie)"] : ["ATTENTE_SIMULATION", "Attend son retour sur la simulation"];
    else [groupe, action] = ["ATTENTE_DEVIS", `Attend sa signature${devis?.numero ? ` (devis ${devis.numero})` : ""}`];

    // Qui a la main : la règle unique du dossier (dossiers/main.ts) tranche entre « à moi » et « attend le client ».
    const regle = mainDe({ etape, prochaineActionDate: dossier.prochaineActionDate?.toISOString() ?? null, main: dossier.main === "MOI" || dossier.main === "CLIENT" ? dossier.main : null }, maintenant);
    const aMoiSelonRegle = regle === "MOI" || regle === "A_RELANCER";
    const motif = dossier.mainMotif && !dossier.mainMotif.startsWith("Étape «") ? dossier.mainMotif : null;
    if (!aMoiSelonRegle && ["SIMULATION", "DEVIS", "DECIDER"].includes(groupe)) {
      groupe = etape === "QUALIFICATION" && nbPhotos === 0 && simulations.length === 0 ? "ATTENTE_PHOTOS" : etape === "QUALIFICATION" || etape === "SIMULATION" ? "ATTENTE_SIMULATION" : "ATTENTE_DEVIS";
      action = motif ?? action;
    } else if (aMoiSelonRegle && ["ATTENTE_PHOTOS", "ATTENTE_SIMULATION", "ATTENTE_DEVIS"].includes(groupe)) {
      if (regle === "A_RELANCER") [groupe, action] = ["RAPPELER", `Relancer : ${dossier.prochaineAction ?? motif ?? action}`];
      else [groupe, action] = [choisie && !devis ? "DEVIS" : etape === "QUALIFICATION" || etape === "SIMULATION" ? "SIMULATION" : "DECIDER", motif ?? action];
    }
    const main = GROUPES_CLIENT.includes(groupe) ? "CLIENT" : "MOI";
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
