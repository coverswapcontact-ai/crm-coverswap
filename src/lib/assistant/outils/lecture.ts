import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { chargerFiche } from "@/lib/clients/fiches";
import { notesDuLead } from "@/lib/commercial/notes-appel";
import { pilotageCommercial } from "@/lib/commercial/pilotage";
import { controlerCoherence } from "@/lib/coherence/controle";
import { depensesDuDossier } from "@/lib/depenses/service";
import { ETAPES, LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { chargerDetail, listerDossiers } from "@/lib/dossiers/dossiers";
import { listerClientsEspaces } from "@/lib/espace/suivi";
import { rappelConnexionGoogle } from "@/lib/google/connexion";
import { etatIa } from "@/lib/ia/modele";
import { listerVue } from "@/lib/mail/vues";
import { resultatsMeta } from "@/lib/meta/sante";
import { verifierJeton } from "@/lib/meta/taches";
import { lireParametres } from "@/lib/parametres/service";
import { chargerEntrant } from "@/lib/prospects/entrants";
import { listerLeads } from "@/lib/prospects/leads";
import { listerSimulationsDossier } from "@/lib/simulations/dossier";
import { calculerAlertes } from "@/lib/synthese/alertes";
import { calculerSynthese } from "@/lib/synthese/calcul";
import { etatDesTaches } from "@/lib/taches/lecture";
import { lireConsignes, regleDuJour, sectionProtocole } from "../consignes";
import { definirOutil, format, lien, type LienOutil } from "../definition";
import { resoudrePeriode, schemaPeriode } from "../periodes";
import { chercherContacts, trouverUnSeul, type Candidat } from "../recherche";

/**
 * Les outils de lecture (mission 8) : trouver, lire, lister ce qui attend,
 * l'état du système. Tout est rendu en phrases courtes que Claude peut lire
 * à voix haute, avec les données à côté et un lien vers l'élément du CRM.
 */

const ligneCandidat = (c: Candidat) => `${c.type === "DOSSIER" ? "Dossier" : c.type === "CLIENT" ? "Client" : "Lead"} : ${c.nom}${c.ville ? ` (${c.ville})` : ""} — ${c.etat} [${c.type.toLowerCase()}:${c.id}]`;

export const outilChercher = definirOutil({
  nom: "chercher",
  titre: "Chercher un client, un lead ou un dossier",
  description:
    "Cherche par nom (même mal orthographié), téléphone, e-mail ou ville. Rend les candidats avec leur type et leur identifiant (client, lead ou dossier) : c'est le point de départ de tout — lire une fiche, noter un appel, envoyer un lien. S'il y a plusieurs candidats pour un nom, demande à Lucas lequel avant d'agir.",
  niveau: "LECTURE",
  schema: z.object({ texte: z.string().min(1).max(120).describe("Ce que Lucas a dit : « Rousse », « le dossier Forestier », « 06 12 34 56 78 », « Montpellier »."), limite: z.number().int().min(1).max(20).optional() }),
  executer: async ({ texte, limite }) => {
    const candidats = await chercherContacts(texte, { limite: limite ?? 8 });
    if (candidats.length === 0) return { texte: `Rien trouvé pour « ${texte} » : ni client, ni lead, ni dossier. Vérifie l'orthographe, ou cherche par téléphone.` };
    return {
      texte: `${candidats.length} candidat${candidats.length > 1 ? "s" : ""} pour « ${texte} » :\n${candidats.map(ligneCandidat).join("\n")}`,
      donnees: candidats,
      liens: candidats.slice(0, 5).map((c) => lien(c.nom, c.chemin)),
    };
  },
});

/** Une cible désignée par un identifiant, ou par un nom (cherché, avec refus si ambigu). */
export const schemaCible = z.object({
  dossierId: z.string().max(40).optional().describe("Identifiant du dossier, si connu (rendu par « chercher »)."),
  clientId: z.string().max(40).optional().describe("Identifiant du client, si connu."),
  leadId: z.string().max(40).optional().describe("Identifiant du lead, si connu."),
  nom: z.string().max(120).optional().describe("À défaut d'identifiant : le nom tel que Lucas l'a dit."),
});
export type Cible = z.output<typeof schemaCible>;

export class CibleAmbigue extends Error {
  constructor(readonly candidats: Candidat[]) {
    super("Plusieurs contacts correspondent : demande à Lucas lequel.");
  }
}

/** Résout une cible en identifiants ; lève CibleAmbigue (texte lisible) si le nom désigne plusieurs personnes. */
export async function resoudreCible(cible: Cible, type?: "CLIENT" | "LEAD" | "DOSSIER"): Promise<{ dossierId: string | null; clientId: string | null; leadId: string | null; nom: string }> {
  if (cible.dossierId || cible.clientId || cible.leadId) {
    if (cible.dossierId) {
      const d = await prisma.dossier.findUnique({ where: { id: cible.dossierId }, select: { id: true, clientId: true, leadId: true, clientNom: true } });
      if (!d) throw new Error(`Dossier introuvable : ${cible.dossierId}.`);
      return { dossierId: d.id, clientId: d.clientId, leadId: d.leadId, nom: d.clientNom };
    }
    if (cible.clientId) {
      const c = await prisma.client.findUnique({ where: { id: cible.clientId }, select: { id: true, nom: true, dossiers: { where: { archiveLe: null }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 }, leads: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
      if (!c) throw new Error(`Client introuvable : ${cible.clientId}.`);
      return { dossierId: c.dossiers[0]?.id ?? null, clientId: c.id, leadId: c.leads[0]?.id ?? null, nom: c.nom };
    }
    const l = await prisma.lead.findUnique({ where: { id: cible.leadId! }, select: { id: true, prenom: true, nom: true, clientId: true, dossiers: { where: { archiveLe: null }, select: { id: true }, take: 1 } } });
    if (!l) throw new Error(`Lead introuvable : ${cible.leadId}.`);
    return { dossierId: l.dossiers[0]?.id ?? null, clientId: l.clientId, leadId: l.id, nom: `${l.prenom} ${l.nom}`.trim() };
  }
  if (!cible.nom) throw new Error("Indique le nom, ou un identifiant (rendu par « chercher »).");
  const resultat = await trouverUnSeul(cible.nom, type);
  if ("aucun" in resultat) throw new Error(`Aucun contact ne correspond à « ${cible.nom} ».`);
  if ("ambigu" in resultat) throw new CibleAmbigue(resultat.ambigu);
  const t = resultat.trouve;
  return { dossierId: t.dossierId, clientId: t.clientId, leadId: t.leadId, nom: t.nom };
}

export const texteAmbigu = (e: CibleAmbigue) => `Plusieurs contacts correspondent, je ne choisis pas à ta place :\n${e.candidats.map(ligneCandidat).join("\n")}\nDis-moi lequel (ou rappelle l'outil avec son identifiant).`;

function ligneEtape(etape: string) {
  return LIBELLES_ETAPE[etape as EtapeDossier] ?? etape;
}

export const outilLireFiche = definirOutil({
  nom: "lire_fiche",
  titre: "Lire une fiche complète",
  description:
    "Rend tout ce que le CRM sait d'un dossier (étape, qui a la main, prochaine action, devis et factures, paiements, simulations, notes d'appel, dépenses, historique récent), d'un client (coordonnées, dossiers, leads) ou d'un lead (demande, source, réponses au formulaire, échanges). Utilise-le pour « où en est le dossier X ? ». Donne un identifiant ou un nom.",
  niveau: "LECTURE",
  schema: schemaCible,
  executer: async (cible) => {
    let ids;
    try {
      ids = await resoudreCible(cible);
    } catch (e) {
      if (e instanceof CibleAmbigue) return { texte: texteAmbigu(e), donnees: e.candidats };
      throw e;
    }
    const liens: LienOutil[] = [];
    const parties: string[] = [];
    const donnees: Record<string, unknown> = {};
    if (ids.dossierId) {
      const d = await chargerDetail(ids.dossierId);
      const simulations = await listerSimulationsDossier(d.id).catch(() => ({ simulations: [] }));
      const depenses = await depensesDuDossier(d.id).catch(() => ({ depenses: [], total: 0 }));
      const devis = d.documents.filter((x) => x.type === "DEVIS");
      const factures = d.documents.filter((x) => x.type === "FACTURE");
      parties.push(
        `Dossier ${d.clientNom} — ${d.objet} (${d.clientVille}) : étape « ${ligneEtape(d.etape)} », la main est ${d.main === "CLIENT" ? "chez le client" : "à toi"}${d.mainMotif ? ` (${d.mainMotif})` : ""}.`,
        d.prochaineAction ? `Prochaine action : ${d.prochaineAction}${d.prochaineActionDate ? ` le ${format.jour(d.prochaineActionDate)}` : ""}.` : "Pas de prochaine action notée.",
        d.dateChantier ? `Chantier prévu le ${format.jour(d.dateChantier)}.` : "",
        devis.length ? `Devis : ${devis.map((x) => `${x.numero ?? "brouillon"} ${format.euros(x.totalHt)} (${x.statut.toLowerCase()})`).join(", ")}.` : "Aucun devis.",
        factures.length ? `Factures : ${factures.map((x) => `${x.numero ?? "brouillon"} ${format.euros(x.totalHt)} (${x.statut.toLowerCase()})`).join(", ")}.` : "",
        `Paiements : ${d.paiements.encaissements.filter((e) => e.statut === "VALIDE").length} encaissement(s), reste dû ${format.euros(d.paiements.resteDu)}${d.paiements.acompteEnregistre ? ", acompte reçu" : ", acompte pas encore reçu"}.`,
        simulations.simulations.length ? `Simulations : ${simulations.simulations.length} (${simulations.simulations.filter((s) => s.statut === "PUBLIEE").length} publiée(s)${simulations.simulations.some((s) => s.choisie) ? ", une choisie par le client" : ""}).` : "Aucune simulation.",
        depenses.total ? `Dépenses rattachées : ${format.euros(depenses.total)} (${depenses.depenses.length}).` : "",
        d.completude.length ? `À compléter : ${d.completude.map((p) => p.libelle).join(", ")}.` : "",
        d.notes.length ? `Dernière note (${format.jourCourt(d.notes[0].createdAt)}) : ${d.notes[0].contenu.slice(0, 200)}` : "",
        `Derniers événements : ${d.evenements.slice(0, 5).map((e) => `${format.jourCourt(e.date)} ${e.contenu.slice(0, 90)}`).join(" · ")}`
      );
      donnees.dossier = { id: d.id, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, dateChantier: d.dateChantier, documents: d.documents.map((x) => ({ id: x.id, type: x.type, numero: x.numero, totalHt: x.totalHt, statut: x.statut, dateEmission: x.dateEmission })), paiements: d.paiements, simulations: simulations.simulations.map((s) => ({ id: s.id, statut: s.statut, titre: s.titre, choisie: s.choisie })), depenses: depenses.depenses.map((x) => ({ id: x.id, montant: x.montant, fournisseur: x.fournisseur, categorie: x.categorie, payeeLe: x.payeeLe })), notes: d.notes.slice(0, 5), evenements: d.evenements.slice(0, 10), coordonnees: { adresse: d.clientAdresse, cp: d.clientCp, ville: d.clientVille, email: d.clientEmail, telephone: d.clientTelephone } };
      liens.push(lien("Ouvrir le dossier", `/dossiers?dossier=${d.id}`));
    }
    if (ids.clientId) {
      const c = await chargerFiche(ids.clientId).catch(() => null);
      if (c) {
        parties.push(`Client ${c.nom}${c.ville ? ` (${c.ville})` : ""} : ${c.emails.map((e) => e.valeur).join(", ") || "sans e-mail"}, ${c.telephones.map((t) => t.valeur).join(", ") || "sans téléphone"} ; ${c.nbDossiers} dossier(s), ${format.euros(c.montantSigne)} signés ; source ${c.source}.`);
        donnees.client = { id: c.id, nom: c.nom, emails: c.emails.map((e) => e.valeur), telephones: c.telephones.map((t) => t.valeur), dossiers: c.dossiers, leads: c.leads, propositionsEnAttente: c.propositionsEnAttente };
        liens.push(lien("Fiche client", `/clients/${c.id}`));
      }
    }
    if (ids.leadId) {
      const l = await chargerEntrant(ids.leadId).catch(() => null);
      if (l) {
        const notes = await notesDuLead(l.id).catch(() => []);
        parties.push(
          `Lead ${l.nom}${l.ville ? ` (${l.ville})` : ""} reçu le ${format.jourCourt(l.recuLe)} par ${l.source} : ${l.typeProjet.toLowerCase()}, statut ${l.statut.toLowerCase()}${l.priorite ? `, priorité ${l.priorite.toLowerCase()}` : ""}${l.rappelLe ? `, rappel prévu le ${format.jour(l.rappelLe)}` : ""}.`,
          l.message ? `Son message : « ${l.message.slice(0, 300)} »` : "",
          notes.length ? `Notes d'appel : ${notes.slice(0, 3).map((n) => `${format.jourCourt(n.appelLe)}${n.issue ? ` (${n.issue.toLowerCase()})` : ""}${n.etiquettes.length ? ` [${n.etiquettes.join(", ")}]` : ""} ${n.texte.slice(0, 120)}`).join(" · ")}` : "Aucune note d'appel."
        );
        donnees.lead = { id: l.id, nom: l.nom, telephone: l.telephone, email: l.email, ville: l.ville, source: l.source, statut: l.statut, priorite: l.priorite, rappelLe: l.rappelLe, message: l.message, occupation: l.occupation, delaiProjet: l.delaiProjet, echanges: l.echanges.slice(0, 8), notesAppel: notes.slice(0, 8), dossiers: l.dossiers };
        liens.push(lien("Fiche du lead", `/leads?lead=${l.id}`));
      }
    }
    return { texte: parties.filter(Boolean).join("\n"), donnees, liens };
  },
});

export const outilLeadsAAppeler = definirOutil({
  nom: "leads_a_appeler",
  titre: "Les leads à appeler",
  description: "La file d'appels : les leads jamais appelés ou dont le rappel est arrivé à échéance, du plus prioritaire au moins. Rend nom, ville, source, projet, priorité et téléphone. Sert à « qui dois-je appeler ? » et, avec « archiver », à faire le ménage dans la file.",
  niveau: "LECTURE",
  schema: z.object({ limite: z.number().int().min(1).max(50).optional(), toute_la_file: z.boolean().optional().describe("Vrai : tous les leads actifs, pas seulement ceux à appeler maintenant.") }),
  executer: async ({ limite, toute_la_file }) => {
    const liste = await listerLeads({ vue: "ACTIFS", limite: 300 });
    const lignes = (toute_la_file ? liste.lignes : liste.lignes.filter((l) => l.aAppeler)).slice(0, limite ?? 20);
    const texte = lignes.length
      ? `${liste.compteurs.aAppeler} lead(s) à appeler maintenant (${liste.compteurs.actifs} actifs). ${lignes.map((l) => `${l.prenom} ${l.nom}`.trim() + `${l.ville ? ` (${l.ville})` : ""} — ${l.projet}, ${l.libelleSource}${l.priorite ? `, ${l.priorite.toLowerCase()}` : ""}${l.telephone ? `, ${l.telephone}` : ""}${l.attendDepuis ? `, attend depuis ${format.jourCourt(l.attendDepuis)}` : l.rappelLe ? `, rappel ${format.jourCourt(l.rappelLe)}` : ""} [lead:${l.id}]`).join(" · ")}`
      : "Personne à appeler maintenant.";
    return { texte, donnees: lignes.map((l) => ({ id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), ville: l.ville, source: l.source, projet: l.projet, priorite: l.priorite, telephone: l.telephone, recuLe: l.recuLe, appels: l.appels, rappelLe: l.rappelLe, aAppeler: l.aAppeler })), liens: [lien("Leads", "/leads")] };
  },
});

export const outilDossiersParEtape = definirOutil({
  nom: "dossiers_par_etape",
  titre: "Les dossiers, par étape",
  description: "Tous les dossiers en cours, groupés par étape (qualification, simulation, devis envoyé, relance, signé, planifié, chantier, facturé, encaissé), avec qui a la main et la prochaine action. Filtre possible sur une étape.",
  niveau: "LECTURE",
  schema: z.object({ etape: z.enum(ETAPES).optional().describe("Une seule étape, sinon toutes.") }),
  executer: async ({ etape }) => {
    const dossiers = (await listerDossiers()).filter((d) => !etape || d.etape === etape);
    const groupes = new Map<string, typeof dossiers>();
    for (const d of dossiers) groupes.set(d.etape, [...(groupes.get(d.etape) ?? []), d]);
    const texte = [...groupes.entries()]
      .sort((a, b) => ETAPES.indexOf(a[0] as EtapeDossier) - ETAPES.indexOf(b[0] as EtapeDossier))
      .map(([e, liste]) => `${ligneEtape(e)} (${liste.length}) : ${liste.map((d) => `${d.clientNom} — ${d.objet}${d.main === "CLIENT" ? " (chez le client)" : " (à toi)"}${d.prochaineAction ? ` → ${d.prochaineAction}` : ""} [dossier:${d.id}]`).join(" · ")}`)
      .join("\n");
    return { texte: texte || "Aucun dossier.", donnees: dossiers.map((d) => ({ id: d.id, clientNom: d.clientNom, objet: d.objet, ville: d.clientVille, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, montant: d.montantDernierDevis ?? d.montantEstime })), liens: [lien("Dossiers", "/dossiers")] };
  },
});

export const outilCeQuiMAttend = definirOutil({
  nom: "ce_qui_m_attend",
  titre: "Ce qui attend une action de Lucas",
  description: "Tout ce qui attend une action de Lucas aujourd'hui : leads à rappeler, dossiers où la main est à lui (répondre, faire la simulation, le devis, planifier), actions en retard, mails à traiter, propositions à valider. Réponse à « qu'est-ce qui m'attend ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async () => {
    const [pilotage, mails] = await Promise.all([pilotageCommercial(), listerVue("A_TRAITER", { limite: 50 })]);
    const aMoi = pilotage.affaires.filter((a) => a.main === "MOI");
    const enRetard = aMoi.filter((a) => a.enRetard);
    const parGroupe = new Map<string, typeof aMoi>();
    for (const a of aMoi) parGroupe.set(a.groupe, [...(parGroupe.get(a.groupe) ?? []), a]);
    const texte = [
      `${aMoi.length} affaire(s) attendent une action de toi (${enRetard.length} en retard), ${pilotage.compteurs.chezLeClient} chez le client, ${mails.compteurs.A_TRAITER} mail(s) à traiter, ${pilotage.compteurs.relancesAValider} proposition(s) à valider.`,
      ...[...parGroupe.entries()].map(([groupe, liste]) => `${groupe} : ${liste.map((a) => `${a.nom}${a.ville ? ` (${a.ville})` : ""} — ${a.action}${a.enRetard ? " (en retard)" : ""}${a.echeance ? ` · ${format.jourCourt(a.echeance)}` : ""} [${a.dossierId ? `dossier:${a.dossierId}` : `lead:${a.leadId}`}]`).join(" · ")}`),
      mails.lignes.length ? `Mails à traiter : ${mails.lignes.slice(0, 8).map((m) => `${m.correspondant.nom ?? m.correspondant.adresse} — ${m.objet ?? "(sans objet)"}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}`).join(" · ")}` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: { affaires: aMoi, compteurs: pilotage.compteurs, mails: mails.lignes.slice(0, 20) }, liens: [lien("Commercial", "/commercial"), lien("Mail", "/mail")] };
  },
});

export const outilEspacesClients = definirOutil({
  nom: "espaces_clients",
  titre: "Les espaces clients et leur état",
  description: "Chaque client qui a un espace : lien actif ou non, jamais ouvert ou vu récemment, projets en cours, ce qu'il attend (de lui ou de Lucas), signaux (lien jamais ouvert, photos sans simulation, demande d'un projet de plus…).",
  niveau: "LECTURE",
  schema: z.object({ limite: z.number().int().min(1).max(50).optional() }),
  executer: async ({ limite }) => {
    const clients = (await listerClientsEspaces()).slice(0, limite ?? 30);
    const texte = clients.length
      ? clients.map((c) => `${c.clientNom}${c.ville ? ` (${c.ville})` : ""} : ${c.revoque ? "lien désactivé" : c.premierAccesLe ? `vu ${c.nbAcces} fois, dernière visite ${format.jourCourt(c.dernierAccesLe)}` : "jamais ouvert"} ; ${c.projetsEnCours} projet(s) en cours ; ${c.attente.qui === "MOI" ? "attend Lucas" : c.attente.qui === "CLIENT" ? "attend le client" : "rien en attente"} — ${c.attente.libelle}${c.signaux.length ? ` ; signaux : ${c.signaux.map((s) => s.libelle).join(", ")}` : ""} [client:${c.clientId}]`).join("\n")
      : "Aucun espace client ouvert.";
    return { texte, donnees: clients.map((c) => ({ clientId: c.clientId, nom: c.clientNom, ville: c.ville, lien: c.lien, revoque: c.revoque, nbAcces: c.nbAcces, dernierAccesLe: c.dernierAccesLe, attente: c.attente, signaux: c.signaux, projets: c.projets.map((p) => ({ dossierId: p.dossierId, nom: p.nomProjet, etape: p.etape, fige: p.fige })) })), liens: [lien("Espaces clients", "/espaces")] };
  },
});

export const outilMailsATraiter = definirOutil({
  nom: "mails_a_traiter",
  titre: "Les mails à traiter",
  description: "Les conversations de la boîte qui attendent une réponse ou une action (onglet Mail, vue « À traiter »), dans l'ordre de priorité calculé par le CRM (revenus, réclamations, devis en attente par montant, dossiers en cours, leads, échéances, le reste) : qui, objet, pourquoi (attend ta réponse, sans réponse depuis N jours, nouvelle demande, à lire, revenu), intention et ce qui est attendu, cartes en attente, brouillon prêt, contact rattaché. Rend l'identifiant du mail pour « lire_mail », « deposer_brouillon », « envoyer_mail ». Réponse à « qu'est-ce que j'ai à traiter ? » : lis-la dans cet ordre.",
  niveau: "LECTURE",
  schema: z.object({ vue: z.enum(["A_TRAITER", "CLIENTS", "ADMINISTRATIF"]).optional(), limite: z.number().int().min(1).max(50).optional() }),
  executer: async ({ vue, limite }) => {
    const liste = await listerVue(vue ?? "A_TRAITER", { limite: limite ?? 20 });
    const texte = liste.lignes.length
      ? `${liste.compteurs.A_TRAITER} à traiter, ${liste.compteurs.CLIENTS} clients, ${liste.compteurs.ADMINISTRATIF} administratif.\n${liste.lignes.map((m, i) => `${i + 1}. ${m.priorite.libelle ? `[${m.priorite.libelle}${m.priorite.montant !== null ? ` ${format.euros(m.priorite.montant)}` : ""}] ` : ""}${m.correspondant.nom ?? m.correspondant.adresse} — « ${m.objet ?? "(sans objet)"} » ${format.jourCourt(m.recuLe)}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}${m.intention ? ` · ${m.intention.toLowerCase()}${m.attendu ? ` : ${m.attendu}` : ""}` : " · non classé"}${m.propositionsEnAttente ? ` · ${m.propositionsEnAttente} carte(s) à valider` : ""}${m.brouillonPret ? " · brouillon prêt" : ""}${m.contact ? ` · ${m.contact.nom}` : ""} [mail:${m.messageId}]`).join("\n")}`
      : "Rien à traiter dans la boîte.";
    return { texte, donnees: { compteurs: liste.compteurs, mails: liste.lignes.map((m) => ({ messageId: m.messageId, de: m.correspondant, objet: m.objet, extrait: m.extrait, recuLe: m.recuLe, mention: m.mention, classe: m.classe, contact: m.contact, nonLu: m.nonLu, priorite: m.priorite, intention: m.intention, attendu: m.attendu, propositionsEnAttente: m.propositionsEnAttente, brouillonPret: m.brouillonPret, revenu: m.revenu, snoozeJusqua: m.snoozeJusqua })) }, liens: [lien("Mail", "/mail")] };
  },
});

