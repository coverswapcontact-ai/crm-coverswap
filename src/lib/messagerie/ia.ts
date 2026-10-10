/**
 * Mission 25 — l'IA de la messagerie (cahier, § L'IA) : une analyse par événement (faits, ligne de journal, deux
 * premières lignes de « Où on en est », classement et réponse proposée pour chaque message du client, rappel dit dans
 * une note), et la personnalisation d'une relance à partir du message validé. Claude Haiku par `appelerModele` (le seul
 * point d'appel du CRM : clé du serveur, interrupteurs, budget du mois, registre `AppelIa`).
 *
 * L'IA propose, des règles fixes vérifient (controleur.ts) ; elle ne décide jamais de ce qui part. Plafond propre à la
 * messagerie : IA_MESSAGERIE_BUDGET (10 € sans valeur), alerte à 80 %. Indisponible ou plafond atteint : null, et
 * l'appelant fait le même travail par les règles (regles.ts).
 */
import prisma from "@/lib/prisma";
import { appelerModele, etatIa, IaIndisponible } from "@/lib/ia/modele";
import { lireParametre } from "@/lib/parametres/service";
import { instantParis } from "./horaires";
import { CLASSES_MESSAGE, type ClasseMessage } from "./regles";
import type { EtatSuivi, Faits } from "./types";

export const BUDGET_MESSAGERIE_DEFAUT = 10;
export const SEUIL_ALERTE = 0.8;

export type AnalyseIa = {
  faits: Partial<Faits>;
  journal: string | null;
  situation: string | null;
  client: string | null;
  messages: { id: string; classe: ClasseMessage; reponse: string | null; alerte: string | null; rappel: { le: Date; motif: string } | null }[];
  notes: { id: string; rappel: { le: Date; motif: string } | null; vaSigner: boolean; sensible: boolean }[];
};

/** Dépense de l'IA de la messagerie sur le mois civil (heure de Paris). */
export async function depenseMessagerieDuMois(maintenant: Date): Promise<number> {
  const debutMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1) - 2 * 3_600_000);
  const lignes = await prisma.appelIa.findMany({ where: { createdAt: { gte: debutMois, lte: maintenant }, usage: { startsWith: "MESSAGERIE" } }, select: { coutEuros: true, createdAt: true } });
  const mois = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(maintenant);
  return lignes.filter((l) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(l.createdAt) === mois).reduce((t, l) => t + (l.coutEuros ?? 0), 0);
}

export async function budgetMessagerie(maintenant: Date): Promise<number> {
  const valeur = await lireParametre("IA_MESSAGERIE_BUDGET", maintenant);
  return typeof valeur === "number" && valeur > 0 ? valeur : BUDGET_MESSAGERIE_DEFAUT;
}

/** L'IA de la messagerie peut-elle être appelée maintenant ? (interrupteurs, clé, réglages, budgets) */
export async function iaDisponible(maintenant: Date): Promise<{ ok: boolean; raison: string | null; depense: number; budget: number }> {
  const [etat, depense, budget] = await Promise.all([etatIa(maintenant, "IA_MESSAGERIE"), depenseMessagerieDuMois(maintenant), budgetMessagerie(maintenant)]);
  if (!etat.active) return { ok: false, raison: etat.raison, depense, budget };
  if (depense >= budget) return { ok: false, raison: `Plafond de la messagerie atteint (${depense.toFixed(2).replace(".", ",")} € sur ${budget} €).`, depense, budget };
  return { ok: true, raison: null, depense, budget };
}

/**
 * Lot 5 — l'alerte à 80 % du plafond de la messagerie : envoyée par l'appel qui franchit le seuil, donc une fois par
 * mois (sans marque à garder) ; une seconde fois seulement si Lucas relève le plafond puis le franchit de nouveau.
 */
export async function surveillerBudget(depenseAvant: number, cout: number, budget: number): Promise<void> {
  const seuil = budget * SEUIL_ALERTE;
  if (!(depenseAvant < seuil && depenseAvant + cout >= seuil)) return;
  const { prevenirLucas } = await import("./alertes");
  const euros = (n: number) => n.toFixed(2).replace(".", ",");
  await prevenirLucas({
    titre: "IA de la messagerie : 80 % du budget du mois",
    texte: `${euros(depenseAvant + cout)} € dépensés sur ${euros(budget)} € ce mois-ci. Au plafond, la messagerie continue par les règles fixes jusqu'au mois suivant.`,
    chemin: "/parametres?section=assistant",
    libelleLien: "Voir le budget",
    urgence: 3,
    etiquette: "messagerie-budget",
    origine: "messagerie-budget",
  });
}

