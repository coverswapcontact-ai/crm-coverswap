import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { chargerFiche } from "@/lib/clients/fiches";
import { notesDuLead } from "@/lib/commercial/notes-appel";
import { compterMailATraiter } from "@/lib/a-faire/ecran";
import { listeTaches } from "@/lib/a-faire/lecture";
import { controlerCoherence } from "@/lib/coherence/controle";
import { depensesDuDossier } from "@/lib/depenses/service";
import { ETAPES, LIBELLES_ETAPE, LIBELLES_STATUT_DOCUMENT, type EtapeDossier } from "@/lib/dossiers/constants";
import { resumerSelection, sousPartieDeCle } from "@/lib/prestations/prestations";
import { chargerDetail, listerDossiers } from "@/lib/dossiers/dossiers";
import { mainDe } from "@/lib/dossiers/pilotage";
import { compterMessagesNonLus } from "@/lib/espace/messages";
import { listerClientsEspaces } from "@/lib/espace/suivi";
import { etatConnexionGoogle, rappelConnexionGoogle } from "@/lib/google/connexion";
import { etatIa } from "@/lib/ia/modele";
import { listerVue } from "@/lib/mail/vues";
import { resultatsMeta } from "@/lib/meta/sante";
import { resumeChaineMeta } from "@/lib/meta/sante";
import { lireParametres } from "@/lib/parametres/service";
import { chargerEntrant } from "@/lib/prospects/entrants";
import { listerLeads } from "@/lib/prospects/leads";
import { LIBELLES_ISSUE } from "@/lib/commercial/constantes";
import { issueDuContenu } from "@/lib/commercial/sans-reponse";
import { relancesPhotosProposables } from "@/lib/relances/photos";
import { listerSimulationsDossier } from "@/lib/simulations/dossier";
import { calculerAlertes } from "@/lib/synthese/alertes";
import { calculerSynthese } from "@/lib/synthese/calcul";
import { etatAvisGoogle } from "@/lib/site/avis-google";
import { texteEntonnoirParFamille } from "@/lib/site/familles-source";
import { etatDesTaches } from "@/lib/taches/lecture";
import { lireConsignes, regleDuJour, sectionProtocole } from "../consignes";
import { definirOutil, format, lien, type LienOutil } from "../definition";
import { resoudrePeriode, schemaPeriode } from "../periodes";
import { chercherContacts, trouverUnSeul, type Candidat } from "../recherche";
import { titreDossier } from "@/lib/commun/format";
import { accord, jourSemaineHeure, pluriel } from "@/lib/commun/format";

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
    "Cherche par nom (même mal orthographié), téléphone, e-mail, ville, adresse (« 30 boulevard Joliot-Curie ») ou numéro de devis / facture (« 2026-037 »). Rend les candidats avec leur type et leur identifiant (client, lead ou dossier) : c'est le point de départ de tout — lire une fiche, noter un appel, envoyer un lien. S'il y a plusieurs candidats pour un nom, demande à Lucas lequel avant d'agir.",
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

/**
 * Mission 14 (partie 8) : qui a la main, par la règle unique (`dossiers/pilotage.ts › mainDe` : étape, main rangée,
 * retard) — « à toi », « à toi : à relancer » (l'étape attend le client mais la prochaine action est dépassée),
 * « chez le client », « personne » (dossier perdu ou encaissé). Les mêmes mots dans « lire_fiche » et « dossiers_par_etape ».
 */
function quiALaMain(d: { etape: string; prochaineActionDate: string | null; main: "MOI" | "CLIENT" | null }, maintenant: Date): string {
  const main = mainDe({ etape: d.etape as EtapeDossier, prochaineActionDate: d.prochaineActionDate, main: d.main }, maintenant);
  return main === "AUCUNE" ? "personne" : main === "MOI" ? "à toi" : main === "A_RELANCER" ? "à toi : à relancer" : "chez le client";
}