export const outilSynthese = definirOutil({
  nom: "synthese",
  titre: "Synthèse d'une période",
  description: "Leads reçus, dossiers ouverts, devis émis et signés, chiffre d'affaires encaissé, dépenses, pertes et délais sur une période (défaut : 30 derniers jours). La même synthèse que l'écran Synthèse du CRM. Pour des analyses détaillées, préférer les outils « manager_… ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree) => {
    const { periode } = resoudrePeriode(entree);
    const s = await calculerSynthese(periode.du, periode.au);
    const c = s.commercial;
    const texte = [
      `Synthèse ${periode.libelle} (${periode.du} → ${periode.au}) :`,
      c.entrants ? `${c.entrants.recus} lead(s) reçus (${c.entrants.parSource.map((p) => `${p.libelle} ${p.recus}`).join(", ")}), ${c.entrants.contactes} contactés, ${c.entrants.avecDossier} avec dossier, ${c.entrants.signes} signés.` : "",
      `${c.cohorte.ouverts} dossier(s) ouverts sur la période : ${c.cohorte.devisEnvoyes} devis envoyés, ${c.cohorte.signes} signés, ${c.cohorte.encaisses} encaissés, ${c.cohorte.perdus} perdus (taux de signature ${format.pourcent(c.cohorte.tauxSignatureDevis)}).`,
      `Activité : ${c.activite.devisEmis} devis émis (${format.euros(c.activite.montantDevis)}), ${c.activite.signatures} signature(s) (${format.euros(c.activite.montantSigne)}), ${c.activite.facturesEmises} facture(s) (${format.euros(c.activite.montantFacture)}), ${c.activite.pertes} perte(s).`,
      s.finances.encaisse === null ? `Encaissé : paramètres manquants (${s.finances.parametresManquants.join(", ")}).` : `Encaissé ${format.euros(s.finances.encaisse)}, dépenses ${format.euros(s.finances.depenses)}${s.finances.margeBrute !== null ? `, marge brute ${format.euros(s.finances.margeBrute)}` : ""}${s.finances.panierMoyenSigne !== null ? `, panier moyen signé ${format.euros(s.finances.panierMoyenSigne)}` : ""}. En cours de règlement : ${format.euros(s.finances.encours.total)}.`,
      c.pertes.parMotif.length ? `Pertes par motif : ${c.pertes.parMotif.map((p) => `${p.libelle} ${p.valeur}`).join(", ")}.` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: { periode, commercial: s.commercial, finances: s.finances, clients: s.clients }, liens: [lien("Synthèse", `/synthese?du=${periode.du}&au=${periode.au}`)] };
  },
});

