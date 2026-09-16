// ─────────────────────────────────────────────
// Pipeline de sourcing — module Prospection
// searchText par ville × type → filtres ordonnés → dédup → persistance.
// Les avis (Place Details) ne sont récupérés que pour les candidats retenus
// et nouveaux, pour économiser le quota API.
// ─────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  FILTRES_DEFAUT,
  MOTIFS_REJET,
  type AgentProfileConfig,
  type AgentSlug,
  type AvisBrut,
  type FiltresQualification,
  type MotifRejet,
} from "./constants";
import { fetchPlaceReviews, searchPlaces, type PlaceResult } from "./places";

export const VILLES_HERAULT = [
  "Montpellier",
  "Béziers",
  "Sète",
  "Lattes",
  "Pérols",
  "Castelnau-le-Lez",
  "Palavas-les-Flots",
  "La Grande-Motte",
  "Carnon",
  "Mauguio",
  "Pézenas",
  "Agde",
  "Frontignan",
  "Lunel",
  "Clermont-l'Hérault",
] as const;

const TERME_RECHERCHE: Record<AgentSlug, string> = {
  hotels: "hôtel",
  restaurants: "restaurant",
};

// Filtres passés avec succès, persistés dans ProspectActivity.details
const FILTRES_PASSES = [
  "operationnel",
  "codePostal34",
  "horsBlacklist",
  "nbAvisDansPlage",
  "noteDansPlage",
] as const;

export type OptionsSourcing = {
  /** Plafond de nouveaux prospects par exécution (défaut 60) */
  maxNouveaux?: number;
  /** Restreindre la liste de villes (défaut : les 15 villes de l'Hérault) */
  villes?: string[];
};

export type ResultatSourcing = {
  agent: AgentSlug;
  evalues: number; // places uniques évaluées sur cette exécution
  nouveaux: number; // prospects créés
  dejaConnus: number; // googlePlaceId déjà en base (tous agents) — dédup silencieuse
  rejetes: number; // total des rejets par filtre
  motifsRejet: Record<MotifRejet, number>;
  erreurs: string[]; // erreurs API non bloquantes (ville ignorée, avis manquants…)
};

function parseConfig(brut: string, slug: AgentSlug): AgentProfileConfig {
  let json: Partial<AgentProfileConfig>;
  try {
    json = JSON.parse(brut) as Partial<AgentProfileConfig>;
  } catch {
    throw new Error(
      "Config de l'agent illisible (JSON invalide) — relance le seed : npm run db:seed:prospection"
    );
  }
  return {
    typesGooglePlaces: json.typesGooglePlaces ?? [],
    motsClesSignaux: json.motsClesSignaux ?? [],
    blacklistMarques: json.blacklistMarques ?? [],
    angleVente: json.angleVente ?? "",
    quotaJournalier: json.quotaJournalier ?? 20,
    zone: json.zone ?? "Hérault (34)",
    // Fallback sur les valeurs par défaut si la clé manque (configs créées avant l'étape 3)
    filtres: { ...FILTRES_DEFAUT[slug], ...(json.filtres ?? {}) },
  };
}

// Minuscules + accents retirés, pour un match de blacklist robuste
function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function composantAdresse(place: PlaceResult, type: string): string | null {
  const composant = place.addressComponents?.find((c) => c.types?.includes(type));
  return composant?.longText ?? composant?.shortText ?? null;
}

