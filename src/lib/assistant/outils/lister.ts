import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourSemaineHeure, pluriel, titreDossier } from "@/lib/commun/format";
import { creneauxLibres } from "@/lib/agenda/creneaux";
import { rechercherEntreprises } from "@/lib/clients/annuaire";
import { CATEGORIES_CLIENT, SOURCES_CLIENT, type CategorieClient, type SourceClient } from "@/lib/clients/constantes";
import { pageClients } from "@/lib/clients/fiches";
import { LIBELLES_ISSUE } from "@/lib/commercial/constantes";
import { issueDuContenu } from "@/lib/commercial/sans-reponse";
import { CODES_CATEGORIE, libelleCategorie } from "@/lib/depenses/constantes";
import { listerDepenses, suggestionsSaisie } from "@/lib/depenses/service";
import { dossiersArchives } from "@/lib/dossiers/archivage";
import { ETAPES, LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { anneeParis, jourParis } from "@/lib/dossiers/dates";
import { pageDossiers } from "@/lib/dossiers/dossiers";
import { mainDe } from "@/lib/dossiers/pilotage";
import { listerPresets } from "@/lib/dossiers/presets";
import { pageClientsEspaces } from "@/lib/espace/suivi";
import type { ClientEspace } from "@/lib/espace/suivi-types";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { chargerLivre } from "@/lib/finances/livre";
import { listerVue, VUES_MAIL, type VueMail } from "@/lib/mail/vues";
import { tarifsDesPrestations } from "@/lib/prestations/tarifs";
import { SOURCES_LEAD } from "@/lib/prospects/constantes";
import { listerLeads, type LigneLead, type VueLeads } from "@/lib/prospects/leads";
import { dossiersAvecPhotosApres, listerPublications, photosDuDossierPourPublication } from "@/lib/site/publications";
import { analysesConnues, catalogue } from "@/lib/simulateur/catalogue";
import { STYLES_CLIENT } from "@/lib/simulateur/types-surface";
import { listerPropositions } from "@/lib/validation/service";
import type { StatutProposition } from "@/lib/validation/types";
import { definirOutil, format, lien, type ContexteOutil, type ResultatOutil } from "../definition";
import { RACCOURCIS_PERIODE } from "../periodes";
import { cibler } from "./cible";
import { outilDossiersParEtape, outilEspacesClients } from "./lecture";
import { outilDepenses } from "./depenses";
import { outilMessagesEspace } from "./espace";
import { outilMailsNonClasses } from "./mail";
import { outilTarifs } from "./reglages";
import { outilVoirRelances } from "./relances";

/**
 * Mission 17 (partie C) — « lister » : toute liste d'un écran du CRM, avec les vues, filtres, recherche et pages de
 * l'écran, par la MÊME fonction de service que l'écran (docs/MCP-COUVERTURE.md § 4.6). Chaque ligne porte
 * l'identifiant utile aux outils d'écriture ([lead:…], [dossier:…], [client:…], [mail:…]…). Les archivés se lisent
 * quand la vue le demande (LEADS ARCHIVES, DOSSIERS ARCHIVES, CLIENTS archives, DEPENSES ARCHIVEES).
 *
 * Remplace leads_a_appeler, leads_a_rappeler, dossiers_par_etape, espaces_clients, mails_a_traiter, mails_non_classes,
 * messages_espace, voir_relances, depenses et tarifs : leurs cas reprennent leur texte (SMS prêts, lignes lisibles).
 */

export const LISTES = ["LEADS", "DOSSIERS", "CLIENTS", "ESPACES", "MAILS", "MESSAGES_ESPACE", "RELANCES", "PROPOSITIONS", "DEPENSES", "ENCOURS", "CHEQUES", "QUALITE_FINANCES", "LIVRE", "TARIFS", "PUBLICATIONS", "CRENEAUX", "TEINTES", "ENTREPRISES"] as const;
export type Liste = (typeof LISTES)[number];

/** Les vues de chaque liste (la première est le défaut). */
export const VUES_DES_LISTES: Partial<Record<Liste, readonly string[]>> = {
  LEADS: ["A_APPELER", "A_RAPPELER", "SANS_SUITE", "ARCHIVES"],
  DOSSIERS: ["EN_COURS", "A_FAIRE", "TOUS", "ARCHIVES", "PAR_ETAPE"],
  CLIENTS: ["ACTIFS", "ARCHIVES"],
  ESPACES: ["TOUS", "MOI", "CLIENT", "SIGNAUX", "DESACTIVES"],
  MAILS: [...VUES_MAIL, "NON_CLASSES"],
  PROPOSITIONS: ["EN_ATTENTE", "ECHEC", "HISTORIQUE"],
  DEPENSES: ["ANNEE", "ARCHIVEES", "SUGGESTIONS"],
};

/** Les onglets de l'écran « À valider » (FileValidation.tsx › STATUTS_ONGLET). */
const STATUTS_PROPOSITIONS: Record<string, StatutProposition[]> = { EN_ATTENTE: ["EN_ATTENTE"], ECHEC: ["ECHEC", "VALIDEE"], HISTORIQUE: ["EXECUTEE", "AUTOMATIQUE", "REJETEE", "EXPIREE", "ANNULEE"] };

const schemaFiltres = z
  .object({
    source: z.string().max(40).optional().describe("LEADS : source (META_ADS, SITE_SIMULATEUR…) ; CLIENTS : source client."),
    etape: z.enum(ETAPES).optional().describe("DOSSIERS : une étape (vue PAR_ETAPE, comme l'ex-« dossiers_par_etape ») ; ESPACES : étape d'un projet d'espace (PHOTOS, PROJET…)."),
    etape_espace: z.string().max(30).optional().describe("ESPACES : l'étape d'espace d'un projet (sélecteur « Étape » de l'écran)."),
    masquer_inactifs: z.boolean().optional().describe("DOSSIERS : « Masquer les inactifs »."),
    categorie: z.string().max(40).optional().describe("CLIENTS : PARTICULIER, PROFESSIONNEL, DONNEUR_ORDRE ; DEPENSES : catégorie de dépense."),
    tri: z.enum(["MAIN", "ACTIVITE", "CREATION"]).optional().describe("ESPACES : ce qui m'attend d'abord (défaut), dernière activité, lien récent."),
    sans_photo_ni_simulation_depuis_jours: z.number().int().min(1).max(60).optional().describe("ESPACES : seulement les projets sans photo ni simulation depuis N jours, avec le SMS du lien (ex-« espaces_clients »)."),
    dossier_id: z.string().max(40).optional().describe("Un dossier : RELANCES, PROPOSITIONS, PUBLICATIONS (photos proposées), CRENEAUX, MESSAGES_ESPACE, DEPENSES (suggestions)."),
    client_id: z.string().max(40).optional(),
    lead_id: z.string().max(40).optional(),
    nom: z.string().max(120).optional().describe("MESSAGES_ESPACE, CRENEAUX : le contact, tel que dit."),
    message_id: z.string().max(40).optional().describe("PROPOSITIONS : celles d'un mail."),
    proposition_id: z.string().max(40).optional().describe("PROPOSITIONS : lire une seule proposition, en entier."),
    type: z.string().max(40).optional().describe("PROPOSITIONS : un type (ENVOI_MAIL, FUSION_CLIENTS, MAJ_DEPUIS_MAIL…)."),
    tout: z.boolean().optional().describe("MESSAGES_ESPACE : tous les messages récents, lus compris."),
    annee: z.number().int().min(2020).max(2100).optional().describe("DEPENSES, ENCOURS, CHEQUES, QUALITE_FINANCES, LIVRE : l'année (celle en cours par défaut)."),
    periode: z.enum(RACCOURCIS_PERIODE).optional().describe("DEPENSES : une période (ex-« depenses ») au lieu de l'année."),
    du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    rattachement: z.enum(["toutes", "chantier", "hors_chantier", "non_rattachees"]).optional().describe("DEPENSES (par période)."),
    sous_partie: z.string().max(60).optional().describe("TARIFS : une seule sous-partie (« ilot », « SDB.plan-vasque »)."),
    styles: z.array(z.enum(STYLES_CLIENT)).max(6).optional().describe("TEINTES : goûts du client (bois-clair, bois-fonce, blanc, uni-colore, marbre, beton)."),
    famille: z.string().max(40).optional().describe("TEINTES : famille du catalogue."),
  })
  .partial();
type Filtres = z.output<typeof schemaFiltres>;

const schemaLister = z.object({
  liste: z.enum(LISTES).describe(
    "LEADS, DOSSIERS, CLIENTS, ESPACES, MAILS, MESSAGES_ESPACE, RELANCES, PROPOSITIONS, DEPENSES, ENCOURS (factures à encaisser), CHEQUES (à créditer), QUALITE_FINANCES (points à corriger), LIVRE (livre des recettes), TARIFS, PUBLICATIONS (site), CRENEAUX (jours libres pour un chantier), TEINTES (catalogue Cover Styl'), ENTREPRISES (annuaire public)."
  ),
  vue: z.string().max(30).optional().describe("LEADS : A_APPELER, A_RAPPELER, SANS_SUITE, ARCHIVES. DOSSIERS : EN_COURS, A_FAIRE, TOUS, ARCHIVES, PAR_ETAPE. CLIENTS : ACTIFS, ARCHIVES. ESPACES : TOUS, MOI, CLIENT, SIGNAUX, DESACTIVES. MAILS : A_TRAITER, CLIENTS, ADMINISTRATIF, RANGES, NON_CLASSES. PROPOSITIONS : EN_ATTENTE, ECHEC, HISTORIQUE. DEPENSES : ANNEE, ARCHIVEES, SUGGESTIONS."),
  filtres: schemaFiltres.optional(),
  recherche: z.string().max(120).optional().describe("La recherche de l'écran (LEADS : nom, téléphone, ville, campagne ; DOSSIERS : client, ville, objet ; CLIENTS ; MAILS dans la vue ; TEINTES ; ENTREPRISES : nom, SIREN, SIRET)."),
  page: z.number().int().min(1).max(500).optional(),
  par_page: z.number().int().min(1).max(100).optional().describe("Lignes par page (20 par défaut ; 50 au plus conseillé)."),
});
export type EntreeLister = z.output<typeof schemaLister>;

type Contexte = ContexteOutil;
type Pagination<T> = { lignes: T[]; page: number; pages: number; total: number; parPage: number };

export function paginer<T>(liste: T[], page = 1, parPage = 20): Pagination<T> {
  const pages = Math.max(1, Math.ceil(liste.length / parPage));
  const p = Math.min(Math.max(1, page), pages);
  return { lignes: liste.slice((p - 1) * parPage, p * parPage), page: p, pages, total: liste.length, parPage };
}
const textePage = (p: { page: number; pages: number }) => (p.pages > 1 ? ` (page ${p.page} sur ${p.pages})` : "");

function vueDe(liste: Liste, vue: string | undefined): string {
  const vues = VUES_DES_LISTES[liste];
  if (!vues) {
    if (vue) throw new ErreurMetier(`La liste ${liste} n'a pas de vue.`, 400);
    return "";
  }
  if (!vue) return vues[0];
  const v = vue.toUpperCase();
  if (!vues.includes(v)) throw new ErreurMetier(`Vue inconnue pour ${liste} : « ${vue} ». Possibles : ${vues.join(", ")}.`, 400);
  return v;
}

/** La cible des filtres (identifiant ou nom), résolue comme partout (candidats si doute). */
async function cibleDesFiltres(f: Filtres, type?: "DOSSIER"): Promise<{ ids: { dossierId: string | null; clientId: string | null; leadId: string | null; nom: string } } | { ambigu: ResultatOutil } | null> {
  if (!f.dossier_id && !f.client_id && !f.lead_id && !f.nom) return null;
  const r = await cibler({ dossierId: f.dossier_id, clientId: f.client_id, leadId: f.lead_id, nom: f.nom }, type);
  return r.ambigu ? { ambigu: r.ambigu } : { ids: r.ids! };
}

/* ── LEADS ──────────────────────────────────────────────────────────── */

function ligneLead(vue: VueLeads, l: LigneLead): string {
  const base = `${l.nom}${l.ville ? ` (${l.ville})` : ""}`;
  if (vue === "A_APPELER") return `- ${base} — ${l.projet}, ${l.libelleSource}${l.priorite ? `, ${l.priorite.toLowerCase()}` : ""}${l.telephone ? `, ${l.telephone}` : ""}, arrivé le ${format.jourCourt(l.attendDepuis ?? l.recuLe)} [lead:${l.id}]`;
  if (vue === "A_RAPPELER") {
    const issue = l.dernierAppel ? issueDuContenu(l.dernierAppel.contenu) : null;
    const dernierAppelLe = l.dernierAppelLe ?? l.dernierAppel?.le ?? null;
    const dernier = dernierAppelLe ? `dernier appel ${jourSemaineHeure(dernierAppelLe)}${issue ? ` (${LIBELLES_ISSUE[issue].toLowerCase()})` : ""}` : l.dernierContactLe ? `aucun appel noté, contacté par écrit le ${jourSemaineHeure(l.dernierContactLe)}` : "aucun appel noté";
    const rappel = l.rappelLe ? `rappel ${jourSemaineHeure(l.rappelLe)}${l.enRetard ? " EN RETARD" : ""}` : "rappel sans date";
    return `- ${base} — ${l.libelleSource}, ${l.telephone ?? "numéro illisible"}, ${pluriel(l.tentatives, "tentative")}, ${rappel}, ${dernier} [lead:${l.id}]`;
  }
  if (vue === "ARCHIVES") return `- ${base} — ${l.libelleSource}, archivé le ${format.jourCourt(l.archiveLe)}${l.archiveMotif ? ` (${l.archiveMotif})` : ""} [lead:${l.id}]`;
  return `- ${base} — ${l.libelleSource}, ${l.projet}, sans suite (statut ${l.statut.toLowerCase()})${l.dernierAppelLe ? `, dernier appel ${format.jourCourt(l.dernierAppelLe)}` : ""} [lead:${l.id}]`;
}

async function listerLesLeads(e: EntreeLister, vue: VueLeads, maintenant: Date): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  if (f.source && !(SOURCES_LEAD as readonly string[]).includes(f.source)) throw new ErreurMetier(`Source de lead inconnue : ${f.source}. Possibles : ${SOURCES_LEAD.join(", ")}.`, 400);
  const liste = await listerLeads({ vue, source: f.source, recherche: e.recherche, page: e.page ?? 1, parPage: e.par_page ?? 20 }, maintenant);
  const c = liste.compteurs;
  const total = liste.total ?? liste.lignes.length;
  const pages = Math.max(1, Math.ceil(total / (liste.parPage || 1)));
  const libelles: Record<VueLeads, string> = { A_APPELER: "à appeler, jamais appelés", A_RAPPELER: `à rappeler dont ${c.enRetard} en retard, ${c.aujourdhui} aujourd'hui`, SANS_SUITE: "sans suite", ARCHIVES: "archivés" };
  const filtre = [f.source ? `source ${f.source}` : null, e.recherche ? `recherche « ${e.recherche} »` : null].filter(Boolean).join(", ");
  const entete = `${pluriel(total, "lead")} ${libelles[vue]}${filtre ? ` (${filtre})` : ""}${textePage({ page: liste.page ?? 1, pages })}. Compteurs de l'écran : à appeler ${c.aAppeler}, à rappeler ${c.aRappeler} (dont ${c.enRetard} en retard), sans suite ${c.sansSuite}, archivés ${c.archives}.`;
  const texte = liste.lignes.length ? `${entete}\n${liste.lignes.map((l) => ligneLead(vue, l)).join("\n")}` : `${entete}\nAucun lead sur cette page.`;
  return {
    texte,
    donnees: { vue, compteurs: c, sources: liste.sources, page: liste.page, pages, total, lignes: liste.lignes.map((l) => ({ id: l.id, nom: l.nom, ville: l.ville, telephone: l.telephone, email: l.email, source: l.source, campagne: l.campagne, projet: l.projet, priorite: l.priorite, statut: l.statut, recuLe: l.recuLe, attendDepuis: l.attendDepuis, rappelLe: l.rappelLe, enRetard: l.enRetard, tentatives: l.tentatives, dernierAppelLe: l.dernierAppelLe, dernierContactLe: l.dernierContactLe, dossierId: l.dossierId, doublon: l.doublon, archiveLe: l.archiveLe, archiveMotif: l.archiveMotif })) },
    liens: [lien("Leads", `/leads?vue=${vue}`)],
  };
}