/** L'état de la campagne : jour, dépense estimée, leads, coût par lead, règle du protocole. */
export async function etatCampagne(maintenant: Date = new Date()) {
  const valeurs = await lireParametres(["CAMPAGNE_DEBUT", "CAMPAGNE_BUDGET", "CAMPAGNE_DUREE_JOURS"], maintenant);
  const debut = typeof valeurs.CAMPAGNE_DEBUT === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valeurs.CAMPAGNE_DEBUT) ? valeurs.CAMPAGNE_DEBUT : null;
  const budget = typeof valeurs.CAMPAGNE_BUDGET === "number" ? valeurs.CAMPAGNE_BUDGET : null;
  const duree = typeof valeurs.CAMPAGNE_DUREE_JOURS === "number" && valeurs.CAMPAGNE_DUREE_JOURS > 0 ? valeurs.CAMPAGNE_DUREE_JOURS : 21;
  const jour = debut ? Math.floor((maintenant.getTime() - new Date(`${debut}T00:00:00+02:00`).getTime()) / 86_400_000) + 1 : null;
  const enCours = jour !== null && jour >= 1 && jour <= duree;
  const jours = enCours && jour ? jour : 7;
  const resultats = await resultatsMeta(jours);
  const consignes = await lireConsignes();
  const protocole = sectionProtocole(consignes.texte);
  const regle = enCours && jour ? regleDuJour(protocole, jour) : null;
  const depenseEstimee = enCours && budget !== null && jour ? Math.round((budget * Math.min(jour, duree)) / duree) : null;
  const coutParLead = depenseEstimee !== null && resultats.leads > 0 ? Math.round((depenseEstimee / resultats.leads) * 100) / 100 : null;
  return { debut, budget, duree, jour, enCours, depenseEstimee, leads: resultats.leads, coutParLead, parCampagne: resultats.parCampagne, parPublicite: resultats.parPublicite, regle, protocole, fenetreJours: jours };
}

