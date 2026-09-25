import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { archiverDossier } from "@/lib/dossiers/archivage";
import { jourParis } from "@/lib/dossiers/dates";
import { pseudonyme } from "@/lib/synthese/references";
import { anonymiserClient } from "@/lib/rgpd/conservation";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";

/**
 * La corbeille (mission 11) : « supprimer » met un lead ou un dossier à la
 * corbeille — un archivage, avec un motif qui dit la date d'effacement, 30
 * jours plus tard. Jusque-là « restaurer » le remet. Passé ce délai, la purge
 * quotidienne EFFACE : jamais un DELETE, une anonymisation (RGPD) — les lignes
 * restent, sans plus rien de personnel ; ce qui doit être conservé (factures,
 * paiements) bloque l'effacement et la fiche reste à la corbeille, dite comme
 * telle. « definitif » fait la même chose tout de suite, sous confirmation.
 */

export const PREFIXE_CORBEILLE = "Corbeille";
export const DELAI_CORBEILLE_JOURS = 30;
export const TYPE_TACHE_PURGE_CORBEILLE = "PURGE_CORBEILLE";
export const NOM_TRAVAIL_CORBEILLE = "corbeille-quotidienne";
const JOUR_MS = 24 * 60 * 60_000;

export const dateEffacement = (mise: Date) => new Date(mise.getTime() + DELAI_CORBEILLE_JOURS * JOUR_MS);
export const motifCorbeille = (motif: string, maintenant: Date) => `${PREFIXE_CORBEILLE} (effacement le ${dateEffacement(maintenant).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}) : ${motif.trim() || "sans motif"}`.slice(0, 300);
const estALaCorbeille = (archiveMotif: string | null | undefined) => Boolean(archiveMotif?.startsWith(PREFIXE_CORBEILLE));

export type ElementCorbeille = { type: "LEAD" | "DOSSIER"; id: string; nom: string; miseLe: string; effacementLe: string; motif: string; clientId: string | null };

export async function listerCorbeille(): Promise<ElementCorbeille[]> {
  const [leads, dossiers] = await Promise.all([
    prisma.lead.findMany({ where: { archiveLe: { not: null }, archiveMotif: { startsWith: PREFIXE_CORBEILLE } }, select: { id: true, prenom: true, nom: true, ville: true, archiveLe: true, archiveMotif: true, clientId: true }, orderBy: { archiveLe: "desc" } }),
    prisma.dossier.findMany({ where: { archiveLe: { not: null }, archiveMotif: { startsWith: PREFIXE_CORBEILLE } }, select: { id: true, clientNom: true, objet: true, archiveLe: true, archiveMotif: true, clientId: true }, orderBy: { archiveLe: "desc" } }),
  ]);
  const element = (type: "LEAD" | "DOSSIER", id: string, nom: string, le: Date, motif: string | null, clientId: string | null): ElementCorbeille => ({ type, id, nom, miseLe: le.toISOString(), effacementLe: dateEffacement(le).toISOString(), motif: (motif ?? "").replace(/^Corbeille \([^)]*\) : /, ""), clientId });
  return [
    ...leads.map((l) => element("LEAD", l.id, `${l.prenom} ${l.nom}`.trim() + (l.ville ? ` (${l.ville})` : ""), l.archiveLe!, l.archiveMotif, l.clientId)),
    ...dossiers.map((d) => element("DOSSIER", d.id, `${d.clientNom} — ${d.objet}`, d.archiveLe!, d.archiveMotif, d.clientId)),
  ].sort((a, b) => a.miseLe.localeCompare(b.miseLe));
}

