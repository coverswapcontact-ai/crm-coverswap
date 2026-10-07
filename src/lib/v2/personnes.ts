import type { Candidat } from "@/lib/assistant/recherche";
import { pluriel } from "@/lib/commun/format";
import type { LigneLead, VueLeads } from "@/lib/prospects/leads";
import { dateRelative, depuisLisible } from "./dates";

/**
 * Mission 22 (A4) — la logique pure de l'écran Personnes v2 (`components/v2/personnes/`), importable par les essais :
 * les segments (À appeler · À rappeler · Clients · Sans suite · Archivés), l'adresse de chacun (les adresses de la v1,
 * `/leads?liste=` et `/clients`, ne changent pas), l'état d'un lead en une phrase, la ligne d'un client, la phrase
 * d'un résultat de recherche, et la file des appels à la suite (la même règle que l'écran Leads de la v1).
 */
export type SegmentPersonnes = "A_APPELER" | "A_RAPPELER" | "CLIENTS" | "SANS_SUITE" | "ARCHIVES";

export const SEGMENTS_PERSONNES: readonly { valeur: SegmentPersonnes; libelle: string }[] = [
  { valeur: "A_APPELER", libelle: "À appeler" },
  { valeur: "A_RAPPELER", libelle: "À rappeler" },
  { valeur: "CLIENTS", libelle: "Clients" },
  { valeur: "SANS_SUITE", libelle: "Sans suite" },
  { valeur: "ARCHIVES", libelle: "Archivés" },
];

/** Cinq lignes avant « Voir les N autres ». */
export const LIGNES_VISIBLES = 5;

const LISTES: Record<Exclude<SegmentPersonnes, "CLIENTS">, string> = { A_APPELER: "appeler", A_RAPPELER: "rappeler", SANS_SUITE: "sans-suite", ARCHIVES: "archives" };

/** `?liste=appeler|rappeler|sans-suite|archives` → le segment ; sinon celui par défaut (`/leads` : À appeler). */
export function segmentDeLaListe(liste: string | string[] | null | undefined, defaut: SegmentPersonnes = "A_APPELER"): SegmentPersonnes {
  const valeur = typeof liste === "string" ? liste : null;
  const trouve = (Object.entries(LISTES) as [Exclude<SegmentPersonnes, "CLIENTS">, string][]).find(([, l]) => l === valeur);
  return trouve ? trouve[0] : defaut;
}

/** L'adresse d'un segment (`replaceState`, sans changer de page) : `/clients`, ou `/leads?liste=…`, avec `?q=` s'il y a une recherche. */
export function adresseDuSegment(segment: SegmentPersonnes, q = ""): string {
  const parametres = new URLSearchParams();
  if (segment !== "CLIENTS") parametres.set("liste", LISTES[segment]);
  if (q.trim()) parametres.set("q", q.trim());
  const chaine = parametres.toString();
  return `${segment === "CLIENTS" ? "/clients" : "/leads"}${chaine ? `?${chaine}` : ""}`;
}

/** La vue de `listerLeads` d'un segment ; null pour les clients. */
export function vueDuSegment(segment: SegmentPersonnes): VueLeads | null {
  return segment === "CLIENTS" ? null : segment;
}

type LeadPourEtat = Pick<LigneLead, "archiveLe" | "archiveMotif" | "statut" | "attendDepuis" | "rappelLe" | "dernierAppelLe" | "dernierContactLe" | "recuLe" | "tentatives" | "dossierId">;

/**
 * L'état d'un lead en une phrase : « attend un appel depuis 12 min », « à rappeler demain 9 h », « à rappeler depuis
 * hier 18 h », « appelé il y a 3 jours », « contacté lundi 9 h », « arrivé il y a 2 h » ; puis « 2 tentatives sans
 * réponse », « a un dossier » ; « sans suite » ; « archivé hier 18 h, motif ».
 */
export function etatLead(lead: LeadPourEtat, maintenant: Date): string {
  if (lead.archiveLe) return `archivé ${dateRelative(lead.archiveLe, maintenant)}${lead.archiveMotif ? `, ${lead.archiveMotif}` : ""}`;
  if (lead.statut === "PERDU") return "sans suite";
  const parties: string[] = [];
  if (lead.attendDepuis) parties.push(`attend un appel ${depuisLisible(lead.attendDepuis, maintenant)}`);
  else if (lead.rappelLe) parties.push(Date.parse(lead.rappelLe) <= maintenant.getTime() ? `à rappeler ${depuisLisible(lead.rappelLe, maintenant)}` : `à rappeler ${dateRelative(lead.rappelLe, maintenant)}`);
  else if (lead.dernierAppelLe) parties.push(`appelé ${dateRelative(lead.dernierAppelLe, maintenant)}`);
  else if (lead.dernierContactLe) parties.push(`contacté ${dateRelative(lead.dernierContactLe, maintenant)}`);
  else parties.push(`arrivé ${dateRelative(lead.recuLe, maintenant)}`);
  if (lead.tentatives > 0) parties.push(pluriel(lead.tentatives, "tentative sans réponse", "tentatives sans réponse"));
  if (lead.dossierId) parties.push("a un dossier");
  return parties.join(", ");
}

/** « 2 dossiers, 1 en cours », « 1 dossier », « aucun dossier ». */
export function phraseDossiersClient(nbDossiers: number, nbEnCours: number): string {
  if (nbDossiers <= 0) return "aucun dossier";
  return nbEnCours > 0 ? `${pluriel(nbDossiers, "dossier")}, ${nbEnCours} en cours` : pluriel(nbDossiers, "dossier");
}

const TYPES_RESULTAT: Record<Candidat["type"], string> = { CLIENT: "Client", LEAD: "Contact", DOSSIER: "Dossier" };

/** La seconde ligne d'un résultat de recherche (contact, client) : « Contact — Ville, à rappeler demain », « Client — 2 dossiers » ; un dossier passe par `situationDeCandidat`. */
export function phraseResultat(candidat: Pick<Candidat, "type" | "ville" | "etat">): string {
  const reste = [candidat.ville, candidat.etat].filter((m) => m && m.trim()).join(", ");
  return reste ? `${TYPES_RESULTAT[candidat.type]} — ${reste}` : TYPES_RESULTAT[candidat.type];
}

/**
 * La file des appels à la suite, comme la v1 : sur « À appeler », les jamais appelés sans les « à écarter » (les
 * simulations d'abord) ; sur « À rappeler », les rappels en retard dans l'ordre de la liste ; rien ailleurs.
 */
export function fileDAppels(segment: SegmentPersonnes, lignes: readonly LigneLead[]): LigneLead[] {
  if (segment === "A_RAPPELER") return lignes.filter((lead) => lead.enRetard);
  if (segment === "A_APPELER") return lignes.filter((lead) => lead.aAppeler && lead.priorite !== "A_ECARTER").sort((a, b) => Number(b.simulation) - Number(a.simulation));
  return [];
}

/** Les « à écarter » laissés de côté par la file (pour le dire en mode appels). */
export function ecartesDeLaFile(segment: SegmentPersonnes, lignes: readonly LigneLead[]): number {
  return segment === "A_APPELER" ? lignes.filter((lead) => lead.aAppeler && lead.priorite === "A_ECARTER").length : 0;
}