export const outilCampagne = definirOutil({
  nom: "campagne",
  titre: "L'état de la campagne publicitaire",
  description: "Jour de campagne (« jour 3 sur 21 »), dépense estimée au prorata du budget (le CRM ne lit pas la dépense réelle chez Meta), leads Meta reçus, coût par lead estimé, résultats par campagne et par publicité, et la règle du protocole qui s'applique ce jour (consignes). Les paramètres de campagne (début, budget, durée) se posent dans Paramètres → Campagne publicitaire.",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const e = await etatCampagne(contexte.maintenant);
    const texte = e.debut
      ? `Campagne commencée le ${format.jourCourt(e.debut)} : ${e.enCours ? `jour ${e.jour} sur ${e.duree}` : e.jour !== null && e.jour > e.duree ? `terminée (jour ${e.jour}, durée ${e.duree})` : "pas encore commencée"}. Budget ${e.budget !== null ? format.euros(e.budget) : "non renseigné"}${e.depenseEstimee !== null ? `, dépense estimée ${format.euros(e.depenseEstimee)} (prorata, pas la dépense réelle Meta)` : ""}. ${e.leads} lead(s) Meta sur ${e.fenetreJours} jour(s)${e.coutParLead !== null ? `, soit ≈ ${format.euros(e.coutParLead)} par lead` : ""}. ${e.parPublicite.length ? `Par publicité : ${e.parPublicite.map((p) => `${p.nom} ${p.leads} lead(s), ${p.devis} devis, ${p.signes} signé(s)`).join(" · ")}.` : ""} ${e.regle ? `Règle du jour : ${e.regle}` : "Aucune règle trouvée pour ce jour dans le protocole des consignes."}`
      : `Aucune campagne renseignée (Paramètres → Campagne publicitaire : début, budget, durée). Sur 7 jours : ${e.leads} lead(s) Meta${e.parPublicite.length ? ` (${e.parPublicite.map((p) => `${p.nom} ${p.leads}`).join(", ")})` : ""}.`;
    return { texte, donnees: e, liens: [lien("Publicité", "/publicite"), lien("Paramètres", "/parametres")] };
  },
});