export const outilLireFiche = definirOutil({
  nom: "lire_fiche",
  titre: "Lire une fiche complète",
  description:
    "Rend tout ce que le CRM sait d'un dossier (étape, qui a la main, prochaine action, devis et factures, paiements, simulations, notes d'appel, dépenses, historique récent), d'un client (coordonnées, dossiers, leads) ou d'un lead (demande, source, réponses au formulaire, échanges). Utilise-le pour « où en est le dossier X ? ». Donne un identifiant ou un nom.",
  niveau: "LECTURE",
  schema: schemaCible,
  executer: async (cible, contexte) => {
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
      const main = quiALaMain(d, contexte.maintenant);
      parties.push(
        `Dossier ${titreDossier(d)} (${d.clientVille}) : étape « ${ligneEtape(d.etape)} », la main est ${main === "personne" ? "à personne" : main}${d.mainMotif ? ` (${d.mainMotif})` : ""}.`,
        d.prochaineAction ? `Prochaine action : ${d.prochaineAction}${d.prochaineActionDate ? ` le ${format.jour(d.prochaineActionDate)}` : ""}.` : "Pas de prochaine action notée.",
        d.dateChantier ? `Chantier prévu le ${format.jour(d.dateChantier)}${d.dateFinChantier ? `, fin le ${format.jour(d.dateFinChantier)}` : ""}.` : "",
        d.dateSouhaitee ? `Date souhaitée par le client : ${format.jour(d.dateSouhaitee)}.` : "",
        Object.keys(d.prestations).length ? `Projet : ${resumerSelection(d.prestations)}${Object.keys(d.teintes).length ? ` ; teintes : ${Object.entries(d.teintes).map(([cle, t]) => `${sousPartieDeCle(cle)?.sousPartie.libelle ?? cle} ${t}`).join(", ")}` : ""}.` : "",
        devis.length ? `Devis (${devis.length}) : ${devis.map((x) => `${x.numero ?? "brouillon"}${x.libelleVariante ? ` « ${x.libelleVariante} »` : ""} ${format.euros(x.totalHt)} (${(LIBELLES_STATUT_DOCUMENT[x.statut] ?? x.statut).toLowerCase()}${x.visibleEspace === false ? ", masqué dans l'espace" : ""})`).join(", ")}.` : "Aucun devis.",
        factures.length ? `Factures : ${factures.map((x) => `${x.numero ?? "brouillon"} ${format.euros(x.totalHt)} (${x.statut.toLowerCase()})`).join(", ")}.` : "",
        `Paiements : ${pluriel(d.paiements.encaissements.filter((e) => e.statut === "VALIDE").length, "encaissement")}, reste dû ${format.euros(d.paiements.resteDu)}${d.paiements.acompteEnregistre ? ", acompte reçu" : ", acompte pas encore reçu"}.`,
        simulations.simulations.length ? `Simulations : ${simulations.simulations.length} (${pluriel(simulations.simulations.filter((s) => s.statut === "PUBLIEE").length, "publiée")}${simulations.simulations.some((s) => s.choisie) ? ", une choisie par le client" : ""}).` : "Aucune simulation.",
        depenses.total ? `Dépenses rattachées : ${format.euros(depenses.total)} (${depenses.depenses.length}).` : "",
        d.completude.length ? `À compléter : ${d.completude.map((p) => p.libelle).join(", ")}.` : "",
        d.notes.length ? `Dernière note (${format.jourCourt(d.notes[0].createdAt)}) : ${d.notes[0].contenu.slice(0, 200)}` : "",
        `Derniers événements : ${d.evenements.slice(0, 5).map((e) => `${format.jourCourt(e.date)} ${e.contenu.slice(0, 90)}`).join(" · ")}`
      );
      donnees.dossier = { id: d.id, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, dateChantier: d.dateChantier, dateSouhaitee: d.dateSouhaitee, dateFinChantier: d.dateFinChantier, montantEstime: d.montantEstime, prestations: d.prestations, teintes: d.teintes, documents: d.documents.map((x) => ({ id: x.id, type: x.type, numero: x.numero, libelle: x.libelleVariante, visibleEspace: x.visibleEspace, totalHt: x.totalHt, statut: x.statut, dateEmission: x.dateEmission })), paiements: d.paiements, simulations: simulations.simulations.map((s) => ({ id: s.id, statut: s.statut, titre: s.titre, choisie: s.choisie })), depenses: depenses.depenses.map((x) => ({ id: x.id, montant: x.montant, fournisseur: x.fournisseur, categorie: x.categorie, payeeLe: x.payeeLe })), notes: d.notes.slice(0, 5), evenements: d.evenements.slice(0, 10), coordonnees: { adresse: d.clientAdresse, cp: d.clientCp, ville: d.clientVille, email: d.clientEmail, telephone: d.clientTelephone } };
      liens.push(lien("Ouvrir le dossier", `/dossiers?dossier=${d.id}`));
    }
    if (ids.clientId) {
      const c = await chargerFiche(ids.clientId).catch(() => null);
      if (c) {
        parties.push(`Client ${c.nom}${c.ville ? ` (${c.ville})` : ""} : ${c.emails.map((e) => e.valeur).join(", ") || "sans e-mail"}, ${c.telephones.map((t) => t.valeur).join(", ") || "sans téléphone"} ; ${pluriel(c.nbDossiers, "dossier")}, ${format.euros(c.montantSigne)} signés ; source ${c.source}.`);
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
          [l.occupation ? `Occupation : ${l.occupation.toLowerCase()}` : null, l.delaiProjet ? `Délai du projet : ${l.delaiProjet.toLowerCase()}` : null].filter(Boolean).join(" · "),
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
  description: "La liste « À appeler » de l'écran Leads : les leads jamais appelés ni contactés par écrit, le plus récent en haut (même ordre que l'écran ; les « à écarter » y figurent, avec leur priorité). Rend nom, ville, source, projet, priorité et téléphone. Les leads déjà appelés, contactés par écrit (SMS copié, mail parti) ou avec un rappel daté sont dans « À rappeler », pas ici. Sert à « qui dois-je appeler ? » et, avec « archiver », à faire le ménage.",
  niveau: "LECTURE",
  schema: z.object({ limite: z.number().int().min(1).max(50).optional() }),
  executer: async ({ limite }) => {
    // Mission 14 (partie 3) : la liste « À appeler » seule, dans l'ordre de l'écran, coupée côté serveur.
    const liste = await listerLeads({ vue: "A_APPELER", limite: limite ?? 20 });
    const { aAppeler, aRappeler, enRetard } = liste.compteurs;
    const ailleurs = `${pluriel(aRappeler, "lead")} dans « À rappeler »${enRetard ? `, dont ${enRetard} en retard` : ""}`;
    const texte = liste.lignes.length
      ? `${pluriel(aAppeler, "lead")} à appeler, jamais ${accord(aAppeler, "appelé")} (${ailleurs}). ${liste.lignes.map((l) => `${l.nom}${l.ville ? ` (${l.ville})` : ""} — ${l.projet}, ${l.libelleSource}${l.priorite ? `, ${l.priorite.toLowerCase()}` : ""}${l.telephone ? `, ${l.telephone}` : ""}, arrivé le ${format.jourCourt(l.attendDepuis ?? l.recuLe)} [lead:${l.id}]`).join(" · ")}`
      : aRappeler
        ? `Personne dans « À appeler » (${ailleurs}).`
        : "Aucun lead en attente d'appel : « À appeler » et « À rappeler » sont vides.";
    return { texte, donnees: liste.lignes.map((l) => ({ id: l.id, nom: l.nom, ville: l.ville, source: l.source, projet: l.projet, priorite: l.priorite, telephone: l.telephone, recuLe: l.recuLe, attendDepuis: l.attendDepuis })), liens: [lien("Leads", "/leads?liste=appeler")] };
  },
});

export const outilLeadsARappeler = definirOutil({
  nom: "leads_a_rappeler",
  titre: "Les leads à rappeler",
  description:
    "La liste « À rappeler » de l'écran Leads, dans le même ordre : les leads déjà appelés, contactés par écrit (SMS copié, mail parti) ou avec un rappel daté — d'abord les rappels datés du plus ancien au plus lointain (les retards en tête, marqués EN RETARD), puis les rappels sans date, le plus ancien appel d'abord. Par lead : nom, ville, source, téléphone, tentatives (appels sans réponse d'affilée), le rappel (« jeu. 1 oct. 18:00 » ou « sans date ») et le dernier appel (date, issue). Réponse à « qui dois-je rappeler ? ». Les jamais appelés sont dans « leads_a_appeler ». Pages de 20 (« limite », « page »).",
  niveau: "LECTURE",
  schema: z.object({ limite: z.number().int().min(1).max(50).optional().describe("Lignes par page (20 par défaut)."), page: z.number().int().min(1).optional().describe("Page à lire (1 par défaut).") }),
  executer: async ({ limite, page }, contexte) => {
    // Mission 14 (partie 8) : la liste « À rappeler » seule, triée et paginée côté serveur comme l'écran.
    const liste = await listerLeads({ vue: "A_RAPPELER", page: page ?? 1, parPage: limite ?? 20 }, contexte.maintenant);
    const { aRappeler, enRetard, aujourdhui } = liste.compteurs;
    const total = liste.total ?? liste.lignes.length;
    const pages = Math.max(1, Math.ceil(total / (liste.parPage || 1)));
    const entete = `${pluriel(aRappeler, "lead")} à rappeler dont ${enRetard} en retard, ${aujourdhui} aujourd'hui${pages > 1 ? ` (page ${liste.page} sur ${pages})` : ""}`;
    const ligne = (l: (typeof liste.lignes)[number]) => {
      const issue = l.dernierAppel ? issueDuContenu(l.dernierAppel.contenu) : null;
      const dernierAppelLe = l.dernierAppelLe ?? l.dernierAppel?.le ?? null;
      // Mission 17 (partie A) : sans appel, le contact écrit (SMS copié, mail parti) qui l'a fait passer ici.
      const dernier = dernierAppelLe ? `dernier appel ${jourSemaineHeure(dernierAppelLe)}${issue ? ` (${LIBELLES_ISSUE[issue].toLowerCase()})` : ""}` : l.dernierContactLe ? `aucun appel noté, contacté par écrit le ${jourSemaineHeure(l.dernierContactLe)}` : "aucun appel noté";
      const rappel = l.rappelLe ? `rappel ${jourSemaineHeure(l.rappelLe)}${l.enRetard ? " EN RETARD" : ""}` : "rappel sans date";
      return `- ${l.nom}${l.ville ? ` (${l.ville})` : ""} — ${l.libelleSource}, ${l.telephone ?? "numéro illisible"}, ${pluriel(l.tentatives, "tentative")}, ${rappel}, ${dernier} [lead:${l.id}]`;
    };
    const texte = liste.lignes.length ? `${entete} :\n${liste.lignes.map(ligne).join("\n")}` : aRappeler ? `${entete} : cette page est vide.` : "Personne dans « À rappeler ».";
    return { texte, donnees: { compteurs: liste.compteurs, page: liste.page, pages, total, lignes: liste.lignes }, liens: [lien("Leads", "/leads?liste=rappeler")] };
  },
});

export const outilDossiersParEtape = definirOutil({
  nom: "dossiers_par_etape",
  titre: "Les dossiers, par étape",
  description: "Tous les dossiers en cours, groupés par étape (qualification, simulation, devis envoyé, relance, signé, planifié, chantier, facturé, encaissé), avec qui a la main et la prochaine action. Filtre possible sur une étape.",
  niveau: "LECTURE",
  schema: z.object({ etape: z.enum(ETAPES).optional().describe("Une seule étape, sinon toutes.") }),
  executer: async ({ etape }, contexte) => {
    const dossiers = (await listerDossiers()).filter((d) => !etape || d.etape === etape);
    const groupes = new Map<string, typeof dossiers>();
    for (const d of dossiers) groupes.set(d.etape, [...(groupes.get(d.etape) ?? []), d]);
    // Mission 14 (partie 8) : la règle unique de la main — un dossier perdu ou encaissé n'est à personne, un retard chez le client est à relancer.
    const texte = [...groupes.entries()]
      .sort((a, b) => ETAPES.indexOf(a[0] as EtapeDossier) - ETAPES.indexOf(b[0] as EtapeDossier))
      .map(([e, liste]) => `${ligneEtape(e)} (${liste.length}) : ${liste.map((d) => `${titreDossier(d)} (${quiALaMain(d, contexte.maintenant)})${d.prochaineAction ? ` → ${d.prochaineAction}` : ""} [dossier:${d.id}]`).join(" · ")}`)
      .join("\n");
    return { texte: texte || "Aucun dossier.", donnees: dossiers.map((d) => ({ id: d.id, clientNom: d.clientNom, objet: d.objet, ville: d.clientVille, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, montant: d.montantDernierDevis ?? d.montantEstime })), liens: [lien("Dossiers", "/dossiers")] };
  },
});

export const outilCeQuiMAttend = definirOutil({
  nom: "ce_qui_m_attend",
  titre: "Ce qui attend une action de Lucas",
  description:
    "La liste des tâches de Lucas en entier — aujourd'hui (les 10 du jour, avec le geste prêt et le texte des SMS et mails), les lots de ménage, « plus tard » (avec la date de retour) et ce qui est fait aujourd'hui —, puis les mails à traiter, les propositions à valider et les messages d'espace non lus. Réponse à « qu'est-ce qui m'attend ? » ; pour « qu'est-ce que j'ai à faire ? » ou « j'ai 20 minutes », préfère « taches ». Garde l'identifiant [tache:…] de la dernière tâche citée : « c'est fait » → « repondre_tache ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    // Import à l'appel : « taches » importe « schemaCible » d'ici (pas de cycle au chargement).
    const { texteListe } = await import("./taches");
    // Mission 17 (partie A, relecture) : le nombre de mails à traiter est celui de l'onglet Mail (les tâches du mail et de
    // l'espace : a-faire/ecran.ts › compterMailATraiter) — un seul compteur partout.
    const [liste, mails, mailsATraiter, messagesNonLus, propositionsEnAttente] = await Promise.all([
      listeTaches(contexte.maintenant),
      listerVue("A_TRAITER", { limite: 50 }),
      compterMailATraiter(contexte.maintenant),
      compterMessagesNonLus(),
      prisma.proposition.count({ where: { statut: "EN_ATTENTE", archiveLe: null } }),
    ]);
    const { texte: texteTaches, aujourdhui } = await texteListe(liste, contexte.maintenant);
    const texte = [
      texteTaches,
      `Aussi : ${pluriel(mailsATraiter, "mail")} à traiter, ${pluriel(propositionsEnAttente, "proposition")} à valider (cartes de mise à jour, relances, règles), ${pluriel(messagesNonLus, "message d'espace non lu", "messages d'espace non lus")}${messagesNonLus ? " (« messages_espace »)" : ""}.`,
      mails.lignes.length ? `Mails à traiter : ${mails.lignes.slice(0, 8).map((m) => `${m.correspondant.nom ?? m.correspondant.adresse} — ${m.objet ?? "(sans objet)"}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}`).join(" · ")}` : "",
    ].filter(Boolean).join("\n");
    return {
      texte,
      donnees: {
        genereLe: liste.genereLe,
        compteurs: { ...liste.compteurs, demain: liste.demain, mailsATraiter, messagesEspaceNonLus: messagesNonLus, propositionsEnAttente },
        aujourdhui,
        lots: liste.lots,
        plusTard: liste.plusTard,
        faitAujourdhui: liste.faitAujourdhui,
        mails: mails.lignes.slice(0, 20),
      },
      liens: [lien("Tâches", "/taches"), lien("Mail", "/mail"), ...(propositionsEnAttente ? [lien("À valider", "/validation")] : [])],
    };
  },
});