/* ── DOSSIERS ───────────────────────────────────────────────────────── */

function quiALaMain(d: { etape: string; prochaineActionDate: string | null; main: "MOI" | "CLIENT" | null }, maintenant: Date): string {
  const main = mainDe({ etape: d.etape as EtapeDossier, prochaineActionDate: d.prochaineActionDate, main: d.main }, maintenant);
  return main === "AUCUNE" ? "personne" : main === "MOI" ? "à toi" : main === "A_RELANCER" ? "à toi : à relancer" : "chez le client";
}

async function listerLesDossiers(e: EntreeLister, vue: string, contexte: Contexte): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  if (vue === "PAR_ETAPE" || (f.etape && vue === "EN_COURS" && !e.recherche)) return outilDossiersParEtape.executer({ etape: f.etape }, contexte);
  if (vue === "ARCHIVES") {
    const recherche = e.recherche?.trim().toLowerCase();
    const tous = (await dossiersArchives()).filter((d) => !recherche || `${d.clientNom} ${d.objet}`.toLowerCase().includes(recherche));
    const p = paginer(tous, e.page, e.par_page);
    const texte = p.total ? `${pluriel(p.total, "dossier archivé", "dossiers archivés")} (les 200 derniers)${textePage(p)} — « restaurer » les ramène :\n${p.lignes.map((d) => `- ${titreDossier(d)} — ${LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape}, archivé le ${format.jourCourt(d.archiveLe)}${d.archiveMotif ? ` (${d.archiveMotif})` : ""} [dossier:${d.id}]`).join("\n")}` : "Aucun dossier archivé.";
    return { texte, donnees: { vue, ...p }, liens: [lien("Dossiers archivés", "/dossiers?archives=1")] };
  }
  const page = await pageDossiers({ vue: vue as "EN_COURS" | "A_FAIRE" | "TOUS", recherche: e.recherche, masquerInactifs: f.masquer_inactifs, page: e.page ?? 1, parPage: e.par_page ?? 20 }, contexte.maintenant);
  const pages = Math.max(1, Math.ceil(page.total / page.parPage));
  const c = page.compteurs;
  const libelle = vue === "A_FAIRE" ? "à faire (la main est à toi)" : vue === "TOUS" ? "en tout (perdus et en pause compris)" : "en cours";
  const entete = `${pluriel(page.total, "dossier")} ${libelle}${e.recherche ? ` pour « ${e.recherche} »` : ""}${f.masquer_inactifs ? ", inactifs masqués" : ""}${textePage({ page: page.page, pages })}. Compteurs : en cours ${c.enCours}, à faire ${c.aFaire}, en retard ${c.enRetard}, sortis ${c.sorties}, inactifs ${c.inactifs}.`;
  const lignes = page.dossiers.map((d) => `- ${titreDossier(d)} (${d.clientVille}) — ${LIBELLES_ETAPE[d.etape] ?? d.etape}, ${quiALaMain(d, contexte.maintenant)}${d.prochaineAction ? ` → ${d.prochaineAction}${d.prochaineActionDate ? ` (${format.jourCourt(d.prochaineActionDate)})` : ""}` : ""}${d.montantDernierDevis ?? d.montantEstime ? `, ${format.euros((d.montantDernierDevis ?? d.montantEstime)!)}` : ""} [dossier:${d.id}]`);
  return {
    texte: lignes.length ? `${entete}\n${lignes.join("\n")}` : `${entete}\nAucun dossier sur cette page.`,
    donnees: { vue, compteurs: c, page: page.page, pages, total: page.total, dossiers: page.dossiers.map((d) => ({ id: d.id, clientNom: d.clientNom, objet: d.objet, ville: d.clientVille, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, montant: d.montantDernierDevis ?? d.montantEstime, ouvertLe: d.ouvertLe })) },
    liens: [lien("Dossiers", "/dossiers")],
  };
}