const SYSTEME_ANALYSE = `Tu aides Lucas, artisan poseur de revêtements adhésifs (CoverSwap, près de Montpellier), à suivre ses clients.
On te donne un dossier : ses faits, son journal, ses derniers échanges et les nouveaux éléments (messages du client, notes de Lucas).
Rends, par l'outil, uniquement ce que les éléments disent :
- faits : seulement ce qui est dit (teintes, surface, budget, délai, qui décide, objections, disponibilités, canal préféré, température). Rien d'inventé.
- journal : une ligne factuelle (120 caractères au plus) qui résume le nouvel élément.
- situation (110 caractères au plus) et client (80 caractères au plus) : les deux premières lignes de « Où on en est ». Faits seulement, dates absolues (« le 14/10 »), aucun adjectif, aucune supposition.
- messages : pour chaque message du client, sa classe et, s'il faut répondre, une réponse courte : vouvoiement, trois phrases au plus, une seule question au plus, aucun prix, montant, pourcentage, remise, date, jour ou créneau (sauf ceux donnés dans « valeurs permises »), aucun lien (sauf le lien donné pour son espace quand il le demande), jamais « gratuit », « offert », « garanti », « promis », jamais la mention d'une IA ou d'un assistant, jamais « Lucas de CoverSwap ». Commence par « Bonjour, » ou « Bonjour {prénom}, » seulement si le prénom est donné. Pas de réponse à un simple merci, ni à STOP.
- alerte : une phrase seulement si le client demande un prix, trouve ça cher, est mécontent ou hésite.
- rappel : seulement si une date est dite (jour au format AAAA-MM-JJ).`;

const SCHEMA_ANALYSE = {
  type: "object",
  properties: {
    faits: {
      type: "object",
      properties: {
        teintesEvoquees: { type: "array", items: { type: "string" } },
        teintesFavorites: { type: "array", items: { type: "string" } },
        surface: { type: ["string", "null"] },
        budget: { type: "string", enum: ["AISE", "SENSIBLE", "INCONNU"] },
        delai: { type: ["string", "null"] },
        decideur: { type: ["string", "null"] },
        objections: { type: "array", items: { type: "string" } },
        disponibilites: { type: ["string", "null"] },
        canalPrefere: { type: "string", enum: ["LIEN", "SMS_DABORD", "INCONNU"] },
        temperature: { type: "string", enum: ["CHAUD", "TIEDE", "FROID", "INCONNUE"] },
      },
    },
    journal: { type: "string" },
    situation: { type: "string" },
    client: { type: "string" },
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          classe: { type: "string", enum: [...CLASSES_MESSAGE] },
          reponse: { type: ["string", "null"] },
          alerte: { type: ["string", "null"] },
          rappel: { type: ["object", "null"], properties: { jour: { type: "string" }, heure: { type: ["string", "null"] }, motif: { type: "string" } } },
        },
        required: ["id", "classe"],
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          rappel: { type: ["object", "null"], properties: { jour: { type: "string" }, heure: { type: ["string", "null"] }, motif: { type: "string" } } },
          va_signer: { type: "boolean" },
          sensible: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  required: ["journal", "situation", "client"],
};

type RappelBrut = { jour?: string; heure?: string | null; motif?: string } | null | undefined;
function lireRappel(brut: RappelBrut, maintenant: Date): { le: Date; motif: string } | null {
  if (!brut?.jour || !/^\d{4}-\d{2}-\d{2}$/.test(brut.jour)) return null;
  const [h, m] = (brut.heure && /^\d{1,2}:\d{2}$/.test(brut.heure) ? brut.heure : "10:00").split(":").map(Number);
  const le = instantParis(brut.jour, h * 60 + m);
  if (Number.isNaN(le.getTime()) || le.getTime() < maintenant.getTime() || le.getTime() > maintenant.getTime() + 200 * 86_400_000) return null;
  return { le, motif: (brut.motif ?? "rappel").slice(0, 60) };
}

const texteCourt = (t: unknown, n: number) => (typeof t === "string" && t.trim() ? t.trim().slice(0, n) : null);

/**
 * Une analyse pour les nouveaux éléments d'un suivi (un seul appel, même pour trois messages d'affilée). Null si l'IA
 * n'est pas disponible ou si l'appel échoue : l'appelant passe aux règles.
 */