export const outilEspacesClients = definirOutil({
  nom: "espaces_clients",
  titre: "Les espaces clients et leur état",
  description:
    "Chaque client qui a un espace : lien actif ou non, jamais ouvert ou vu récemment, projets en cours, ce qu'il attend (de lui ou de Lucas), signaux (lien jamais ouvert, photos sans simulation, demande d'un projet de plus…). Avec « sans_photo_ni_simulation_depuis_jours » (N) : seulement les projets d'espace ouverts depuis N jours sans aucune photo ni simulation (la règle de la relance photos, N à la place de DELAI_RELANCE_PHOTOS), avec le téléphone et le SMS du lien à copier (LIEN_ESPACE_RAPPEL, ou LIEN_ESPACE si le lien ne lui a jamais été communiqué) ; une fois envoyé : « noter_sms ».",
  niveau: "LECTURE",
  schema: z.object({
    limite: z.number().int().min(1).max(50).optional(),
    sans_photo_ni_simulation_depuis_jours: z.number().int().min(1).max(60).optional().describe("N : ne rend que les projets d'espace sans photo ni simulation depuis N jours, avec téléphone et SMS."),
  }),
  executer: async ({ limite, sans_photo_ni_simulation_depuis_jours: jours }, contexte) => {
    if (jours) {
      // Mission 14 (partie 8) : la règle de la relance photos (relances/photos.ts), avec N à la place du paramètre.
      const projets = (await relancesPhotosProposables(contexte.maintenant, { delai: jours })).slice(0, limite ?? 30);
      const ligne = (p: (typeof projets)[number]) =>
        `- ${p.clientNom} : espace ouvert il y a ${pluriel(p.joursDepuisOuverture, "jour")}, ni photo ni simulation${p.lienCommunique ? "" : " (lien jamais envoyé)"}, ${p.sms?.telephone ?? "numéro inconnu"} — ${p.sms ? `SMS (${p.sms.code}) : « ${p.sms.texte} »` : "SMS indisponible (voir la fiche du dossier)"} [dossier:${p.dossierId}]`;
      const texte = projets.length ? `${pluriel(projets.length, "projet d'espace", "projets d'espace")} sans photo ni simulation depuis ${pluriel(jours, "jour")} (rien n'est envoyé : Lucas copie le SMS, puis « noter_sms ») :\n${projets.map(ligne).join("\n")}` : `Aucun projet d'espace sans photo ni simulation depuis ${pluriel(jours, "jour")}.`;
      return { texte, donnees: projets, liens: [lien("Espaces clients", "/espaces")] };
    }
    const clients = (await listerClientsEspaces(contexte.maintenant)).slice(0, limite ?? 30);
    const texte = clients.length
      ? clients.map((c) => `${c.clientNom}${c.ville ? ` (${c.ville})` : ""} : ${c.revoque ? "lien désactivé" : c.premierAccesLe ? `vu ${c.nbAcces} fois, dernière visite ${format.jourCourt(c.dernierAccesLe)}` : "jamais ouvert"} ; ${pluriel(c.projetsEnCours, "projet")} en cours ; ${c.attente.qui === "MOI" ? "attend Lucas" : c.attente.qui === "CLIENT" ? "attend le client" : "rien en attente"} — ${c.attente.libelle}${c.signaux.length ? ` ; signaux : ${c.signaux.map((s) => s.libelle).join(", ")}` : ""} [client:${c.clientId}]`).join("\n")
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
      ? `${liste.compteurs.A_TRAITER} à traiter, ${liste.compteurs.CLIENTS} clients, ${liste.compteurs.ADMINISTRATIF} administratif.\n${liste.lignes.map((m, i) => `${i + 1}. ${m.priorite.libelle ? `[${m.priorite.libelle}${m.priorite.montant !== null ? ` ${format.euros(m.priorite.montant)}` : ""}] ` : ""}${m.correspondant.nom ?? m.correspondant.adresse} — « ${m.objet ?? "(sans objet)"} » ${format.jourCourt(m.recuLe)}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}${m.intention ? ` · ${m.intention.toLowerCase()}${m.attendu ? ` : ${m.attendu}` : ""}` : " · non classé"}${m.propositionsEnAttente ? ` · ${pluriel(m.propositionsEnAttente, "carte")} à valider` : ""}${m.brouillonPret ? " · brouillon prêt" : ""}${m.contact ? ` · ${m.contact.nom}` : ""} [mail:${m.messageId}]`).join("\n")}`
      : "Rien à traiter dans la boîte.";
    return { texte, donnees: { compteurs: liste.compteurs, mails: liste.lignes.map((m) => ({ messageId: m.messageId, de: m.correspondant, objet: m.objet, extrait: m.extrait, recuLe: m.recuLe, mention: m.mention, classe: m.classe, contact: m.contact, nonLu: m.nonLu, priorite: m.priorite, intention: m.intention, attendu: m.attendu, propositionsEnAttente: m.propositionsEnAttente, brouillonPret: m.brouillonPret, revenu: m.revenu, snoozeJusqua: m.snoozeJusqua })) }, liens: [lien("Mail", "/mail")] };
  },
});