/** Mise à la corbeille : un archivage (réversible par « restaurer ») dont le motif dit la date d'effacement. */
export async function mettreALaCorbeille(entree: { leads: string[]; dossiers: string[]; motif: string }, maintenant: Date = new Date()): Promise<{ leads: string[]; dossiers: string[]; effacementLe: Date }> {
  const leads = [...new Set(entree.leads)];
  const dossiers = [...new Set(entree.dossiers)];
  if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à mettre à la corbeille : donne des identifiants de leads ou de dossiers.", 400);
  const motif = motifCorbeille(entree.motif, maintenant);
  const faits = { leads: [] as string[], dossiers: [] as string[] };
  for (const id of leads) {
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, archiveLe: true } });
    if (!lead) throw new ErreurMetier(`Lead ${id} introuvable : rien n'a été fait.`, 404);
    await prisma.lead.update({ where: { id }, data: { archiveLe: lead.archiveLe ?? maintenant, archiveMotif: motif } });
    faits.leads.push(id);
  }
  for (const id of dossiers) {
    const dossier = await prisma.dossier.findUnique({ where: { id }, select: { id: true, archiveLe: true } });
    if (!dossier) throw new ErreurMetier(`Dossier ${id} introuvable : rien n'a été fait.`, 404);
    if (dossier.archiveLe) await prisma.dossier.update({ where: { id }, data: { archiveMotif: motif } });
    else await archiverDossier(id, motif);
    faits.dossiers.push(id);
  }
  return { ...faits, effacementLe: dateEffacement(maintenant) };
}

export type BilanEffacement = { effaces: { type: "LEAD" | "DOSSIER"; id: string; reference: string }[]; conserves: { type: "LEAD" | "DOSSIER"; id: string; raison: string }[] };

/** Ce qui empêche d'effacer un dossier : une facture ou un paiement (conservation légale), un chantier engagé. */
async function bloquantsDossier(dossierId: string): Promise<string | null> {
  const [factures, encaissements] = await Promise.all([
    prisma.document.count({ where: { dossierId, type: { in: ["FACTURE", "AVOIR"] }, numero: { not: null } } }),
    prisma.encaissement.count({ where: { dossierId } }),
  ]);
  if (factures) return `${factures} facture(s) ou avoir(s) émis : conservation légale de 10 ans.`;
  if (encaissements) return `${encaissements} paiement(s) enregistré(s) : conservation comptable.`;
  return null;
}

/** Anonymise sur place une ligne de lead (sans client, ou dont le client garde d'autres dossiers). */
async function anonymiserLeadSeul(leadId: string, maintenant: Date): Promise<string> {
  const reference = pseudonyme(leadId);
  await prisma.lead.update({ where: { id: leadId }, data: { prenom: "Anonymisé", nom: reference, telephone: "", email: null, notes: null, message: null, ville: "", codePostal: null, archiveMotif: `${PREFIXE_CORBEILLE} — effacé le ${jourParis(maintenant)} (anonymisé, réf. ${reference})` } });
  await prisma.interaction.updateMany({ where: { leadId }, data: { contenu: "[contenu effacé — corbeille]" } });
  return reference;
}

/** Anonymise sur place un dossier (coordonnées et notes) ; ses événements sont caviardés. */
async function anonymiserDossierSeul(dossierId: string, maintenant: Date): Promise<string> {
  const reference = pseudonyme(dossierId);
  await prisma.dossier.update({ where: { id: dossierId }, data: { clientNom: `Anonymisé ${reference}`, clientAdresse: "", clientTelephone: "", clientEmail: null, archiveMotif: `${PREFIXE_CORBEILLE} — effacé le ${jourParis(maintenant)} (anonymisé, réf. ${reference})` } });
  await prisma.dossierEvenement.updateMany({ where: { dossierId }, data: { contenu: "[contenu effacé — corbeille]", metadata: "{}" } });
  return reference;
}

/**
 * Efface (anonymise) des éléments de la corbeille. Un client dont TOUT est à la
 * corbeille passe par l'anonymisation RGPD complète ; sinon la ligne seule est
 * anonymisée. Ce que la loi fait conserver bloque, et reste dit.
 */
