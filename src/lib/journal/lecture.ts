import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { estJourValide } from "@/lib/dossiers/dates";
import { AVEC_ARCHIVES } from "./extension";
import { FAMILLES_ACTEUR, LIBELLES_MODELE, libelleActeurJournal, type ChangementJournal, type LigneJournalVue, type PageJournal } from "./libelles";

/**
 * Lecture du journal pour l'écran /journal : qui a changé quoi, quand, d'où.
 * Par enregistrement, par dossier (le dossier et tout ce qui s'y rattache),
 * par client, par auteur, par période. Lecture seule : le journal ne se
 * modifie pas.
 */

export type FiltresJournal = {
  dossierId?: string;
  clientId?: string;
  modele?: string;
  enregistrementId?: string;
  famille?: string;
  du?: string;
  au?: string;
  /** Curseur rendu par la page précédente. */
  suite?: string;
  limite?: number;
};

const CHAMPS_IGNORES = new Set(["ecriture", "updatedAt", "_caviarde"]);
const CHAMPS_MASQUES = new Set(["jetonChiffre"]);
const CHAMP_DATE = /(Le|At|Date|Du|horodatage|expiresAt|dateEmission|dateChantier|dateIntervention)$/i;
const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function formaterValeur(champ: string, valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (CHAMPS_MASQUES.has(champ)) return "•••• (chiffré)";
  if (typeof valeur === "number" && CHAMP_DATE.test(champ) && valeur > 1e11) return FORMAT_DATE.format(new Date(valeur));
  if (typeof valeur === "boolean" || (typeof valeur === "number" && /^(principale?|actif|optOut|enLigne|modifiee|acompteRecu|soldeRecu|noteMl)$/.test(champ))) return valeur ? "oui" : "non";
  const texte = typeof valeur === "string" ? valeur : JSON.stringify(valeur);
  return texte.length > 160 ? `${texte.slice(0, 159)}…` : texte;
}