/** Le bloc « Entonnoir du site par source » de la synthèse : vide s'il n'y a eu aucune visite. */
export function ligneEntonnoirSite(lignes: string[]): string {
  return lignes.length ? `Entonnoir du site par source (parcours ; entre parenthèses, l'étape facultative) :\n${lignes.join("\n")}` : "";
}

export const outilSynthese = definirOutil({
  nom: "synthese",
  titre: "Synthèse d'une période",
  description: "Leads reçus, dossiers ouverts, devis émis et signés, chiffre d'affaires encaissé, dépenses, pertes et délais sur une période (défaut : 30 derniers jours), et l'entonnoir du site par source (Meta, recherche, direct, autres : visite → pièce → photo → génération → rendu vu → estimation → contact ou rappel, en parcours). La même synthèse que l'écran Synthèse du CRM. Pour des analyses détaillées, préférer les outils « manager_… ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree) => {
    const { periode } = resoudrePeriode(entree);
    const s = await calculerSynthese(periode.du, periode.au);
    const c = s.commercial;
    const texte = [
      `Synthèse ${periode.libelle} (${periode.du} → ${periode.au}) :`,
      c.entrants ? `${pluriel(c.entrants.recus, "lead")} reçus (${c.entrants.parSource.map((p) => `${p.libelle} ${p.recus}`).join(", ")}), ${c.entrants.contactes} contactés, ${c.entrants.avecDossier} avec dossier, ${c.entrants.signes} signés.` : "",
      `${pluriel(c.cohorte.ouverts, "dossier ouvert", "dossiers ouverts")} sur la période : ${c.cohorte.devisEnvoyes} devis envoyés, ${c.cohorte.signes} signés, ${c.cohorte.encaisses} encaissés, ${c.cohorte.perdus} perdus (taux de signature ${format.pourcent(c.cohorte.tauxSignatureDevis)}).`,
      `Activité : ${c.activite.devisEmis} devis émis (${format.euros(c.activite.montantDevis)}), ${pluriel(c.activite.signatures, "signature")} (${format.euros(c.activite.montantSigne)}), ${pluriel(c.activite.facturesEmises, "facture")} (${format.euros(c.activite.montantFacture)}), ${pluriel(c.activite.pertes, "perte")}.`,
      s.finances.encaisse === null ? `Encaissé : paramètres manquants (${s.finances.parametresManquants.join(", ")}).` : `Encaissé ${format.euros(s.finances.encaisse)}, dépenses ${format.euros(s.finances.depenses)}${s.finances.margeBrute !== null ? `, marge brute ${format.euros(s.finances.margeBrute)}` : ""}${s.finances.panierMoyenSigne !== null ? `, panier moyen signé ${format.euros(s.finances.panierMoyenSigne)}` : ""}. En cours de règlement : ${format.euros(s.finances.encours.total)}.`,
      c.pertes.parMotif.length ? `Pertes par motif : ${c.pertes.parMotif.map((p) => `${p.libelle} ${p.valeur}`).join(", ")}.` : "",
      // Mission 16 (partie 6) : une ligne par famille de source (calculée à la lecture, sans requête de plus).
      ligneEntonnoirSite(s.site?.entonnoir ? texteEntonnoirParFamille(s.site.entonnoir) : []),
    ].filter(Boolean).join("\n");
    return { texte, donnees: { periode, commercial: s.commercial, finances: s.finances, clients: s.clients, entonnoirSite: s.site?.entonnoir ?? null }, liens: [lien("Synthèse", `/synthese?du=${periode.du}&au=${periode.au}`)] };
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
      ? `Campagne commencée le ${format.jourCourt(e.debut)} : ${e.enCours ? `jour ${e.jour} sur ${e.duree}` : e.jour !== null && e.jour > e.duree ? `terminée (jour ${e.jour}, durée ${e.duree})` : "pas encore commencée"}. Budget ${e.budget !== null ? format.euros(e.budget) : "non renseigné"}${e.depenseEstimee !== null ? `, dépense estimée ${format.euros(e.depenseEstimee)} (prorata, pas la dépense réelle Meta)` : ""}. ${pluriel(e.leads, "lead")} Meta sur ${pluriel(e.fenetreJours, "jour")}${e.coutParLead !== null ? `, soit ≈ ${format.euros(e.coutParLead)} par lead` : ""}. ${e.parPublicite.length ? `Par publicité : ${e.parPublicite.map((p) => `${p.nom} ${pluriel(p.leads, "lead")}, ${p.devis} devis, ${pluriel(p.signes, "signé")}`).join(" · ")}.` : ""} ${e.regle ? `Règle du jour : ${e.regle}` : "Aucune règle trouvée pour ce jour dans le protocole des consignes."}`
      : `Aucune campagne renseignée (Paramètres → Campagne publicitaire : début, budget, durée). Sur 7 jours : ${pluriel(e.leads, "lead")} Meta${e.parPublicite.length ? ` (${e.parPublicite.map((p) => `${p.nom} ${p.leads}`).join(", ")})` : ""}.`;
    return { texte, donnees: e, liens: [lien("Publicité", "/publicite"), lien("Paramètres", "/parametres")] };
  },
});