export async function analyserParIa(
  entree: {
    etat: EtatSuivi;
    journal: string[];
    echanges: string[];
    messages: { id: string; le: Date; texte: string; canal: string }[];
    notes: { id: string; le: Date; texte: string }[];
    permis: string[];
    lienEspace: string | null;
  },
  maintenant: Date
): Promise<AnalyseIa | null> {
  if (!entree.messages.length && !entree.notes.length) return null;
  const dispo = await iaDisponible(maintenant);
  if (!dispo.ok) return null;
  const { etat } = entree;
  const message = JSON.stringify(
    {
      aujourdhui: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(maintenant),
      dossier: {
        etape: etat.dossier?.etape ?? "LEAD",
        piece: etat.piece.connue ? etat.piece.nom : null,
        ville: etat.ville,
        zone: etat.zone,
        prenom_fiable: etat.prenom,
        devis_en_ligne: etat.devis.length > 0,
        simulations_publiees: etat.simulations.length,
      },
      faits: etat.faits,
      journal: entree.journal.slice(0, 10),
      derniers_echanges: entree.echanges.slice(-8),
      nouveaux_messages_du_client: entree.messages.map((m) => ({ id: m.id, canal: m.canal, texte: m.texte.slice(0, 1200) })),
      nouvelles_notes_de_lucas: entree.notes.map((n) => ({ id: n.id, texte: n.texte.slice(0, 1200) })),
      valeurs_permises: entree.permis,
      lien_de_son_espace: entree.lienEspace,
    },
    null,
    1
  );
  try {
    const { donnees, coutEuros } = await appelerModele(
      {
        usage: "MESSAGERIE_ANALYSE",
        systeme: SYSTEME_ANALYSE,
        message,
        outil: { nom: "rendre_analyse", description: "Rend l'analyse du dossier (faits, journal, Où on en est, réponses).", schema: SCHEMA_ANALYSE },
        jetonsSortieMax: 1500,
      },
      maintenant
    );
    await surveillerBudget(dispo.depense, coutEuros, dispo.budget);
    const d = donnees as Record<string, unknown>;
    const faitsBruts = (d.faits ?? {}) as Partial<Faits>;
    const listes = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 40)).slice(0, 4) : undefined);
    const faits: Partial<Faits> = {
      teintesEvoquees: listes(faitsBruts.teintesEvoquees),
      teintesFavorites: listes(faitsBruts.teintesFavorites),
      objections: listes(faitsBruts.objections),
      surface: texteCourt(faitsBruts.surface, 40) ?? undefined,
      delai: texteCourt(faitsBruts.delai, 40) ?? undefined,
      decideur: texteCourt(faitsBruts.decideur, 40) ?? undefined,
      disponibilites: texteCourt(faitsBruts.disponibilites, 80) ?? undefined,
      ...(faitsBruts.budget && ["AISE", "SENSIBLE"].includes(faitsBruts.budget) ? { budget: faitsBruts.budget } : {}),
      ...(faitsBruts.canalPrefere && faitsBruts.canalPrefere !== "INCONNU" ? { canalPrefere: faitsBruts.canalPrefere } : {}),
      ...(faitsBruts.temperature && faitsBruts.temperature !== "INCONNUE" ? { temperature: faitsBruts.temperature } : {}),
    };
    const ids = new Set(entree.messages.map((m) => m.id));
    const idsNotes = new Set(entree.notes.map((n) => n.id));
    return {
      faits,
      journal: texteCourt(d.journal, 120),
      situation: texteCourt(d.situation, 110),
      client: texteCourt(d.client, 80),
      messages: (Array.isArray(d.messages) ? d.messages : [])
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object" && ids.has(String((m as Record<string, unknown>).id)))
        .map((m) => ({
          id: String(m.id),
          classe: (CLASSES_MESSAGE as readonly string[]).includes(String(m.classe)) ? (m.classe as ClasseMessage) : "AUTRE",
          reponse: texteCourt(m.reponse, 500),
          alerte: texteCourt(m.alerte, 160),
          rappel: lireRappel(m.rappel as RappelBrut, maintenant),
        })),
      notes: (Array.isArray(d.notes) ? d.notes : [])
        .filter((n): n is Record<string, unknown> => Boolean(n) && typeof n === "object" && idsNotes.has(String((n as Record<string, unknown>).id)))
        .map((n) => ({ id: String(n.id), rappel: lireRappel(n.rappel as RappelBrut, maintenant), vaSigner: n.va_signer === true, sensible: n.sensible === true })),
    };
  } catch (erreur) {
    if (!(erreur instanceof IaIndisponible)) console.error("[messagerie] analyse par l'IA impossible, règles fixes :", erreur);
    return null;
  }
}

const SYSTEME_BROUILLON = `Tu écris pour Lucas (CoverSwap, revêtements adhésifs, près de Montpellier) un SMS court à un client, à partir des faits du dossier et des derniers échanges.
Vouvoiement, trois phrases au plus, une seule question au plus, 320 caractères au plus. Interdits : prix, montant, pourcentage, remise, date, jour, créneau, lien, « gratuit », « offert », « garanti », « promis », la mention d'une IA ou d'un assistant, « Lucas de CoverSwap ». Commence par « Bonjour, » ou par « Bonjour {prénom}, » si le prénom est donné.`;

