// ─────────────────────────────────────────────
// Scoring local — module Prospection (étape 3)
// 100 % déterministe, AUCUNE API externe ni LLM :
//   Bloc 1 (max 30) profil Google (note sweet spot + volume d'avis)
//   Bloc 2 (max 60) signaux de vétusté dans les avis (lexique pondéré × récence)
//   Bloc 3 (max 10) exploitabilité (site web, téléphone)
// Persiste score, scoreDetails, signalPrincipal et le statut QUALIFIE/ECARTE.
// ─────────────────────────────────────────────
import type { Prospect } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  EXCLUSIONS_NOURRITURE,
  GARDE_FOU_CHARME,
  LEXIQUE_VETUSTE,
  type AgentSlug,
  type AvisBrut,
  type ScoreDetails,
} from "./constants";

// Qualification : QUALIFIE si score >= seuil ET au moins un signal de
// vétusté (bloc 2 > 0) — un profil parfait sans signal (40 pts max) n'offre
// aucun angle d'email personnalisable. Seuil arbitré par Lucas le 11/06/2026
// sur la distribution réelle (max observé 47, avis Google souvent anciens).
export const SEUIL_QUALIFICATION = 45;

// Sweet spots du bloc profil, par agent
const PROFIL_SCORE: Record<
  AgentSlug,
  { noteMin: number; noteMax: number; avisMin: number; avisMax: number }
> = {
  hotels: { noteMin: 3.5, noteMax: 4.2, avisMin: 30, avisMax: 200 },
  restaurants: { noteMin: 3.5, noteMax: 4.3, avisMin: 50, avisMax: 500 },
};

const PLAFOND_SIGNAUX = 60;
const BONUS_MULTI_AVIS = 5;
const SANS_SIGNAL = "Aucun avis exploitable";

type Signal = ScoreDetails["signaux"][number];
// Signal de vétusté enrichi en interne (tri par récence), réduit à Signal
// avant persistance dans scoreDetails.
type SignalVetuste = Signal & { source: string; ts: number };

export type ResultatScoreProspect = {
  prospectId: string;
  nom: string;
  score: number;
  statut: string;
  nbSignauxVetuste: number;
  signalPrincipal: string;
};

export type OptionsScoring = {
  /** Nb max de prospects scorés sur cette exécution (défaut 500) */
  limit?: number;
  /** Rescorer aussi les prospects déjà QUALIFIE/ECARTE (défaut : SOURCE uniquement) */
  inclureDejaScores?: boolean;
};

export type ResultatScoring = {
  agent: AgentSlug;
  evalues: number;
  qualifies: number;
  ecartes: number;
  scoreMoyen: number;
  seuil: number;
};

// Normalisation de matching : minuscules, accents retirés, apostrophes
// typographiques unifiées en '. Conserve la longueur caractère à caractère,
// donc les index restent valides dans le texte original (pour les extraits).
const RE_DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");
const RE_APOSTROPHES = new RegExp("[\\u2019\\u02bc]", "g");
function normaliserPourMatch(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(RE_DIACRITIQUES, "")
    .replace(RE_APOSTROPHES, "'")
    .toLowerCase();
}

// ×4 si l'avis a moins de 6 mois, ×3 < 12 mois, ×2 < 24 mois, ×1 sinon/inconnu
function recence(
  datePublication: string | undefined,
  maintenant: Date
): { coeff: 1 | 2 | 3 | 4; tranche: string; ts: number } {
  if (!datePublication) return { coeff: 1, tranche: "date inconnue", ts: 0 };
  const ts = Date.parse(datePublication);
  if (Number.isNaN(ts)) return { coeff: 1, tranche: "date inconnue", ts: 0 };
  const jours = (maintenant.getTime() - ts) / 86_400_000;
  if (jours < 183) return { coeff: 4, tranche: "avis < 6 mois", ts };
  if (jours < 365) return { coeff: 3, tranche: "avis < 12 mois", ts };
  if (jours < 730) return { coeff: 2, tranche: "avis < 24 mois", ts };
  return { coeff: 1, tranche: "avis ≥ 24 mois", ts };
}

const estEspace = (caractere: string | undefined): boolean =>
  caractere !== undefined && /\s/.test(caractere);