/** Seuils du disque (mission 10) : avertir à 70 %, alerter à 85 %. */
export const SEUILS_DISQUE = { attention: 70, urgent: 85 } as const;
export const niveauDisque = (pourcent: number): "OK" | "ATTENTION" | "URGENT" => (pourcent >= SEUILS_DISQUE.urgent ? "URGENT" : pourcent >= SEUILS_DISQUE.attention ? "ATTENTION" : "OK");

/**
 * La ligne « Avis Google » de `sante_systeme` (mission 16, partie 3) : sans clé ni lieu, le dire avec le NOM des
 * variables à poser ; connectés, la dernière lecture (note, nombre, date) et sa dernière erreur.
 */
export function texteAvisGoogle(e: { connectes: boolean; note: number | null; nombre: number | null; luLe: string | null; erreur: string | null }): string {
  if (!e.connectes) return "Avis Google : non connectés (GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID).";
  const lecture = e.note !== null && e.nombre !== null && e.luLe ? ` — ${e.note.toLocaleString("fr-FR")} sur 5, ${pluriel(e.nombre, "avis", "avis")} (lus le ${format.jourCourt(e.luLe)})` : e.luLe ? ", mais Google ne donne ni note ni nombre d'avis pour ce lieu : l'accueil n'en montre pas" : ", pas encore lus (première lecture à la prochaine visite de l'accueil)";
  return `Avis Google : connectés${lecture}${e.erreur ? ` ; dernière lecture en échec : ${e.erreur}` : ""}.`;
}