// Jours de fermeture hebdo depuis regularOpeningHours.weekdayDescriptions
// (lignes localisées fr : "lundi: Fermé" / "mardi: 09:00 – 18:00").
// Retourne "lundi" ou "dimanche, lundi"… — null si 7j/7 ou inconnu.
function joursFermeture(place: PlaceResult): string | null {
  const brut = (
    place.regularOpeningHours as { weekdayDescriptions?: unknown } | null | undefined
  )?.weekdayDescriptions;
  const lignes = Array.isArray(brut)
    ? brut.filter((l): l is string => typeof l === "string")
    : [];

  const fermes: string[] = [];
  for (const ligne of lignes) {
    const deuxPoints = ligne.indexOf(":");
    if (deuxPoints === -1) continue;
    const jour = ligne.slice(0, deuxPoints).trim().toLowerCase();
    const horaires = normaliser(ligne.slice(deuxPoints + 1));
    if (horaires.includes("ferme") || horaires.includes("closed")) fermes.push(jour);
  }

  if (fermes.length === 0 || fermes.length >= 7) return null;
  return fermes.join(", ");
}

/**
 * Applique les filtres dans l'ordre imposé et retourne le motif du premier
 * rejet, ou null si la place est qualifiée.
 */
function motifRejet(
  place: PlaceResult,
  config: AgentProfileConfig,
  plage: FiltresQualification
): MotifRejet | null {
  // 1. Établissement en activité uniquement
  if (place.businessStatus !== "OPERATIONAL") return "nonOperationnel";

  // 2. Hérault uniquement (code postal 34xxx)
  const codePostal = composantAdresse(place, "postal_code");
  if (!codePostal || !codePostal.startsWith("34")) return "horsHerault";

  // 3. Blacklist franchises (insensible à la casse et aux accents)
  const nom = normaliser(place.displayName?.text ?? "");
  if (config.blacklistMarques.some((marque) => nom.includes(normaliser(marque)))) {
    return "franchiseBlacklist";
  }

  // 4. Volume d'avis dans la plage du profil
  const nbAvis = place.userRatingCount ?? 0;
  if (nbAvis < plage.minAvis || (plage.maxAvis !== null && nbAvis > plage.maxAvis)) {
    return "nbAvisHorsPlage";
  }

  // 5. Note dans la plage du profil (assez d'avis pour être crédible,
  //    assez de marge d'amélioration pour que CoverSwap ait un angle)
  const note = place.rating ?? 0;
  if (note < plage.minNote || note > plage.maxNote) return "noteHorsPlage";

  return null;
}

/**
 * Source les prospects d'un agent sur les villes de l'Hérault.
 * Idempotent : un googlePlaceId déjà en base (quel que soit l'agent) est
 * ignoré silencieusement — un hôtel-restaurant n'existe jamais deux fois.
 */