/**
 * Extrait ~90 caractères de contexte autour d'un match : 45 avant, 45 après,
 * borné au début/fin du texte, coupé aux limites de mots (jamais en plein
 * milieu d'un mot), préfixé/suffixé par "…" si le texte continue au-delà.
 * Exportée pour être testable indépendamment.
 */
export function extraireContexte(
  texte: string,
  indexMatch: number,
  longueurMatch: number
): string {
  const finMatch = indexMatch + longueurMatch;
  let debut = Math.max(0, indexMatch - 45);
  let fin = Math.min(texte.length, finMatch + 45);

  // Bord gauche en plein mot → avancer au prochain blanc (sans entamer le match)
  if (debut > 0 && !estEspace(texte[debut - 1]) && !estEspace(texte[debut])) {
    const relatif = texte.slice(debut, indexMatch).search(/\s/);
    debut = relatif === -1 ? indexMatch : debut + relatif + 1;
  }
  // Bord droit en plein mot → reculer au dernier blanc (sans entamer le match)
  if (fin < texte.length && !estEspace(texte[fin]) && !estEspace(texte[fin - 1])) {
    const zone = texte.slice(finMatch, fin);
    const dernierBlanc = zone.search(/\s\S*$/);
    fin = dernierBlanc === -1 ? finMatch : finMatch + dernierBlanc;
  }

  let extrait = texte.slice(debut, fin).replace(/\s+/g, " ").trim();
  if (debut > 0) extrait = `…${extrait}`;
  if (fin < texte.length) extrait = `${extrait}…`;
  return extrait;
}

// Score linéairement dégressif en dehors d'un intervalle [min, max].
// `echelle` = distance à laquelle les points tombent à zéro.
function pointsDegressifs(
  valeur: number,
  min: number,
  max: number,
  echelleBas: number,
  echelleHaut: number,
  maxPoints: number
): number {
  if (valeur >= min && valeur <= max) return maxPoints;
  const distance = valeur < min ? min - valeur : valeur - max;
  const echelle = valeur < min ? echelleBas : echelleHaut;
  return Math.max(0, Math.round(maxPoints * (1 - distance / echelle)));
}

/* ── Bloc 1 — profil Google (max 30) ── */
function blocProfil(prospect: Prospect, agent: AgentSlug): Signal[] {
  const cfg = PROFIL_SCORE[agent];
  const signaux: Signal[] = [];

  if (prospect.noteGoogle != null) {
    const note = prospect.noteGoogle;
    const pts = pointsDegressifs(note, cfg.noteMin, cfg.noteMax, 0.6, 0.6, 15);
    const dansPlage = note >= cfg.noteMin && note <= cfg.noteMax;
    signaux.push({
      label: dansPlage
        ? `Note Google ${note.toFixed(1)} (sweet spot)`
        : `Note Google ${note.toFixed(1)} (hors sweet spot ${cfg.noteMin}-${cfg.noteMax})`,
      points: pts,
    });
  } else {
    signaux.push({ label: "Note Google inconnue", points: 0 });
  }

  if (prospect.nbAvis != null) {
    const nb = prospect.nbAvis;
    const pts = pointsDegressifs(nb, cfg.avisMin, cfg.avisMax, cfg.avisMin, cfg.avisMax, 15);
    const dansPlage = nb >= cfg.avisMin && nb <= cfg.avisMax;
    signaux.push({
      label: dansPlage
        ? `Volume d'avis ${nb} (plage cible)`
        : `Volume d'avis ${nb} (hors plage ${cfg.avisMin}-${cfg.avisMax})`,
      points: pts,
    });
  } else {
    signaux.push({ label: "Volume d'avis inconnu", points: 0 });
  }

  return signaux;
}

