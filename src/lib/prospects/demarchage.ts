import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { AGENT_SLUGS, STATUTS_PROSPECT, type AgentSlug } from "@/lib/prospection/constants";
import { scoreProspects } from "@/lib/prospection/scoring";
import {
  GROUPES_DEMARCHAGE,
  LIBELLES_STATUT_PROSPECT,
  STATUTS_PAR_GROUPE_DEMARCHAGE,
  STATUTS_PROSPECT_MANUELS,
  groupeDuProspect,
  type GroupeDemarchage,
} from "./constantes";
import type { EtatAgent, ListeProspects, ProspectDetail, ProspectResume } from "./types";

// Démarchage (modèle Prospect) : établissements sourcés sur Google Places et
// scorés sur les signes d'usure de leurs avis. Ils vivent ici jusqu'au
// dossier ; l'ouverture d'un dossier les passe en « Converti ».

const inclusionResume = {
  agentProfile: { select: { slug: true, nom: true } },
  activites: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
  dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, etape: true } },
  client: { select: { id: true, nom: true } },
} satisfies Prisma.ProspectInclude;

type ProspectAvecResume = Prisma.ProspectGetPayload<{ include: typeof inclusionResume }>;

function lireJson<T>(brut: string | null, defaut: T): T {
  if (!brut) return defaut;
  try {
    return JSON.parse(brut) as T;
  } catch {
    return defaut;
  }
}

/** Détails scorés avant la traduction des libellés (« sweet spot ») : relus en français, sans réécrire la base. */
function libellesEnFrancais(details: ProspectDetail["scoreDetails"]): ProspectDetail["scoreDetails"] {
  if (!details) return details;
  return {
    ...details,
    signaux: details.signaux.map((signal) => ({ ...signal, label: signal.label.replace("(hors sweet spot", "(hors plage").replace("(sweet spot)", "(plage cible)") })),
  };
}

function versResume(prospect: ProspectAvecResume): ProspectResume {
  const telephone = prospect.telephone ? (normaliserTelephone(prospect.telephone) ? formaterTelephone(normaliserTelephone(prospect.telephone)!) : prospect.telephone) : null;
  return {
    id: prospect.id,
    nom: prospect.nom,
    ville: prospect.ville,
    agent: { slug: prospect.agentProfile.slug, nom: prospect.agentProfile.nom },
    statut: prospect.statut,
    groupe: groupeDuProspect(prospect.statut),
    score: prospect.score,
    signalPrincipal: prospect.signalPrincipal,
    noteGoogle: prospect.noteGoogle,
    nbAvis: prospect.nbAvis,
    telephone,
    siteWeb: prospect.siteWeb,
    sourceLe: prospect.createdAt.toISOString(),
    derniereActiviteLe: (prospect.activites[0]?.createdAt ?? prospect.updatedAt).toISOString(),
    dossier: prospect.dossiers[0] ?? null,
    client: prospect.client,
  };
}

export type FiltresProspects = { groupe?: GroupeDemarchage; agent?: string; recherche?: string; limite?: number };