/* ── CLIENTS ────────────────────────────────────────────────────────── */

async function listerLesClients(e: EntreeLister, vue: string): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  if (f.categorie && !(CATEGORIES_CLIENT as readonly string[]).includes(f.categorie)) throw new ErreurMetier(`Catégorie inconnue : ${f.categorie} (PARTICULIER, PROFESSIONNEL, DONNEUR_ORDRE).`, 400);
  if (f.source && !(SOURCES_CLIENT as readonly string[]).includes(f.source)) throw new ErreurMetier(`Source client inconnue : ${f.source}. Possibles : ${SOURCES_CLIENT.join(", ")}.`, 400);
  const page = await pageClients({ recherche: e.recherche, categorie: f.categorie as CategorieClient | undefined, source: f.source as SourceClient | undefined, archives: vue === "ARCHIVES", page: e.page ?? 1, parPage: e.par_page ?? 20 });
  const pages = Math.max(1, Math.ceil(page.total / page.parPage));
  const entete = `${pluriel(page.total, vue === "ARCHIVES" ? "fiche archivée" : "client", vue === "ARCHIVES" ? "fiches archivées" : "clients")}${[f.categorie, f.source, e.recherche ? `« ${e.recherche} »` : null].filter(Boolean).length ? ` (${[f.categorie, f.source, e.recherche ? `« ${e.recherche} »` : null].filter(Boolean).join(", ")})` : ""}${textePage({ page: page.page, pages })}.`;
  const lignes = page.clients.map((c) => `- ${c.nom}${c.ville ? ` (${c.ville})` : ""} — ${c.categorie.toLowerCase()}, ${c.source.toLowerCase()}, ${pluriel(c.nbDossiers, "dossier")}${c.nbDossiersEnCours ? ` dont ${c.nbDossiersEnCours} en cours` : ""}${c.montantSigne ? `, ${format.euros(c.montantSigne)} signés` : ""}${c.telephone ? `, ${c.telephone}` : ""}${c.email ? `, ${c.email}` : ""}${c.archiveLe ? `, archivée le ${format.jourCourt(c.archiveLe)}` : ""} [client:${c.id}]`);
  return { texte: lignes.length ? `${entete}\n${lignes.join("\n")}` : `${entete}\nAucune fiche.`, donnees: { vue, page: page.page, pages, total: page.total, clients: page.clients }, liens: [lien("Clients", "/clients")] };
}