/* ── Bloc 2 — signaux de vétusté dans les avis (max 60) ── */
function blocVetuste(
  avisListe: AvisBrut[],
  maintenant: Date
): { signaux: SignalVetuste[]; avisDistincts: number } {
  const signaux: SignalVetuste[] = [];
  const avisAvecSignal = new Set<number>();

  avisListe.forEach((avis, indexAvis) => {
    // On ne matche que le français (le lexique est français)
    if (avis.langue && !avis.langue.toLowerCase().startsWith("fr")) return;
    if (!avis.texte) return;

    const texteNorm = normaliserPourMatch(avis.texte);
    const { coeff, tranche, ts } = recence(avis.datePublication, maintenant);

    for (const entree of LEXIQUE_VETUSTE) {
      const flags = entree.motif.flags.includes("g")
        ? entree.motif.flags
        : `${entree.motif.flags}g`;
      const re = new RegExp(entree.motif.source, flags);

      let match: RegExpExecArray | null;
      let retenu: RegExpExecArray | null = null;
      while ((match = re.exec(texteNorm)) !== null) {
        const finMatch = match.index + match[0].length;
        // Garde-fou charme/patrimoine : uniquement pour les signaux faibles,
        // fenêtre symétrique (le nom du lieu peut précéder : "pont vieux")
        if (
          entree.poids === 1 &&
          GARDE_FOU_CHARME.test(
            texteNorm.slice(Math.max(0, match.index - 15), finMatch + 30)
          )
        ) {
          continue;
        }
        // Exclusion contexte nourriture, avant OU après le match
        // ("vieux pain", "plats simples", "la cuisine mériterait"…)
        const debutFenetre = Math.max(0, match.index - 30);
        if (EXCLUSIONS_NOURRITURE.test(texteNorm.slice(debutFenetre, finMatch + 25))) {
          continue;
        }
        retenu = match;
        break; // un même motif ne compte qu'une fois par avis
      }
      if (!retenu) continue;

      avisAvecSignal.add(indexAvis);
      signaux.push({
        label: `Vétusté : « ${entree.label} » (poids ${entree.poids}, ${tranche}, ×${coeff})`,
        points: entree.poids * coeff,
        source: extraireContexte(avis.texte, retenu.index, retenu[0].length),
        ts,
      });
    }
  });

  return { signaux, avisDistincts: avisAvecSignal.size };
}

/* ── Bloc 3 — exploitabilité (max 10) ── */
function blocExploitabilite(prospect: Prospect): Signal[] {
  const signaux: Signal[] = [];
  if (prospect.siteWeb) signaux.push({ label: "Site web présent", points: 5 });
  if (prospect.telephone) signaux.push({ label: "Téléphone présent", points: 5 });
  return signaux;
}

function parseAvis(brut: string | null): AvisBrut[] {
  if (!brut) return [];
  try {
    const json = JSON.parse(brut);
    return Array.isArray(json) ? (json as AvisBrut[]) : [];
  } catch {
    return [];
  }
}

// Statuts depuis lesquels le scoring a le droit de (re)positionner le statut.
// Un prospect déjà engagé (CONTACTE et au-delà) n'est jamais rétrogradé.
const STATUTS_RESCORABLES = new Set(["SOURCE", "QUALIFIE", "ECARTE"]);