export async function effacerDeLaCorbeille(elements: { leads?: string[]; dossiers?: string[] }, maintenant: Date = new Date(), decidePar = "SYSTEME:corbeille"): Promise<BilanEffacement> {
  const bilan: BilanEffacement = { effaces: [], conserves: [] };
  for (const id of [...new Set(elements.dossiers ?? [])]) {
    const dossier = await prisma.dossier.findUnique({ where: { id }, select: { id: true, archiveMotif: true, clientId: true } });
    if (!dossier || !estALaCorbeille(dossier.archiveMotif)) {
      bilan.conserves.push({ type: "DOSSIER", id, raison: "n'est pas à la corbeille" });
      continue;
    }
    const bloquant = await bloquantsDossier(id);
    if (bloquant) {
      bilan.conserves.push({ type: "DOSSIER", id, raison: bloquant });
      continue;
    }
    bilan.effaces.push({ type: "DOSSIER", id, reference: await anonymiserDossierSeul(id, maintenant) });
  }
  for (const id of [...new Set(elements.leads ?? [])]) {
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, archiveMotif: true, clientId: true } });
    if (!lead || !estALaCorbeille(lead.archiveMotif)) {
      bilan.conserves.push({ type: "LEAD", id, raison: "n'est pas à la corbeille" });
      continue;
    }
    // Le client entier si tout ce qu'il a est à la corbeille (ou vide) : anonymisation RGPD complète, avec sa trace.
    const client = lead.clientId ? await prisma.client.findUnique({ where: { id: lead.clientId }, select: { id: true, leads: { select: { id: true, archiveMotif: true } }, dossiers: { select: { id: true, archiveMotif: true } } } }) : null;
    const toutALaCorbeille = client && client.leads.every((l) => l.id === id || estALaCorbeille(l.archiveMotif)) && client.dossiers.every((d) => estALaCorbeille(d.archiveMotif));
    if (client && toutALaCorbeille) {
      try {
        const vue = await anonymiserClient(client.id, { motif: "AUTRE", commentaire: `Corbeille : ${DELAI_CORBEILLE_JOURS} jours écoulés ou effacement demandé`, confirmation: true });
        void decidePar;
        bilan.effaces.push({ type: "LEAD", id, reference: String((vue.contenuValide ?? vue.contenu).reference ?? pseudonyme(client.id)) });
        continue;
      } catch (erreur) {
        bilan.conserves.push({ type: "LEAD", id, raison: erreur instanceof Error ? erreur.message : String(erreur) });
        continue;
      }
    }
    bilan.effaces.push({ type: "LEAD", id, reference: await anonymiserLeadSeul(id, maintenant) });
  }
  return bilan;
}

/** La purge quotidienne : ce qui est à la corbeille depuis plus de 30 jours est effacé (anonymisé). */
export async function purgerCorbeille(maintenant: Date = new Date()): Promise<BilanEffacement & { resume: string }> {
  const limite = new Date(maintenant.getTime() - DELAI_CORBEILLE_JOURS * JOUR_MS);
  const echus = (await listerCorbeille()).filter((e) => new Date(e.miseLe) <= limite && !e.motif.startsWith("— effacé"));
  const bilan = await effacerDeLaCorbeille({ leads: echus.filter((e) => e.type === "LEAD").map((e) => e.id), dossiers: echus.filter((e) => e.type === "DOSSIER").map((e) => e.id) }, maintenant);
  const resume = echus.length === 0 ? "Corbeille : rien à effacer aujourd'hui." : `Corbeille : ${bilan.effaces.length} élément(s) effacé(s) (anonymisés), ${bilan.conserves.length} conservé(s)${bilan.conserves.length ? ` — ${bilan.conserves.map((c) => `${c.type.toLowerCase()} ${c.id} : ${c.raison}`).join(" ; ")}` : ""}.`;
  return { ...bilan, resume };
}

export function enregistrerTachesCorbeille(): void {
  enregistrerTraitement(TYPE_TACHE_PURGE_CORBEILLE, {
    libelle: "Corbeille : effacement (anonymisation) des éléments de plus de 30 jours",
    acteur: "SYSTEME:corbeille",
    tentativesMax: 2,
    executer: async () => purgerCorbeille(),
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_CORBEILLE,
    libelle: "Corbeille : une purge journalisée par jour",
    acteur: "SYSTEME:corbeille",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      const jour = jourParis(new Date());
      await mettreEnFile({ type: TYPE_TACHE_PURGE_CORBEILLE, cle: `purge-corbeille:${jour}`, charge: { jour }, priorite: -1 });
    },
  });
}