/* ── ESPACES ────────────────────────────────────────────────────────── */

const aDesSignaux = (c: ClientEspace) => c.signaux.some((s) => s.ton !== "gris");

/** Le filtre et le tri de l'écran Espaces (EcranEspaces.tsx), appliqués à la page lue. */
export function filtrerEspaces(clients: ClientEspace[], qui: string, etape: string | undefined, tri: string | undefined): ClientEspace[] {
  const filtres = clients.filter((c) => {
    if (qui === "DESACTIVES") return c.revoque;
    if (c.revoque) return false;
    if (qui === "MOI" && c.attente.qui !== "MOI") return false;
    if (qui === "CLIENT" && c.attente.qui !== "CLIENT") return false;
    if (qui === "SIGNAUX" && !aDesSignaux(c)) return false;
    return !etape || c.projets.some((p) => p.etape === etape);
  });
  if (tri === "ACTIVITE") return [...filtres].sort((a, b) => (b.derniereActivite ?? b.lienEmisLe).localeCompare(a.derniereActivite ?? a.lienEmisLe));
  if (tri === "CREATION") return [...filtres].sort((a, b) => b.lienEmisLe.localeCompare(a.lienEmisLe));
  return filtres;
}

async function listerLesEspaces(e: EntreeLister, qui: string, contexte: Contexte): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  if (f.sans_photo_ni_simulation_depuis_jours) return outilEspacesClients.executer({ limite: e.par_page, sans_photo_ni_simulation_depuis_jours: f.sans_photo_ni_simulation_depuis_jours }, contexte);
  const page = await pageClientsEspaces(contexte.maintenant, { page: e.page ?? 1, parPage: e.par_page ?? 50 });
  const pages = Math.max(1, Math.ceil(page.total / page.parPage));
  const visibles = filtrerEspaces(page.clients, qui, f.etape_espace, f.tri);
  const compteurs = { MOI: page.clients.filter((c) => !c.revoque && c.attente.qui === "MOI").length, CLIENT: page.clients.filter((c) => !c.revoque && c.attente.qui === "CLIENT").length, SIGNAUX: page.clients.filter((c) => !c.revoque && aDesSignaux(c)).length, TOUS: page.clients.filter((c) => !c.revoque).length, DESACTIVES: page.clients.filter((c) => c.revoque).length };
  const ligne = (c: ClientEspace) =>
    `- ${c.clientNom}${c.ville ? ` (${c.ville})` : ""} : ${c.revoque ? "lien désactivé" : c.premierAccesLe ? `vu ${c.nbAcces} fois, dernière visite ${format.jourCourt(c.dernierAccesLe)}` : "jamais ouvert"} ; ${pluriel(c.projetsEnCours, "projet")} en cours sur ${c.limite} permis${c.projetDemandeLe ? ", un projet de plus demandé" : ""} ; ${c.attente.qui === "MOI" ? "attend Lucas" : c.attente.qui === "CLIENT" ? "attend le client" : "rien en attente"} — ${c.attente.libelle}${c.signaux.length ? ` ; signaux : ${c.signaux.map((s) => s.libelle).join(", ")}` : ""}${c.projets.length ? `\n  Projets : ${c.projets.map((p) => `${p.nomProjet} — ${p.etapeLibelle}${p.fige ? ` (${p.fige === "TERMINE" ? "terminé" : "non réalisé"})` : ""}, ${p.faits.photos} photos, ${p.faits.simulationsPubliees} simulations publiées${p.faits.choix ? `, choix « ${p.faits.choix} »` : ""}${p.faits.devis ? `, devis ${p.faits.devis.numero} lu ${p.faits.devis.consultations} fois` : ""}${p.faits.accord ? ", bon pour accord donné" : ""} [dossier:${p.dossierId}]`).join(" · ")}` : ""} [client:${c.clientId}] [espace:${c.permanentId}]`;
  const entete = `Espaces clients, vue ${qui}${f.etape_espace ? `, étape ${f.etape_espace}` : ""} : ${pluriel(visibles.length, "client")} sur ${page.clients.length} de la page${textePage({ page: page.page, pages })} (${page.total} en tout). Compteurs de la page : à moi ${compteurs.MOI}, chez le client ${compteurs.CLIENT}, signaux ${compteurs.SIGNAUX}, tous ${compteurs.TOUS}, désactivés ${compteurs.DESACTIVES}.`;
  return {
    texte: visibles.length ? `${entete}\n${visibles.map(ligne).join("\n")}` : `${entete}\nAucun client dans cette vue.`,
    donnees: { vue: qui, compteurs, page: page.page, pages, total: page.total, clients: visibles.map((c) => ({ clientId: c.clientId, permanentId: c.permanentId, nom: c.clientNom, ville: c.ville, telephone: c.telephone, email: c.email, lien: c.lien, apercu: c.apercu, revoque: c.revoque, nbAcces: c.nbAcces, dernierAccesLe: c.dernierAccesLe, projetsEnCours: c.projetsEnCours, limite: c.limite, attente: c.attente, signaux: c.signaux, projets: c.projets.map((p) => ({ dossierId: p.dossierId, espaceId: p.espaceId, nom: p.nomProjet, etape: p.etape, fige: p.fige, faits: p.faits, attente: p.attente, signaux: p.signaux })) })) },
    liens: [lien("Espaces clients", "/espaces")],
  };
}