/** L'état de santé du système : tâches, connexions, jetons, crédits, disque, cohérence, alertes. */
export async function santeSysteme(maintenant: Date = new Date()) {
  const [taches, google, meta, ia, alertes, coherence] = await Promise.all([etatDesTaches(), rappelConnexionGoogle(maintenant).catch(() => null), verifierJeton().catch(() => null), etatIa(maintenant, "IA_REDACTION").catch(() => null), calculerAlertes(maintenant).catch(() => []), controlerCoherence().catch(() => null)]);
  let disqueLibreMo: number | null = null;
  try {
    const { fichierDeLaBase, placeLibre } = await import("@/lib/base/sauvegarde.mjs");
    const fichier = fichierDeLaBase();
    if (fichier) disqueLibreMo = Math.round(placeLibre(fichier.replace(/[\\/][^\\/]+$/, "")) / 1_048_576);
  } catch {
    disqueLibreMo = null;
  }
  const echecs = taches.taches.filter((t) => t.statut === "ECHEC_DEFINITIF");
  const travauxEnEchec = taches.planifications.filter((p) => p.dernierStatut === "ECHEC");
  return {
    taches: { enEchec: echecs.map((t) => ({ type: t.type, libelle: t.libelle, erreur: t.derniereErreur })), enAttente: taches.compteurs.EN_ATTENTE, travauxEnEchec: travauxEnEchec.map((p) => ({ nom: p.nom, erreur: p.derniereErreur })) },
    google: google ? { niveau: google.niveau, coupee: google.coupee, compte: google.compte } : null,
    meta: meta ? { etat: meta.etat, message: meta.message, echeance: meta.echeance } : null,
    ia: ia ? { active: ia.active, raison: ia.raison, cleApi: ia.cleApi, depenseMois: ia.depenseMois, budget: ia.budget } : null,
    disqueLibreMo,
    coherence: coherence ? { dossiersControles: coherence.dossiersControles, incoherences: coherence.incoherences.map((i) => ({ code: i.code, gravite: i.gravite, client: i.client, message: i.constat })) } : null,
    alertes: alertes.map((a) => ({ gravite: a.gravite, titre: a.titre, detail: a.detail, lien: a.lien })),
  };
}