function lire(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const valeur: unknown = JSON.parse(json);
    return typeof valeur === "object" && valeur !== null ? (valeur as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function changementsDe(operation: string, avant: Record<string, unknown> | null, apres: Record<string, unknown> | null): ChangementJournal[] {
  if (!apres) return [];
  if (operation === "CREATION" || operation === "ETAT_INITIAL" || !avant) {
    return Object.entries(apres)
      .filter(([champ, valeur]) => !CHAMPS_IGNORES.has(champ) && !["id", "createdAt"].includes(champ) && valeur !== null && valeur !== "" && valeur !== "[]" && valeur !== "{}")
      .slice(0, 8)
      .map(([champ, valeur]) => ({ champ, avant: null, apres: formaterValeur(champ, valeur) }));
  }
  return Object.keys(apres)
    .filter((champ) => !CHAMPS_IGNORES.has(champ) && JSON.stringify(apres[champ]) !== JSON.stringify(avant[champ]))
    .map((champ) => ({ champ, avant: formaterValeur(champ, avant[champ]), apres: formaterValeur(champ, apres[champ]) }));
}

function lienDe(modele: string, id: string, valeurs: Record<string, unknown>): string | null {
  const texte = (cle: string) => (typeof valeurs[cle] === "string" ? (valeurs[cle] as string) : null);
  switch (modele) {
    case "Client":
      return `/clients/${id}`;
    case "ClientEmail":
    case "ClientTelephone":
    case "ConsentementMail":
      return texte("clientId") ? `/clients/${texte("clientId")}` : null;
    case "Dossier":
      return `/dossiers?dossier=${id}`;
    case "DossierNote":
    case "DossierEvenement":
    case "Document":
    case "Encaissement":
    case "Depense":
      return texte("dossierId") ? `/dossiers?dossier=${texte("dossierId")}` : modele === "Depense" ? "/depenses" : modele === "Encaissement" ? "/finances" : null;
    case "Message":
      return `/messages?message=${id}`;
    case "PieceMessage":
    case "AnalyseMessage":
      return texte("messageId") ? `/messages?message=${texte("messageId")}` : null;
    case "Proposition":
      return "/validation";
    case "Parametre":
      return "/parametres";
    case "NumeroDocument":
      return "/numeros";
    case "InstantaneMensuel":
      return "/synthese";
    case "Lead":
      return `/prospects?lead=${id}`;
    case "Interaction":
    case "Simulation":
      return texte("leadId") ? `/prospects?lead=${texte("leadId")}` : null;
    case "Prospect":
      return `/prospects?prospect=${id}`;
    case "ProspectActivity":
      return texte("prospectId") ? `/prospects?prospect=${texte("prospectId")}` : null;
    case "AgentProfile":
      return "/prospects?onglet=demarchage";
    default:
      return null;
  }
}

/** (modèle, identifiants) d'un dossier : le dossier et ce qui s'y rattache. */
async function perimetreDossier(dossierId: string): Promise<[string, string[]][]> {
  const avecArchives = { ...AVEC_ARCHIVES, dossierId };
  const [notes, evenements, documents, encaissements, depenses, messages, propositions] = await Promise.all([
    prisma.dossierNote.findMany({ where: avecArchives, select: { id: true } }),
    prisma.dossierEvenement.findMany({ where: avecArchives, select: { id: true } }),
    prisma.document.findMany({ where: avecArchives, select: { id: true } }),
    prisma.encaissement.findMany({ where: { dossierId }, select: { id: true } }),
    prisma.depense.findMany({ where: avecArchives, select: { id: true } }),
    prisma.message.findMany({ where: avecArchives, select: { id: true } }),
    prisma.proposition.findMany({ where: avecArchives, select: { id: true } }),
  ]);
  const ids = (lignes: { id: string }[]) => lignes.map((ligne) => ligne.id);
  return [
    ["Dossier", [dossierId]],
    ["DossierNote", ids(notes)],
    ["DossierEvenement", ids(evenements)],
    ["Document", ids(documents)],
    ["Encaissement", ids(encaissements)],
    ["Depense", ids(depenses)],
    ["Message", ids(messages)],
    ["Proposition", ids(propositions)],
  ];
}

async function perimetreClient(clientId: string): Promise<[string, string[]][]> {
  const avecArchives = { ...AVEC_ARCHIVES, clientId };
  const [emails, telephones, consentements, leads, dossiers, encaissements, messages, propositions] = await Promise.all([
    prisma.clientEmail.findMany({ where: avecArchives, select: { id: true } }),
    prisma.clientTelephone.findMany({ where: avecArchives, select: { id: true } }),
    prisma.consentementMail.findMany({ where: { clientId }, select: { id: true } }),
    prisma.lead.findMany({ where: avecArchives, select: { id: true } }),
    prisma.dossier.findMany({ where: avecArchives, select: { id: true } }),
    prisma.encaissement.findMany({ where: { clientId }, select: { id: true } }),
    prisma.message.findMany({ where: avecArchives, select: { id: true } }),
    prisma.proposition.findMany({ where: avecArchives, select: { id: true } }),
  ]);
  const ids = (lignes: { id: string }[]) => lignes.map((ligne) => ligne.id);
  return [
    ["Client", [clientId]],
    ["ClientEmail", ids(emails)],
    ["ClientTelephone", ids(telephones)],
    ["ConsentementMail", ids(consentements)],
    ["Lead", ids(leads)],
    ["Dossier", ids(dossiers)],
    ["Encaissement", ids(encaissements)],
    ["Message", ids(messages)],
    ["Proposition", ids(propositions)],
  ];
}

export async function lireJournal(filtres: FiltresJournal = {}): Promise<PageJournal> {
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  const perimetre = filtres.dossierId ? await perimetreDossier(filtres.dossierId) : filtres.clientId ? await perimetreClient(filtres.clientId) : null;
  if (perimetre) {
    const blocs = perimetre
      .filter(([, ids]) => ids.length > 0)
      .map(([modele, ids]) => {
        parametres.push(modele, ...ids.slice(0, 400));
        return `("modele" = ? AND "enregistrementId" IN (${ids.slice(0, 400).map(() => "?").join(", ")}))`;
      });
    conditions.push(blocs.length ? `(${blocs.join(" OR ")})` : "0");
  }
  if (filtres.modele) {
    conditions.push(`"modele" = ?`);
    parametres.push(filtres.modele);
  }
  if (filtres.enregistrementId) {
    conditions.push(`"enregistrementId" = ?`);
    parametres.push(filtres.enregistrementId);
  }
  if (filtres.famille) {
    if (!FAMILLES_ACTEUR.some((famille) => famille.valeur === filtres.famille)) throw new ErreurMetier("Auteur inconnu.", 400);
    conditions.push(`"acteur" LIKE ?`);
    parametres.push(`${filtres.famille}:%`);
  }
  // Jours à Paris : bornes élargies de deux heures, puis rien de plus fin n'est utile à l'écran.
  if (filtres.du) {
    if (!estJourValide(filtres.du)) throw new ErreurMetier("Date de début invalide.", 400);
    conditions.push(`"horodatage" >= ?`);
    parametres.push(new Date(`${filtres.du}T00:00:00Z`).getTime() - 2 * 3600_000);
  }
  if (filtres.au) {
    if (!estJourValide(filtres.au)) throw new ErreurMetier("Date de fin invalide.", 400);
    conditions.push(`"horodatage" <= ?`);
    parametres.push(new Date(`${filtres.au}T23:59:59.999Z`).getTime());
  }
  if (filtres.suite) {
    const [horodatage, id] = filtres.suite.split("_");
    if (!/^\d+$/.test(horodatage ?? "") || !id) throw new ErreurMetier("Page invalide.", 400);
    conditions.push(`("horodatage" < ? OR ("horodatage" = ? AND "id" < ?))`);
    parametres.push(Number(horodatage), Number(horodatage), id);
  }

  const limite = Math.min(Math.max(filtres.limite ?? 80, 1), 200);
  const lignes = await prisma.$queryRawUnsafe<
    { id: string; horodatage: number | bigint; modele: string; enregistrementId: string; operation: string; acteur: string; origine: string | null; requete: string | null; avant: string | null; apres: string; caviardeLe: number | bigint | null }[]
  >(
    `SELECT "id", "horodatage", "modele", "enregistrementId", "operation", "acteur", "origine", "requete", "avant", "apres", "caviardeLe"
     FROM "JournalModification" ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY "horodatage" DESC, "id" DESC LIMIT ${limite + 1}`,
    ...parametres
  );

  const page = lignes.slice(0, limite).map((ligne): LigneJournalVue => {
    const avant = lire(ligne.avant);
    const apres = lire(ligne.apres);
    return {
      id: ligne.id,
      horodatage: new Date(Number(ligne.horodatage)).toISOString(),
      modele: ligne.modele,
      libelleModele: LIBELLES_MODELE[ligne.modele] ?? ligne.modele,
      enregistrementId: ligne.enregistrementId,
      operation: ligne.operation,
      acteur: ligne.acteur,
      libelleActeur: libelleActeurJournal(ligne.acteur),
      origine: ligne.origine,
      requete: ligne.requete,
      caviarde: ligne.caviardeLe !== null,
      changements: changementsDe(ligne.operation, avant, apres),
      lien: lienDe(ligne.modele, ligne.enregistrementId, apres ?? {}),
    };
  });
  const derniere = page.at(-1);
  return { lignes: page, suite: lignes.length > limite && derniere ? `${Date.parse(derniere.horodatage)}_${derniere.id}` : null };
}