/* ── MAILS ──────────────────────────────────────────────────────────── */

async function listerLesMails(e: EntreeLister, vue: string, contexte: Contexte): Promise<ResultatOutil> {
  if (vue === "NON_CLASSES") return outilMailsNonClasses.executer({ limite: Math.min(e.par_page ?? 15, 40) }, contexte);
  const liste = await listerVue(vue as VueMail, { recherche: e.recherche });
  const p = paginer(liste.lignes, e.page, e.par_page);
  const c = liste.compteurs;
  const entete = `Vue ${vue}${e.recherche ? `, recherche « ${e.recherche} »` : ""} : ${pluriel(p.total, "conversation")}${textePage(p)}. Compteurs : ${c.A_TRAITER} à traiter, ${c.CLIENTS} clients, ${c.ADMINISTRATIF} administratif, ${c.RANGES} rangés.`;
  const lignes = p.lignes.map((m, i) => `${(p.page - 1) * p.parPage + i + 1}. ${m.priorite.libelle ? `[${m.priorite.libelle}${m.priorite.montant !== null ? ` ${format.euros(m.priorite.montant)}` : ""}] ` : ""}${m.correspondant.nom ?? m.correspondant.adresse} — « ${m.objet ?? "(sans objet)"} » ${format.jourCourt(m.recuLe)}${m.nonLu ? " · non lu" : ""}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}${m.intention ? ` · ${m.intention.toLowerCase()}${m.attendu ? ` : ${m.attendu}` : ""}` : " · non classé"}${m.propositionsEnAttente ? ` · ${pluriel(m.propositionsEnAttente, "carte")} à valider` : ""}${m.brouillonPret ? " · brouillon prêt" : ""}${m.contact ? ` · ${m.contact.nom}` : ""}${m.range ? " · rangé" : ""}${m.traite ? " · archivé" : ""} [mail:${m.messageId}]`);
  const espace = vue === "A_TRAITER" && liste.messagesEspace.length ? `\nMessages de l'espace client non lus (${liste.messagesEspace.length}) : ${liste.messagesEspace.slice(0, 10).map((m) => `${m.clientNom} — « ${m.texte.slice(0, 120)} » [dossier:${m.dossierId}]`).join(" · ")}` : "";
  return {
    texte: `${entete}\n${lignes.join("\n") || "Rien dans cette vue."}${espace}`,
    donnees: { vue, compteurs: c, page: p.page, pages: p.pages, total: p.total, mails: p.lignes.map((m) => ({ messageId: m.messageId, fil: m.fil, de: m.correspondant, objet: m.objet, extrait: m.extrait, recuLe: m.recuLe, mention: m.mention, classe: m.classe, contact: m.contact, nonLu: m.nonLu, range: m.range, traite: m.traite, priorite: m.priorite, intention: m.intention, attendu: m.attendu, propositionsEnAttente: m.propositionsEnAttente, brouillonPret: m.brouillonPret, revenu: m.revenu, snoozeJusqua: m.snoozeJusqua })), messagesEspace: liste.messagesEspace },
    liens: [lien("Mail", `/mail?vue=${vue}`)],
  };
}

/* ── PROPOSITIONS ───────────────────────────────────────────────────── */

async function listerLesPropositions(e: EntreeLister, vue: string): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  const toutes = await listerPropositions({ statuts: f.proposition_id ? undefined : STATUTS_PROPOSITIONS[vue], type: f.type, dossierId: f.dossier_id, clientId: f.client_id, messageId: f.message_id, limite: f.proposition_id ? 500 : 200 });
  if (f.proposition_id) {
    const p = toutes.find((x) => x.id === f.proposition_id) ?? (await prisma.proposition.findUnique({ where: { id: f.proposition_id } }).then(async (brut) => (brut ? (await import("@/lib/validation/service")).vueProposition(brut) : null)));
    if (!p) throw new ErreurMetier("Proposition introuvable.", 404);
    const texte = [
      `[proposition:${p.id}] ${p.libelleType} — ${p.titre} (${p.statut.toLowerCase()}, par ${p.auteur}, le ${format.jourCourt(p.createdAt)})${p.sensible ? " — SENSIBLE : confirmation à la validation" : ""}${p.validationGroupee ? " — validable en lot" : ""}.`,
      p.resume ? `Résumé : ${p.resume}` : "",
      p.raisonnement ? `Raisonnement : ${p.raisonnement}` : "",
      `Contenu : ${JSON.stringify(p.contenu).slice(0, 1500)}`,
      p.champs.length ? `Champs corrigibles (« valider_proposition » corrections) : ${p.champs.map((c) => `${c.cle} (${c.libelle}${c.options?.length ? ` : ${c.options.map((o) => o.valeur).join("/")}` : ""})`).join(", ")}.` : "Aucun champ corrigible.",
      p.motifsRejet.length ? `Motifs de rejet : ${p.motifsRejet.map((m) => m.code).join(", ")}.` : "",
      p.erreurExecution ? `Erreur d'exécution : ${p.erreurExecution}` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: p, liens: [lien("À valider", `/validation?proposition=${p.id}`)] };
  }
  const p = paginer(toutes, e.page, e.par_page);
  const libelle = vue === "ECHEC" ? "en cours ou en échec" : vue === "HISTORIQUE" ? "dans l'historique" : "à valider";
  const lignes = p.lignes.map((x) => `- [proposition:${x.id}] ${x.libelleType} — ${x.titre} (${x.statut.toLowerCase()}, ${format.jourCourt(x.createdAt)})${x.sensible ? " · sensible" : ""}${x.validationGroupee ? " · en lot" : ""}${x.erreurExecution ? ` · erreur : ${x.erreurExecution.slice(0, 120)}` : ""}${x.dossierId ? ` [dossier:${x.dossierId}]` : ""}`);
  return { texte: `${pluriel(p.total, "proposition")} ${libelle}${f.type ? ` (type ${f.type})` : ""}${textePage(p)}.\n${lignes.join("\n") || "Aucune."}`, donnees: { vue, page: p.page, pages: p.pages, total: p.total, propositions: p.lignes }, liens: [lien("À valider", "/validation")] };
}

/* ── DEPENSES ───────────────────────────────────────────────────────── */