/** L'état de santé du système : tâches, connexions, jetons, crédits, disque, cohérence, alertes. */
export async function santeSysteme(maintenant: Date = new Date()) {
  const [taches, google, etatGoogle, meta, ia, alertes, coherence, avisGoogle] = await Promise.all([
    etatDesTaches(),
    rappelConnexionGoogle(maintenant).catch(() => null),
    etatConnexionGoogle().catch(() => null),
    resumeChaineMeta(maintenant).catch(() => null),
    etatIa(maintenant, "IA_REDACTION").catch(() => null),
    calculerAlertes(maintenant).catch(() => []),
    controlerCoherence().catch(() => null),
    // Mission 16 (partie 3) : les avis Google de l'accueil du site (sans appeler Google : la dernière lecture gardée).
    etatAvisGoogle().catch(() => null),
  ]);
  let disqueLibreMo: number | null = null;
  let disque: { libreMo: number; totalMo: number; pourcentUtilise: number; niveau: "OK" | "ATTENTION" | "URGENT" } | null = null;
  try {
    const { fichierDeLaBase, capaciteVolume } = await import("@/lib/base/sauvegarde.mjs");
    const fichier = fichierDeLaBase();
    if (fichier) {
      const c = capaciteVolume(fichier.replace(/[\\/][^\\/]+$/, ""));
      disqueLibreMo = Math.round(c.libre / 1_048_576);
      disque = { libreMo: disqueLibreMo, totalMo: Math.round(c.total / 1_048_576), pourcentUtilise: c.pourcentUtilise, niveau: niveauDisque(c.pourcentUtilise) };
    }
  } catch {
    disqueLibreMo = null;
  }
  const echecs = taches.taches.filter((t) => t.statut === "ECHEC_DEFINITIF");
  const travauxEnEchec = taches.planifications.filter((p) => p.dernierStatut === "ECHEC");
  return {
    taches: { enEchec: echecs.map((t) => ({ type: t.type, libelle: t.libelle, erreur: t.derniereErreur })), enAttente: taches.compteurs.EN_ATTENTE, travauxEnEchec: travauxEnEchec.map((p) => ({ nom: p.nom, erreur: p.derniereErreur })) },
    google: google ? { niveau: google.niveau, coupee: google.coupee, compte: google.compte } : null,
    // Mission 14 (partie 9) : l'API Google Calendar non activée dans le projet Google Cloud — les rappels attendent, ce n'est pas une tâche en échec.
    agendaApi: { activee: etatGoogle?.agendaApiActivee ?? true, message: etatGoogle?.agendaApiMessage ?? null },
    // Même chose pour Gmail ou Drive (les tâches attendent de la même façon, rien ne les listerait sinon).
    autresApisNonActivees: etatGoogle?.autresApisNonActivees ?? [],
    meta: meta ? { etat: meta.chaine.code, message: meta.chaine.libelle, jeton: meta.jeton.message, echeance: meta.jeton.echeance } : null,
    avisGoogle,
    ia: ia ? { active: ia.active, raison: ia.raison, cleApi: ia.cleApi, depenseMois: ia.depenseMois, budget: ia.budget } : null,
    disqueLibreMo,
    disque,
    coherence: coherence ? { dossiersControles: coherence.dossiersControles, incoherences: coherence.incoherences.map((i) => ({ code: i.code, gravite: i.gravite, client: i.client, message: i.constat })) } : null,
    alertes: alertes.map((a) => ({ gravite: a.gravite, titre: a.titre, detail: a.detail, lien: a.lien })),
  };
}