/* ── Scoring d'un prospect déjà chargé (cœur commun) ── */
async function scorerProspectCharge(
  prospect: Prospect & { agentProfile: { slug: string } },
  maintenant: Date
): Promise<ResultatScoreProspect> {
  const agent = prospect.agentProfile.slug as AgentSlug;
  const avisListe = parseAvis(prospect.avisBruts);

  // Bloc 1 — profil (max 30)
  const profil = blocProfil(prospect, agent);
  const bloc1 = Math.min(
    30,
    profil.reduce((somme, s) => somme + s.points, 0)
  );

  // Bloc 2 — vétusté (max 60, bonus multi-avis compris dans le plafond)
  const { signaux: vetuste, avisDistincts } = blocVetuste(avisListe, maintenant);
  let sommeVetuste = vetuste.reduce((somme, s) => somme + s.points, 0);
  const bonusApplique = vetuste.length > 0 && avisDistincts >= 2;
  if (bonusApplique) sommeVetuste += BONUS_MULTI_AVIS;
  const bloc2 = Math.min(PLAFOND_SIGNAUX, sommeVetuste);

  // Bloc 3 — exploitabilité (max 10)
  const exploitabilite = blocExploitabilite(prospect);
  const bloc3 = Math.min(
    10,
    exploitabilite.reduce((somme, s) => somme + s.points, 0)
  );

  const score = Math.min(100, bloc1 + bloc2 + bloc3);

  // scoreDetails : un élément par signal compté ; "source" uniquement pour le bloc 2
  const signauxDetail: Signal[] = [
    ...profil,
    ...vetuste.map(({ label, points, source }) => ({ label, points, source })),
  ];
  if (bonusApplique) {
    signauxDetail.push({
      label: `Signal récurrent (${avisDistincts} avis distincts)`,
      points: BONUS_MULTI_AVIS,
    });
  }
  signauxDetail.push(...exploitabilite);
  const details: ScoreDetails = { signaux: signauxDetail, total: score };

  // Signal principal : extrait du match au produit poids × récence le plus
  // élevé ; à égalité, l'avis le plus récent. Aucun match → texte sentinelle.
  const meilleur = [...vetuste].sort((a, b) => b.points - a.points || b.ts - a.ts)[0];
  const signalPrincipal = meilleur?.source ?? SANS_SIGNAL;

  const statutAvant = prospect.statut;
  const qualifie = score >= SEUIL_QUALIFICATION && bloc2 > 0;
  const statutApres = STATUTS_RESCORABLES.has(statutAvant)
    ? qualifie
      ? "QUALIFIE"
      : "ECARTE"
    : statutAvant;

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      score,
      scoreDetails: JSON.stringify(details),
      signalPrincipal,
      statut: statutApres,
      activites: {
        create: {
          type: "SCORING",
          details: JSON.stringify({
            bloc1,
            bloc2,
            bloc3,
            total: score,
            nbMatches: vetuste.length,
            nbAvisAnalyses: avisListe.length,
          }),
        },
      },
    },
  });

  return {
    prospectId: prospect.id,
    nom: prospect.nom,
    score,
    statut: statutApres,
    nbSignauxVetuste: vetuste.length,
    signalPrincipal,
  };
}

/**
 * Score un prospect par id. Recalcul complet et idempotent ; ne touche pas
 * au statut d'un prospect déjà engagé (CONTACTE et au-delà).
 */
export async function scoreProspect(prospectId: string): Promise<ResultatScoreProspect> {
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { agentProfile: { select: { slug: true } } },
  });
  if (!prospect) throw new Error(`Prospect "${prospectId}" introuvable.`);
  return scorerProspectCharge(prospect, new Date());
}

/**
 * Score les prospects d'un agent (statut SOURCE par défaut,
 * ou aussi QUALIFIE/ECARTE avec inclureDejaScores pour rescorer).
 */
export async function scoreProspects(
  agentSlug: AgentSlug,
  options: OptionsScoring = {}
): Promise<ResultatScoring> {
  const limit = options.limit ?? 500;
  const statuts = options.inclureDejaScores
    ? ["SOURCE", "QUALIFIE", "ECARTE"]
    : ["SOURCE"];

  const prospects = await prisma.prospect.findMany({
    where: { agentProfile: { slug: agentSlug }, statut: { in: statuts } },
    include: { agentProfile: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const maintenant = new Date();
  const resultat: ResultatScoring = {
    agent: agentSlug,
    evalues: 0,
    qualifies: 0,
    ecartes: 0,
    scoreMoyen: 0,
    seuil: SEUIL_QUALIFICATION,
  };

  let sommeScores = 0;
  for (const prospect of prospects) {
    const r = await scorerProspectCharge(prospect, maintenant);
    resultat.evalues++;
    sommeScores += r.score;
    if (r.statut === "QUALIFIE") resultat.qualifies++;
    else if (r.statut === "ECARTE") resultat.ecartes++;
    console.log(
      `[scoring] ${r.nom} → ${r.score}/100 (${r.statut}) — ${r.nbSignauxVetuste} signal(aux)`
    );
  }

  resultat.scoreMoyen = resultat.evalues > 0 ? Math.round(sommeScores / resultat.evalues) : 0;
  console.log(
    `[scoring] ${agentSlug} : ${resultat.evalues} évalués → ${resultat.qualifies} qualifiés, ` +
      `${resultat.ecartes} écartés (seuil ${SEUIL_QUALIFICATION}, moyenne ${resultat.scoreMoyen}).`
  );
  return resultat;
}