async function listerLesDepenses(e: EntreeLister, vue: string, contexte: Contexte): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  if (vue === "SUGGESTIONS") {
    const s = await suggestionsSaisie(f.dossier_id ?? null);
    return { texte: `Suggestions de saisie : chantiers ${s.chantiers.map((c) => `${c.clientNom} — ${c.objet} (${c.etape.toLowerCase()}) [dossier:${c.id}]`).join(" · ") || "aucun"}${s.propose ? ` ; chantier proposé [dossier:${s.propose}]` : ""} ; fournisseurs récents : ${s.fournisseurs.join(", ") || "aucun"}.`, donnees: s, liens: [lien("Nouvelle dépense", "/depenses/nouvelle")] };
  }
  if (vue === "ANNEE" && (f.periode || f.du || f.au || f.rattachement)) {
    if (f.categorie && !(CODES_CATEGORIE as readonly string[]).includes(f.categorie)) throw new ErreurMetier(`Catégorie de dépense inconnue : ${f.categorie}.`, 400);
    return outilDepenses.executer({ periode: f.periode, du: f.du, au: f.au, categorie: f.categorie as (typeof CODES_CATEGORIE)[number] | undefined, rattachement: f.rattachement, limite: e.par_page }, contexte);
  }
  const annee = f.annee ?? anneeParis(contexte.maintenant);
  if (vue === "ARCHIVEES") {
    const lignes = await prisma.depense.findMany({ where: { archiveLe: { not: null }, payeeLe: { gte: new Date(`${annee}-01-01T00:00:00Z`), lt: new Date(`${annee + 1}-01-01T00:00:00Z`) } }, orderBy: { payeeLe: "desc" }, include: { dossier: { select: { id: true, clientNom: true } } } });
    const p = paginer(lignes, e.page, e.par_page);
    return { texte: p.total ? `${pluriel(p.total, "dépense retirée", "dépenses retirées")} en ${annee}${textePage(p)} :\n${p.lignes.map((d) => `- ${format.jourCourt(d.payeeLe)} ${format.euros(d.montant)} ${d.fournisseur} (${libelleCategorie(d.categorie).toLowerCase()}), retirée le ${format.jourCourt(d.archiveLe)}${d.archiveMotif ? ` (${d.archiveMotif})` : ""} [depense:${d.id}]`).join("\n")}` : `Aucune dépense retirée en ${annee}.`, donnees: { annee, ...p, lignes: p.lignes.map((d) => ({ id: d.id, payeeLe: d.payeeLe, montant: d.montant, fournisseur: d.fournisseur, categorie: d.categorie, archiveLe: d.archiveLe, archiveMotif: d.archiveMotif, dossier: d.dossier })) }, liens: [lien("Dépenses", `/depenses?annee=${annee}`)] };
  }
  const liste = await listerDepenses(annee);
  const filtrees = liste.depenses.filter((d) => !f.categorie || d.categorie === f.categorie);
  const p = paginer(filtrees, e.page, e.par_page ?? 25);
  const ligne = (d: (typeof filtrees)[number]) => `- ${format.jourCourt(d.payeeLe)} ${format.euros(d.montant)} ${d.fournisseur}${d.libelle ? ` — ${d.libelle}` : ""} (${libelleCategorie(d.categorie).toLowerCase()}) ${d.dossier ? `→ chantier ${d.dossier.clientNom}` : d.horsChantier ? "· hors chantier" : "· NON RATTACHÉE"}${d.justificatif ? "" : " · sans justificatif"} [depense:${d.id}]`;
  const texte = [
    `Dépenses ${annee} : ${format.euros(liste.total)} ; à traiter : ${liste.aRattacher} sans chantier, ${liste.sansJustificatif} sans justificatif.`,
    liste.parCategorie.length ? `Par catégorie : ${liste.parCategorie.map((c) => `${c.libelle} ${format.euros(c.total)}`).join(" · ")}.` : "",
    p.total ? `${f.categorie ? `${libelleCategorie(f.categorie as (typeof CODES_CATEGORIE)[number])} : ` : ""}${pluriel(p.total, "dépense")}${textePage(p)} :\n${p.lignes.map(ligne).join("\n")}` : "Aucune dépense.",
  ].filter(Boolean).join("\n");
  return { texte, donnees: { annee, total: liste.total, parCategorie: liste.parCategorie, aRattacher: liste.aRattacher, sansJustificatif: liste.sansJustificatif, page: p.page, pages: p.pages, nombre: p.total, depenses: p.lignes }, liens: [lien("Dépenses", `/depenses?annee=${annee}`)] };
}

/* ── FINANCES ───────────────────────────────────────────────────────── */

async function listerFinances(e: EntreeLister, liste: "ENCOURS" | "CHEQUES" | "QUALITE_FINANCES" | "LIVRE", contexte: Contexte): Promise<ResultatOutil> {
  const annee = e.filtres?.annee ?? anneeParis(contexte.maintenant);
  if (liste === "LIVRE") {
    const { lignes, manquants } = await chargerLivre(`${annee}-01-01`, `${annee}-12-31`);
    if (manquants.length) return { texte: `Livre des recettes ${annee} : paramètres manquants (${manquants.join(", ")}) — à renseigner dans Paramètres avant de lire le livre.`, donnees: { annee, manquants }, liens: [lien("Finances", `/finances?annee=${annee}`)] };
    const p = paginer(lignes, e.page, e.par_page ?? 50);
    const total = Math.round(lignes.reduce((s, l) => s + l.montant, 0) * 100) / 100;
    return { texte: `Livre des recettes ${annee} : ${pluriel(lignes.length, "ligne")}, total ${format.euros(total)}${textePage(p)}. Export CSV : ${lien("CSV", `/api/finances/livre?annee=${annee}`).href}\n${p.lignes.map((l) => `- ${l.jour} ${l.client} — ${l.nature} (${l.pieces}) ${format.euros(l.montant)} ${l.moyen}${l.reference ? ` réf. ${l.reference}` : ""}${l.mouvement !== "RECETTE" ? ` · ${String(l.mouvement).toLowerCase()}${l.motif ? ` (${l.motif})` : ""}` : ""} [encaissement:${l.encaissementId}]`).join("\n")}`, donnees: { annee, total, page: p.page, pages: p.pages, lignes: p.lignes }, liens: [lien("Livre (CSV)", `/api/finances/livre?annee=${annee}`), lien("Finances", `/finances?annee=${annee}`)] };
  }
  const t = await chargerTableauFinances(annee, contexte.maintenant);
  if (liste === "ENCOURS") {
    const p = paginer(t.encours.lignes, e.page, e.par_page);
    return { texte: `Factures à encaisser : ${pluriel(t.encours.lignes.length, "facture")}, reste ${format.euros(t.encours.total)}${textePage(p)}.\n${p.lignes.map((l) => `- ${l.numero} ${l.client} : ${format.euros(l.reste)} restant sur ${format.euros(l.montant)}${l.joursRetard ? `, ${pluriel(l.joursRetard, "jour")} de retard` : l.echeance ? `, échéance ${format.jourCourt(l.echeance)}` : ""}${l.origine !== "CRM" ? ` (hors CRM)` : ""} [registre:${l.registreId}]${l.dossierId ? ` [dossier:${l.dossierId}]` : ""}`).join("\n") || "Aucune."}`, donnees: { annee, total: t.encours.total, page: p.page, pages: p.pages, lignes: p.lignes }, liens: [lien("Finances", `/finances?annee=${annee}`)] };
  }
  if (liste === "CHEQUES") return { texte: t.cheques.length ? `${pluriel(t.cheques.length, "chèque")} à créditer :\n${t.cheques.map((c) => `- ${c.payeur} ${format.euros(c.montant)}${c.reference ? ` n° ${c.reference}` : ""}, reçu le ${format.jourCourt(c.recuLe)} (il y a ${pluriel(c.joursDepuisReception, "jour")}) [encaissement:${c.id}]${c.dossierId ? ` [dossier:${c.dossierId}]` : ""}`).join("\n")}` : "Aucun chèque à créditer.", donnees: { annee, cheques: t.cheques }, liens: [lien("Finances", `/finances?annee=${annee}`)] };
  return { texte: t.qualite.length ? `${pluriel(t.qualite.length, "point")} à corriger :\n${t.qualite.map((q) => `- ${q.libelle}${q.detail.length ? ` : ${q.detail.slice(0, 8).join(" ; ")}` : ""} [${q.code}]`).join("\n")}` : "Aucun point à corriger dans les finances.", donnees: { annee, qualite: t.qualite }, liens: [lien("Finances", `/finances?annee=${annee}`)] };
}