export async function listerProspects(filtres: FiltresProspects = {}): Promise<ListeProspects> {
  const groupe = filtres.groupe ?? "A_CONTACTER";
  const termes = (filtres.recherche ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const communs: Prisma.ProspectWhereInput = {
    ...(filtres.agent ? { agentProfile: { slug: filtres.agent } } : {}),
    AND: termes.map((terme) => ({ OR: [{ nom: { contains: terme } }, { ville: { contains: terme } }, { telephone: { contains: terme } }] })),
  };
  const [prospects, ...comptes] = await Promise.all([
    prisma.prospect.findMany({
      where: { ...communs, statut: { in: STATUTS_PAR_GROUPE_DEMARCHAGE[groupe] } },
      include: inclusionResume,
      orderBy: groupe === "A_CONTACTER" || groupe === "A_SCORER" || groupe === "ECARTES" ? [{ score: "desc" }, { createdAt: "desc" }] : { updatedAt: "desc" },
      take: Math.min(filtres.limite ?? 200, 500),
    }),
    ...GROUPES_DEMARCHAGE.map((cle) => prisma.prospect.count({ where: { ...communs, statut: { in: STATUTS_PAR_GROUPE_DEMARCHAGE[cle] } } })),
  ]);
  const compteurs = Object.fromEntries(GROUPES_DEMARCHAGE.map((cle, index) => [cle, comptes[index]])) as Record<GroupeDemarchage, number>;
  return { lignes: prospects.map(versResume), compteurs };
}

export function compterProspectsAContacter(): Promise<number> {
  return prisma.prospect.count({ where: { statut: { in: STATUTS_PAR_GROUPE_DEMARCHAGE.A_CONTACTER } } });
}

export async function chargerProspect(id: string): Promise<ProspectDetail> {
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    include: { ...inclusionResume, activites: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!prospect) throw new ErreurMetier("Prospect introuvable.", 404);
  const avis = lireJson<{ note: number; texte: string; datePublication?: string }[]>(prospect.avisBruts, []);
  return {
    ...versResume({ ...prospect, activites: prospect.activites.slice(0, 1) }),
    adresse: prospect.adresse,
    codePostal: prospect.codePostal,
    email: prospect.email,
    siret: prospect.siret,
    fermetureHebdo: prospect.fermetureHebdo,
    angleSuggere: prospect.angleSuggere,
    lienGoogleMaps: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(prospect.googlePlaceId)}`,
    scoreDetails: libellesEnFrancais(lireJson<ProspectDetail["scoreDetails"]>(prospect.scoreDetails, null)),
    avis: avis
      .filter((un) => un.texte)
      .slice(0, 8)
      .map((un) => ({ note: un.note, texte: un.texte.slice(0, 1200), le: un.datePublication ?? null })),
    activites: prospect.activites.map((activite) => {
      const details = lireJson<Record<string, unknown>>(activite.details, {});
      const message =
        typeof details.message === "string"
          ? details.message
          : activite.type === "SCORING" && typeof details.score === "number"
            ? `Score ${details.score}/100${typeof details.statut === "string" ? ` · ${LIBELLES_STATUT_PROSPECT[details.statut] ?? details.statut}` : ""}`
            : activite.type === "SOURCING"
              ? "Trouvé par le sourcing Google Places"
              : "";
      return { id: activite.id, type: activite.type, message, le: activite.createdAt.toISOString() };
    }),
  };
}

export const schemaModificationProspect = z
  .object({
    statut: z.enum(STATUTS_PROSPECT_MANUELS, "Statut invalide."),
    note: z.string("Note illisible.").trim().min(2, "Note trop courte.").max(2000, "Note trop longue."),
    telephone: z.string().trim().max(40, "Numéro trop long.").nullable(),
    email: z.string().trim().max(160, "Adresse trop longue.").nullable(),
    siteWeb: z.string().trim().max(300, "Adresse trop longue.").nullable(),
  })
  .partial();

/** Statut, note et coordonnées ; chaque geste laisse une activité datée. */
export async function modifierProspect(id: string, entree: z.output<typeof schemaModificationProspect>): Promise<string[]> {
  const prospect = await prisma.prospect.findUnique({ where: { id }, include: { dossiers: { where: { archiveLe: null }, select: { id: true } } } });
  if (!prospect) throw new ErreurMetier("Prospect introuvable.", 404);
  const avertissements: string[] = [];
  const { statut, note, ...coordonnees } = entree;
  await prisma.$transaction(async (tx) => {
    const data: Prisma.ProspectUpdateInput = { ...coordonnees };
    if (statut && statut !== prospect.statut) {
      data.statut = statut;
      if (statut === "OPT_OUT") {
        data.optOut = true;
        data.optOutAt = new Date();
      }
      await tx.prospectActivity.create({
        data: { prospectId: id, type: statut === "OPT_OUT" ? "OPT_OUT" : "NOTE", details: JSON.stringify({ message: `Statut : ${LIBELLES_STATUT_PROSPECT[statut]}` }) },
      });
    }
    if (Object.keys(data).length > 0) await tx.prospect.update({ where: { id }, data });
    if (note) await tx.prospectActivity.create({ data: { prospectId: id, type: "NOTE", details: JSON.stringify({ message: note }) } });
  });
  if (statut && prospect.dossiers.length > 0) avertissements.push("Ce prospect a déjà un dossier : il reste compté comme converti dans les dossiers.");
  if (statut && statut !== "OPT_OUT" && prospect.optOut) avertissements.push("Il avait demandé à ne plus être contacté : vérifie avant de le relancer.");
  return avertissements;
}

/** Scoring des prospects sourcés d'un agent (déterministe, sans appel extérieur). */
export async function scorerAgent(slug: string): Promise<{ evalues: number; qualifies: number; ecartes: number }> {
  if (!(AGENT_SLUGS as readonly string[]).includes(slug)) throw new ErreurMetier("Agent de prospection inconnu.", 404);
  const resultat = await scoreProspects(slug as AgentSlug, { limit: 500 });
  return { evalues: resultat.evalues, qualifies: resultat.qualifies, ecartes: resultat.ecartes };
}

export async function etatAgents(): Promise<{ agents: EtatAgent[]; sourcingDisponible: boolean }> {
  const agents = await prisma.agentProfile.findMany({ orderBy: { slug: "asc" }, select: { slug: true, nom: true, actif: true, id: true } });
  const etats = await Promise.all(
    agents.map(async (agent) => {
      const [prospects, aScorer, aContacter] = await Promise.all([
        prisma.prospect.count({ where: { agentProfileId: agent.id } }),
        prisma.prospect.count({ where: { agentProfileId: agent.id, statut: "SOURCE" } }),
        prisma.prospect.count({ where: { agentProfileId: agent.id, statut: "QUALIFIE" } }),
      ]);
      return { slug: agent.slug, nom: agent.nom, actif: agent.actif, prospects, aScorer, aContacter };
    })
  );
  return { agents: etats, sourcingDisponible: Boolean(process.env.GOOGLE_PLACES_API_KEY) };
}

/* ── Import d'un export de prospects (base locale → production) ───── */

export const FORMAT_EXPORT_PROSPECTS = "coverswap-prospects/1";

const dateIso = z.union([z.string(), z.number()]).transform((valeur) => new Date(valeur));

export const schemaImportProspects = z.object({
  format: z.literal(FORMAT_EXPORT_PROSPECTS, "Fichier non reconnu : export de prospects CoverSwap attendu."),
  agents: z.array(z.object({ slug: z.enum(AGENT_SLUGS), nom: z.string().max(80), actif: z.boolean(), config: z.string().max(20_000) })).max(10),
  prospects: z
    .array(
      z.object({
        agentSlug: z.enum(AGENT_SLUGS),
        googlePlaceId: z.string().min(1).max(300),
        nom: z.string().min(1).max(300),
        adresse: z.string().max(500).nullable(),
        ville: z.string().max(120).nullable(),
        codePostal: z.string().max(10).nullable(),
        telephone: z.string().max(40).nullable(),
        siteWeb: z.string().max(500).nullable(),
        email: z.string().max(200).nullable(),
        emailType: z.string().max(20),
        noteGoogle: z.number().nullable(),
        nbAvis: z.number().int().nullable(),
        siret: z.string().max(20).nullable(),
        anneeCreation: z.number().int().nullable(),
        statut: z.enum(STATUTS_PROSPECT),
        score: z.number().int(),
        scoreDetails: z.string().max(50_000).nullable(),
        signalPrincipal: z.string().max(2000).nullable(),
        angleSuggere: z.string().max(5000).nullable(),
        avisBruts: z.string().max(200_000).nullable(),
        fermetureHebdo: z.string().max(200).nullable(),
        optOut: z.boolean(),
        optOutAt: dateIso.nullable(),
        archiveLe: dateIso.nullable().default(null),
        archiveMotif: z.string().max(500).nullable().default(null),
        createdAt: dateIso,
        activites: z.array(z.object({ type: z.string().max(30), details: z.string().max(20_000).nullable(), createdAt: dateIso })).max(500),
      })
    )
    .max(5000),
});

/**
 * Ajoute ce qui manque, n'écrase rien : un agent ou un prospect déjà connu (même
 * googlePlaceId) est laissé tel quel. Rejouable.
 */
export async function importerProspects(entree: z.output<typeof schemaImportProspects>): Promise<{ agentsCrees: number; prospectsCrees: number; dejaConnus: number; activitesCreees: number }> {
  let agentsCrees = 0;
  let prospectsCrees = 0;
  let dejaConnus = 0;
  let activitesCreees = 0;
  const agents = new Map<string, string>();
  for (const agent of entree.agents) {
    const existant = await prisma.agentProfile.findFirst({ where: { slug: agent.slug, ...AVEC_ARCHIVES }, select: { id: true } });
    if (existant) {
      agents.set(agent.slug, existant.id);
      continue;
    }
    const cree = await prisma.agentProfile.create({ data: { slug: agent.slug, nom: agent.nom, actif: agent.actif, config: agent.config } });
    agents.set(agent.slug, cree.id);
    agentsCrees++;
  }
  for (const prospect of entree.prospects) {
    const agentId = agents.get(prospect.agentSlug) ?? (await prisma.agentProfile.findFirst({ where: { slug: prospect.agentSlug, ...AVEC_ARCHIVES }, select: { id: true } }))?.id;
    if (!agentId) throw new ErreurMetier(`Agent « ${prospect.agentSlug} » absent : il doit figurer dans le fichier ou exister déjà.`, 400);
    const existant = await prisma.prospect.findFirst({ where: { googlePlaceId: prospect.googlePlaceId, ...AVEC_ARCHIVES }, select: { id: true } });
    if (existant) {
      dejaConnus++;
      continue;
    }
    const { agentSlug: _agent, activites, ...champs } = prospect;
    void _agent;
    await prisma.$transaction(async (tx) => {
      const cree = await tx.prospect.create({ data: { ...champs, agentProfileId: agentId } });
      for (const activite of activites) {
        await tx.prospectActivity.create({ data: { prospectId: cree.id, type: activite.type, details: activite.details, createdAt: activite.createdAt } });
      }
      await tx.prospectActivity.create({ data: { prospectId: cree.id, type: "NOTE", details: JSON.stringify({ message: "Importé depuis la base locale" }) } });
      activitesCreees += activites.length + 1;
    });
    prospectsCrees++;
  }
  return { agentsCrees, prospectsCrees, dejaConnus, activitesCreees };
}