/** Un brouillon libre (zone de saisie, ✨) : contrôlé ; sinon null et la raison. */
export async function brouillonParIa(etat: EtatSuivi, maintenant: Date): Promise<{ texte: string | null; raison: string | null }> {
  const dispo = await iaDisponible(maintenant);
  if (!dispo.ok) return { texte: null, raison: dispo.raison };
  const derniers = [...etat.envois.map((e) => ({ le: e.le, t: `Lucas : ${e.texte ?? ""}` })), ...etat.messagesClient.map((m) => ({ le: m.le, t: `Client : ${m.texte}` }))]
    .sort((a, b) => a.le.getTime() - b.le.getTime())
    .slice(-6)
    .map((x) => x.t.slice(0, 300));
  try {
    const { donnees, coutEuros } = await appelerModele(
      {
        usage: "MESSAGERIE_REDACTION",
        systeme: SYSTEME_BROUILLON,
        message: JSON.stringify({ etape: etat.dossier?.etape ?? "LEAD", piece: etat.piece.connue ? etat.piece.nom : null, prenom_fiable: etat.prenom, faits: etat.faits, derniers_echanges: derniers }),
        outil: { nom: "rendre_texte", description: "Rend le SMS proposé.", schema: { type: "object", properties: { texte: { type: "string" } }, required: ["texte"] } },
        jetonsSortieMax: 400,
      },
      maintenant
    );
    await surveillerBudget(dispo.depense, coutEuros, dispo.budget);
    const propose = texteCourt((donnees as { texte?: unknown }).texte, 500);
    if (!propose) return { texte: null, raison: "Le modèle n'a rien proposé." };
    const { controlerTexte } = await import("./controleur");
    const ecarts = controlerTexte(propose, { lienAttendu: null, premierContact: false, prenom: etat.prenom, permis: [] });
    return ecarts.length ? { texte: null, raison: `Brouillon écarté : ${ecarts.map((e) => e.detail).join(" ")}` } : { texte: propose, raison: null };
  } catch (erreur) {
    if (!(erreur instanceof IaIndisponible)) console.error("[messagerie] brouillon de l'IA impossible :", erreur);
    return { texte: null, raison: erreur instanceof Error ? erreur.message : "IA indisponible." };
  }
}

const SYSTEME_PERSONNALISATION = `Tu réécris légèrement un SMS de Lucas (CoverSwap, revêtements adhésifs) pour un client, à partir du texte validé et des faits du dossier.
Garde le sens, la longueur (320 caractères au plus) et le vouvoiement ; cite au plus un fait utile (une teinte regardée, la pièce, ce qui a été dit au téléphone).
Interdits : prix, montant, pourcentage, remise, date, jour, créneau, lien ajouté, « gratuit », « offert », « garanti », « promis », la mention d'une IA ou d'un assistant, « Lucas de CoverSwap », un prénom autre que celui donné, plus d'une question.
Si rien d'utile n'est à ajouter, rends le texte validé tel quel.`;

/** Le texte validé, personnalisé à partir des faits (S4, D3, F1, « comme convenu »). Null : garder le texte validé. */
export async function personnaliserParIa(entree: { code: string; texteValide: string; etat: EtatSuivi }, maintenant: Date): Promise<string | null> {
  const dispo = await iaDisponible(maintenant);
  if (!dispo.ok) return null;
  const f = entree.etat.faits;
  const faitsUtiles = { piece: entree.etat.piece.connue ? entree.etat.piece.nom : null, teintes_regardees: [...f.teintesFavorites, ...f.teintesEvoquees].slice(0, 3), decideur: f.decideur, objections: f.objections.slice(0, 2), prenom_fiable: entree.etat.prenom };
  try {
    const { donnees, coutEuros } = await appelerModele(
      {
        usage: "MESSAGERIE_PERSONNALISATION",
        systeme: SYSTEME_PERSONNALISATION,
        message: JSON.stringify({ code: entree.code, texte_valide: entree.texteValide, faits: faitsUtiles }),
        outil: { nom: "rendre_texte", description: "Rend le SMS personnalisé.", schema: { type: "object", properties: { texte: { type: "string" } }, required: ["texte"] } },
        jetonsSortieMax: 400,
      },
      maintenant
    );
    await surveillerBudget(dispo.depense, coutEuros, dispo.budget);
    return texteCourt((donnees as { texte?: unknown }).texte, 500);
  } catch (erreur) {
    if (!(erreur instanceof IaIndisponible)) console.error("[messagerie] personnalisation impossible, texte validé :", erreur);
    return null;
  }
}