/* ── TARIFS, PUBLICATIONS, CRENEAUX, TEINTES, ENTREPRISES ───────────── */

async function listerLesTarifs(e: EntreeLister, contexte: Contexte): Promise<ResultatOutil> {
  if (e.filtres?.sous_partie) return outilTarifs.executer({ sous_partie: e.filtres.sous_partie }, contexte);
  const [lignes, presets] = await Promise.all([tarifsDesPrestations(), listerPresets()]);
  const base = await outilTarifs.executer({}, contexte);
  return { texte: `${base.texte}\nTarifs (presets) avec leur identifiant : ${presets.map((p) => `« ${p.designation} » ${p.prixUnitaire !== null ? `${format.euros(p.prixUnitaire)} / ${p.unite}` : "prix au devis"}${p.prestations?.length ? ` (attribué à ${p.prestations.join(", ")})` : ""} [tarif:${p.id}]`).join(" · ")}`, donnees: { sousParties: lignes, presets }, liens: base.liens };
}

async function listerLesPublications(e: EntreeLister): Promise<ResultatOutil> {
  if (e.filtres?.dossier_id) {
    const photos = await photosDuDossierPourPublication(e.filtres.dossier_id);
    return { texte: photos.length ? `${pluriel(photos.length, "photo")} du dossier pour une publication (le « chemin » va dans photoAvant / photoApres) :\n${photos.map((p) => `- ${p.apres ? "après" : "avant"} : ${p.chemin}`).join("\n")}` : "Ce dossier n'a aucune photo.", donnees: { photos }, liens: [lien("Site", "/site")] };
  }
  const [publications, dossiers] = await Promise.all([listerPublications(), dossiersAvecPhotosApres()]);
  const etat = (p: (typeof publications)[number]) => (p.retireLe ? `retirée le ${format.jourCourt(p.retireLe)}` : p.publieLe ? `publiée le ${format.jourCourt(p.publieLe)}` : "brouillon");
  const texte = [
    publications.length ? `${pluriel(publications.length, "publication")} :\n${publications.map((p) => `- ${p.type === "AVIS" ? "Avis" : "Réalisation"} « ${p.titre} »${p.ville ? ` (${p.ville})` : ""} — ${etat(p)}${p.accordClientLe ? "" : ", SANS accord écrit (ne peut pas être publiée)"}${p.type === "REALISATION" && !p.photoApres ? ", sans photo après" : ""} [publication:${p.id}]${p.dossierId ? ` [dossier:${p.dossierId}]` : ""}`).join("\n")}` : "Aucune publication.",
    dossiers.length ? `Dossiers avec des photos après (${dossiers.length}) : ${dossiers.map((d) => `${titreDossier(d)} (${d.nbApres}) [dossier:${d.id}]`).join(" · ")}` : "",
  ].filter(Boolean).join("\n");
  return { texte, donnees: { publications, dossiers }, liens: [lien("Site", "/site")] };
}

async function listerLesCreneaux(e: EntreeLister, contexte: Contexte): Promise<ResultatOutil> {
  const cible = await cibleDesFiltres(e.filtres ?? {}, "DOSSIER");
  if (cible && "ambigu" in cible) return cible.ambigu;
  let dossier: { id: string; clientNom: string; dateChantier: string | null; dateSouhaitee: string | null } | null = null;
  if (cible?.ids.dossierId) {
    const lu = await prisma.dossier.findUnique({ where: { id: cible.ids.dossierId }, select: { id: true, clientNom: true, dateChantier: true, dateSouhaitee: true } });
    if (lu) dossier = { id: lu.id, clientNom: lu.clientNom, dateChantier: lu.dateChantier ? jourParis(lu.dateChantier) : null, dateSouhaitee: lu.dateSouhaitee ? jourParis(lu.dateSouhaitee) : null };
  }
  const c = await creneauxLibres(contexte.maintenant);
  const texte = [
    `Jours libres des 10 prochains jours ouvrés${c.agenda ? " (agenda Google lu)" : ` (agenda non lu : ${c.message ?? "raison inconnue"} — ce sont les jours ouvrés)`} : ${c.libres.map((j) => `${j.libelle} (${j.jour})`).join(", ") || "aucun"}.`,
    c.occupes.length ? `Occupés : ${c.occupes.map((j) => j.libelle).join(", ")}.` : "",
    dossier ? `Dossier ${dossier.clientNom} : date posée ${dossier.dateChantier ?? "aucune"}, date souhaitée par le client ${dossier.dateSouhaitee ?? "aucune"}. Pour poser la date : « modifier_dossier » (date_chantier).` : "",
  ].filter(Boolean).join("\n");
  return { texte, donnees: { ...c, dossier }, liens: dossier ? [lien("Dossier", `/dossiers?dossier=${dossier.id}`)] : [] };
}

async function listerLesTeintes(e: EntreeLister): Promise<ResultatOutil> {
  const f = e.filtres ?? {};
  const [{ correspondAuStyle, profilDe, resumerTeinte }, { couleurEnMots }] = await Promise.all([import("@/lib/simulateur/teintes"), import("@/lib/simulateur/couleur")]);
  const [references, analyses] = await Promise.all([catalogue(), analysesConnues()]);
  const recherche = e.recherche?.trim().toLowerCase();
  const toutes = references
    .map((r) => {
      const analyse = analyses[r.id] ?? null;
      return { ref: r.id, nom: r.nom, famille: r.famille, profil: profilDe(r), resume: resumerTeinte(r, analyse), hex: analyse?.hex ?? null, couleur: analyse ? couleurEnMots(analyse).fr : null, image: `/api/simulateur/echantillons/${encodeURIComponent(r.id)}`, styles: (f.styles ?? []).filter((s) => correspondAuStyle(r, s, analyse)) };
    })
    .filter((t) => (!f.famille || t.famille.toLowerCase() === f.famille.toLowerCase()) && (!recherche || `${t.ref} ${t.nom} ${t.famille} ${t.resume} ${t.couleur ?? ""}`.toLowerCase().includes(recherche)) && (!f.styles?.length || t.styles.length > 0));
  const p = paginer(toutes, e.page, e.par_page ?? 30);
  return { texte: `${pluriel(p.total, "teinte")} du catalogue Cover Styl'${f.styles?.length ? ` pour ${f.styles.join(", ")}` : ""}${textePage(p)} :\n${p.lignes.map((t) => `- ${t.nom} (${t.ref}, ${t.famille}) — ${t.resume}`).join("\n") || "Aucune."}`, donnees: { page: p.page, pages: p.pages, total: p.total, teintes: p.lignes }, liens: [lien("Simulateur", "/simulateur")] };
}