export const outilSanteSysteme = definirOutil({
  nom: "sante_systeme",
  titre: "Santé du système et alertes",
  description: "Tâches de fond en échec, connexion Google (jeton qui expire), jeton Meta, IA (clé, budget du mois), place disque, incohérences du contrôle quotidien, alertes du CRM (devis sans réponse, dossiers en retard…). Réponse à « tout va bien ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const s = await santeSysteme(contexte.maintenant);
    const texte = [
      s.taches.enEchec.length ? `${s.taches.enEchec.length} tâche(s) en échec : ${s.taches.enEchec.map((t) => `${t.libelle}${t.erreur ? ` (${t.erreur.slice(0, 80)})` : ""}`).join(" · ")}.` : "Aucune tâche en échec.",
      s.taches.travauxEnEchec.length ? `Travaux périodiques en échec : ${s.taches.travauxEnEchec.map((p) => p.nom).join(", ")}.` : "",
      s.google ? `Google : ${s.google.coupee ? "COUPÉ, reconnecter dans Paramètres" : `jeton ${s.google.niveau.toLowerCase()}`}${s.google.compte ? ` (${s.google.compte})` : ""}.` : "Google : rien à signaler.",
      s.meta ? `Meta : ${s.meta.message}` : "",
      s.ia ? `IA : ${s.ia.active ? `active, ${format.euros(s.ia.depenseMois)} dépensés ce mois${s.ia.budget !== null ? ` sur ${format.euros(s.ia.budget)}` : ""}` : `inactive (${s.ia.raison ?? "réglages manquants"})`}${s.ia.cleApi ? "" : " ; clé Anthropic absente du serveur"}.` : "",
      s.disqueLibreMo !== null ? `Disque : ${s.disqueLibreMo} Mo libres${s.disqueLibreMo < 100 ? " — ATTENTION, volume presque plein" : ""}.` : "",
      s.coherence ? (s.coherence.incoherences.length ? `Cohérence : ${s.coherence.incoherences.length} incohérence(s) sur ${s.coherence.dossiersControles} dossiers : ${s.coherence.incoherences.map((i) => i.message).join(" · ")}` : `Cohérence : rien à signaler (${s.coherence.dossiersControles} dossiers contrôlés).`) : "",
      s.alertes.length ? `Alertes : ${s.alertes.map((a) => `[${a.gravite}] ${a.titre} — ${a.detail}`).join(" · ")}` : "Aucune alerte.",
    ].filter(Boolean).join("\n");
    return { texte, donnees: s, liens: [lien("Tâches de fond", "/taches"), lien("Paramètres", "/parametres")] };
  },
});

export const OUTILS_LECTURE = [outilChercher, outilLireFiche, outilLeadsAAppeler, outilDossiersParEtape, outilCeQuiMAttend, outilEspacesClients, outilMailsATraiter, outilSynthese, outilCampagne, outilSanteSysteme];