export async function sourceProspects(
  agentSlug: AgentSlug,
  options: OptionsSourcing = {}
): Promise<ResultatSourcing> {
  const maxNouveaux = options.maxNouveaux ?? 60;
  const villes = options.villes ?? [...VILLES_HERAULT];

  const profil = await prisma.agentProfile.findUnique({ where: { slug: agentSlug } });
  if (!profil) {
    throw new Error(
      `AgentProfile "${agentSlug}" introuvable — lance le seed : npm run db:seed:prospection`
    );
  }
  if (!profil.actif) throw new Error(`L'agent "${agentSlug}" est désactivé.`);

  const config = parseConfig(profil.config, agentSlug);
  const plage = config.filtres;
  // Tous les types configurés sont sourcés ; sans type, recherche texte libre
  const typesRecherche: (string | undefined)[] =
    config.typesGooglePlaces.length > 0 ? config.typesGooglePlaces : [undefined];

  const resultat: ResultatSourcing = {
    agent: agentSlug,
    evalues: 0,
    nouveaux: 0,
    dejaConnus: 0,
    rejetes: 0,
    motifsRejet: Object.fromEntries(MOTIFS_REJET.map((m) => [m, 0])) as Record<
      MotifRejet,
      number
    >,
    erreurs: [],
  };

  // Dédup intra-exécution : une même place peut sortir sur plusieurs villes/types
  const vues = new Set<string>();

  boucleVilles: for (const ville of villes) {
    const requete = `${TERME_RECHERCHE[agentSlug]} à ${ville}`;

    for (const typeRecherche of typesRecherche) {
      let places: PlaceResult[];
      try {
        places = await searchPlaces(requete, { includedType: typeRecherche });
      } catch (erreur) {
        const message = `Recherche « ${requete} »${
          typeRecherche ? ` (type ${typeRecherche})` : ""
        } échouée : ${erreur instanceof Error ? erreur.message : String(erreur)}`;
        console.warn(`[sourcing] ${message}`);
        resultat.erreurs.push(message);
        continue;
      }

      for (const place of places) {
        if (!place.id || vues.has(place.id)) continue;
        vues.add(place.id);
        resultat.evalues++;

        const nomAffiche = place.displayName?.text ?? place.id;

        const motif = motifRejet(place, config, plage);
        if (motif) {
          resultat.rejetes++;
          resultat.motifsRejet[motif]++;
          console.log(`[sourcing] rejet (${motif}) : ${nomAffiche} — « ${requete} »`);
          continue;
        }

        // Dédup tous agents confondus, silencieuse
        const existant = await prisma.prospect.findUnique({
          where: { googlePlaceId: place.id },
          select: { id: true },
        });
        if (existant) {
          resultat.dejaConnus++;
          continue;
        }

        // Candidat retenu et nouveau → on récupère ses avis (non bloquant)
        let avis: AvisBrut[] = [];
        try {
          avis = await fetchPlaceReviews(place.id);
        } catch (erreur) {
          const message = `Avis indisponibles pour ${nomAffiche} : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`;
          console.warn(`[sourcing] ${message}`);
          resultat.erreurs.push(message);
        }

        try {
          await prisma.prospect.create({
            data: {
              agentProfileId: profil.id,
              googlePlaceId: place.id,
              nom: place.displayName?.text ?? "Établissement sans nom",
              adresse: place.formattedAddress ?? null,
              ville: composantAdresse(place, "locality") ?? ville,
              codePostal: composantAdresse(place, "postal_code"),
              telephone: place.nationalPhoneNumber ?? null,
              siteWeb: place.websiteUri ?? null,
              noteGoogle: place.rating ?? null,
              nbAvis: place.userRatingCount ?? null,
              statut: "SOURCE",
              avisBruts: JSON.stringify(avis),
              fermetureHebdo: joursFermeture(place),
              activites: {
                create: {
                  type: "SOURCING",
                  details: JSON.stringify({
                    requete,
                    villeRecherche: ville,
                    typeRecherche: typeRecherche ?? null,
                    filtresPasses: FILTRES_PASSES,
                    noteGoogle: place.rating ?? null,
                    nbAvis: place.userRatingCount ?? null,
                    nbAvisRecuperes: avis.length,
                    typeGoogle: place.primaryType ?? null,
                  }),
                },
              },
            },
          });
          resultat.nouveaux++;
          console.log(`[sourcing] nouveau prospect : ${nomAffiche} (${ville})`);
        } catch (erreur) {
          // Course sur l'unicité de googlePlaceId → déjà connu, on reste silencieux
          if (
            erreur instanceof Prisma.PrismaClientKnownRequestError &&
            erreur.code === "P2002"
          ) {
            resultat.dejaConnus++;
          } else {
            const message = `Création de ${nomAffiche} échouée : ${
              erreur instanceof Error ? erreur.message : String(erreur)
            }`;
            console.error(`[sourcing] ${message}`);
            resultat.erreurs.push(message);
          }
        }

        if (resultat.nouveaux >= maxNouveaux) {
          console.log(`[sourcing] plafond atteint (${maxNouveaux} nouveaux) — arrêt.`);
          break boucleVilles;
        }
      }
    }
  }

  console.log(
    `[sourcing] ${agentSlug} : ${resultat.nouveaux} nouveaux, ${resultat.rejetes} rejetés, ` +
      `${resultat.dejaConnus} déjà connus sur ${resultat.evalues} évalués.`
  );
  return resultat;
}