export const outilSanteSysteme = definirOutil({
  nom: "sante_systeme",
  titre: "Santé du système et alertes",
  description: "Tâches de fond en échec, connexion Google (jeton qui expire, API Google Calendar à activer dans le projet Google Cloud), avis Google du site (connectés ou non), chaîne Meta (leads reçus, lecture des formulaires, conversions, jeton), IA (clé, budget du mois), place disque, incohérences du contrôle quotidien, alertes du CRM (devis sans réponse, dossiers en retard…). Réponse à « tout va bien ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const s = await santeSysteme(contexte.maintenant);
    const texte = [
      s.taches.enEchec.length ? `${pluriel(s.taches.enEchec.length, "tâche")} de fond en échec : ${s.taches.enEchec.map((t) => `${t.libelle}${t.erreur ? ` (${t.erreur.slice(0, 80)})` : ""}`).join(" · ")}.` : "Aucune tâche en échec.",
      s.taches.travauxEnEchec.length ? `Travaux périodiques en échec : ${s.taches.travauxEnEchec.map((p) => p.nom).join(", ")}.` : "",
      s.google ? `Google : ${s.google.coupee ? "COUPÉ, reconnecter dans Paramètres" : `jeton ${s.google.niveau.toLowerCase()}`}${s.google.compte ? ` (${s.google.compte})` : ""}.` : s.agendaApi.activee && !s.autresApisNonActivees.length ? "Google : rien à signaler." : "",
      s.agendaApi.activee ? "" : `Google Calendar : l'API n'est pas activée dans le projet Google Cloud (console Google Cloud → API et services → Google Calendar API) ; les rappels attendent et s'inscriront seuls une fois l'API activée.${s.agendaApi.message ? ` Réponse de Google : ${s.agendaApi.message}` : ""}`,
      ...s.autresApisNonActivees.map((a) => `${a.api} : l'API n'est pas activée dans le projet Google Cloud (console Google Cloud → API et services → ${a.api} API) ; les tâches attendent et repartiront seules une fois l'API activée.${a.message ? ` Réponse de Google : ${a.message}` : ""}`),
      s.meta ? `Meta : ${s.meta.message}` : "",
      s.avisGoogle ? texteAvisGoogle(s.avisGoogle) : "",
      s.ia ? `IA : ${s.ia.active ? `active, ${format.euros(s.ia.depenseMois)} dépensés ce mois${s.ia.budget !== null ? ` sur ${format.euros(s.ia.budget)}` : ""}` : `inactive (${s.ia.raison ?? "réglages manquants"})`}${s.ia.cleApi ? "" : " ; clé Anthropic absente du serveur"}.` : "",
      s.disque ? `Disque : ${s.disque.pourcentUtilise} % utilisé (${s.disque.libreMo} Mo libres sur ${s.disque.totalMo})${s.disque.niveau === "URGENT" ? " — ALERTE, volume presque plein (≥ 85 %)" : s.disque.niveau === "ATTENTION" ? " — attention, plus de 70 %" : ""}.` : s.disqueLibreMo !== null ? `Disque : ${s.disqueLibreMo} Mo libres.` : "",
      s.coherence ? (s.coherence.incoherences.length ? `Cohérence : ${pluriel(s.coherence.incoherences.length, "incohérence")} sur ${s.coherence.dossiersControles} dossiers : ${s.coherence.incoherences.map((i) => i.message).join(" · ")}` : `Cohérence : rien à signaler (${s.coherence.dossiersControles} dossiers contrôlés).`) : "",
      s.alertes.length ? `Alertes : ${s.alertes.map((a) => `[${a.gravite}] ${a.titre} — ${a.detail}`).join(" · ")}` : "Aucune alerte.",
    ].filter(Boolean).join("\n");
    return { texte, donnees: s, liens: [lien("Tâches de fond", "/taches-de-fond"), lien("Paramètres", "/parametres")] };
  },
});

export const OUTILS_LECTURE = [outilChercher, outilLireFiche, outilLeadsAAppeler, outilLeadsARappeler, outilDossiersParEtape, outilCeQuiMAttend, outilEspacesClients, outilMailsATraiter, outilSynthese, outilCampagne, outilSanteSysteme];