async function listerLesEntreprises(e: EntreeLister): Promise<ResultatOutil> {
  if (!e.recherche?.trim()) throw new ErreurMetier("Donne un nom, un SIREN ou un SIRET dans « recherche ».", 400);
  const resultats = await rechercherEntreprises(e.recherche);
  return { texte: resultats.length ? `${pluriel(resultats.length, "établissement")} pour « ${e.recherche} » (annuaire public) :\n${resultats.map((r) => `- ${r.raisonSociale ?? r.enseigne ?? "?"}${r.enseigne && r.raisonSociale ? ` (${r.enseigne})` : ""} — SIREN ${r.siren}${r.siret ? `, SIRET ${r.siret}` : ""}, ${[r.adresse, r.codePostal, r.ville].filter(Boolean).join(" ")}${r.siege ? ", siège" : ""}${r.ferme ? ", FERMÉ" : ""}`).join("\n")}` : `Aucun établissement pour « ${e.recherche} ».`, donnees: resultats };
}

/* ── L'outil ────────────────────────────────────────────────────────── */

export const outilLister = definirOutil({
  nom: "lister",
  titre: "Lister (toutes les listes des écrans)",
  description:
    "Toute liste d'un écran du CRM, avec ses vues, filtres, recherche et pages, par la même fonction que l'écran ; chaque ligne porte l'identifiant utile aux outils d'écriture. LEADS (vues A_APPELER : jamais appelés, le plus récent en haut ; A_RAPPELER : rappels datés, retards EN RETARD en tête, tentatives, dernier appel ; SANS_SUITE ; ARCHIVES — filtres source, recherche nom/téléphone/ville/campagne). DOSSIERS (EN_COURS, A_FAIRE, TOUS, ARCHIVES, PAR_ETAPE avec filtres.etape — qui a la main, prochaine action ; recherche client/ville/objet ; masquer_inactifs ; compteurs). CLIENTS (ACTIFS, ARCHIVES ; categorie, source, recherche). ESPACES (TOUS, MOI, CLIENT, SIGNAUX, DESACTIVES ; etape_espace, tri ; faits par projet ; filtres.sans_photo_ni_simulation_depuis_jours : projets sans photo ni simulation, avec téléphone et SMS du lien prêt à copier). MAILS (A_TRAITER dans l'ordre de priorité, CLIENTS, ADMINISTRATIF, RANGES, NON_CLASSES avec leur texte à classer ; recherche dans la vue). MESSAGES_ESPACE (non lus par défaut ; cible : le fil d'un client ; tout). RELANCES (devis sans réponse : SMS prêt à copier et mail proposé ; relances photos). PROPOSITIONS (EN_ATTENTE, ECHEC, HISTORIQUE ; type, dossier_id, message_id ; proposition_id pour une seule, avec sensibilité, champs corrigibles et motifs de rejet). DEPENSES (ANNEE, ARCHIVEES, SUGGESTIONS ; ou periode/du/au, categorie, rattachement). ENCOURS, CHEQUES, QUALITE_FINANCES, LIVRE (annee ; lien CSV). TARIFS (sous-parties et presets avec identifiant). PUBLICATIONS (site ; dossier_id : photos proposées avec leur chemin). CRENEAUX (jours libres pour un chantier ; dossier). TEINTES (styles, famille, recherche). ENTREPRISES (annuaire : recherche nom, SIREN, SIRET). Rien n'est écrit.",
  niveau: "LECTURE",
  schema: schemaLister,
  executer: async (e, contexte) => {
    const vue = vueDe(e.liste, e.vue);
    const f = e.filtres ?? {};
    switch (e.liste) {
      case "LEADS":
        return listerLesLeads(e, vue as VueLeads, contexte.maintenant);
      case "DOSSIERS":
        return listerLesDossiers(e, vue, contexte);
      case "CLIENTS":
        return listerLesClients(e, vue);
      case "ESPACES":
        return listerLesEspaces(e, vue, contexte);
      case "MAILS":
        return listerLesMails(e, vue, contexte);
      case "MESSAGES_ESPACE":
        return outilMessagesEspace.executer({ dossierId: f.dossier_id, clientId: f.client_id, leadId: f.lead_id, nom: f.nom, tout: f.tout, limite: e.par_page ? Math.min(e.par_page, 60) : undefined }, contexte);
      case "RELANCES": {
        const r = await outilVoirRelances.executer({}, contexte);
        if (!f.dossier_id) return r;
        const d = r.donnees as { devis: { dossierId: string }[]; photos: { dossierId: string }[] };
        const lignes = r.texte.split("\n").filter((l) => l.includes(`[dossier:${f.dossier_id}]`));
        return { texte: lignes.length ? `Relances du dossier :\n${lignes.join("\n")}` : "Aucune relance pour ce dossier.", donnees: { ...(r.donnees as object), devis: d.devis.filter((x) => x.dossierId === f.dossier_id), photos: d.photos.filter((x) => x.dossierId === f.dossier_id) }, liens: [lien("Dossier", `/dossiers?dossier=${f.dossier_id}`)] };
      }
      case "PROPOSITIONS":
        return listerLesPropositions(e, vue);
      case "DEPENSES":
        return listerLesDepenses(e, vue, contexte);
      case "ENCOURS":
      case "CHEQUES":
      case "QUALITE_FINANCES":
      case "LIVRE":
        return listerFinances(e, e.liste, contexte);
      case "TARIFS":
        return listerLesTarifs(e, contexte);
      case "PUBLICATIONS":
        return listerLesPublications(e);
      case "CRENEAUX":
        return listerLesCreneaux(e, contexte);
      case "TEINTES":
        return listerLesTeintes(e);
      case "ENTREPRISES":
        return listerLesEntreprises(e);
    }
  },
});

/** Anciens outils de lecture que « lister » remplace (docs/MCP-COUVERTURE.md § 4.14). */
export const REMPLACES_PAR_LISTER = ["leads_a_appeler", "leads_a_rappeler", "dossiers_par_etape", "espaces_clients", "mails_a_traiter", "mails_non_classes", "messages_espace", "voir_relances", "depenses", "tarifs"] as const;

export const OUTILS_LISTER = [outilLister];

