import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { lireImage } from "@/lib/simulations/dossier";
import { imagePourResultat, IMAGES_MAX_PAR_RESULTAT } from "../images";
import { definirOutil, format, lien, type ImageOutil } from "../definition";

/**
 * « simulations_site » (mission 11) : les simulations faites sur coverswap.fr,
 * anonymes (un parcours navigateur, une page, une source) ou rattachées à un
 * lead, rendues comme de vraies images (après, et avant quand elle existe).
 * Ce qui a été purgé (30 jours sans demande) est dit sans image.
 */

type Reference = { zone?: string; libelle?: string; ref?: string; nom?: string };
const lireReferences = (json: string): Reference[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as Reference[]) : [];
  } catch {
    return [];
  }
};
const LIBELLES_PROJET: Record<string, string> = { cuisine: "cuisine", "salle-de-bain": "salle de bain", meubles: "meubles", "mur-plafond": "mur / plafond", professionnel: "professionnel" };

export const outilSimulationsSite = definirOutil({
  nom: "simulations_site",
  titre: "Les simulations faites sur le site coverswap.fr",
  description:
    "Rend les simulations faites sur le site (avec leurs images) : anonymes — un visiteur qui n'a pas laissé ses coordonnées — ou rattachées à un lead, du plus récent au plus ancien. Pour chacune : la date, le projet, les teintes essayées, la page et la source, la campagne, le lead rattaché. Par défaut les 7 derniers jours et 4 images ; « rattachees » pour ne voir que les unes ou les autres ; « lead_id » pour celles d'un lead. Les simulations purgées (30 jours sans demande) sont dites sans image.",
  niveau: "LECTURE",
  schema: z.object({
    jours: z.number().int().min(1).max(365).optional().describe("Fenêtre en jours (7 par défaut)."),
    rattachees: z.boolean().optional().describe("Vrai : seulement celles rattachées à un lead ; faux : seulement les anonymes ; absent : toutes."),
    lead_id: z.string().max(40).optional(),
    nombre: z.number().int().min(1).max(8).optional().describe("Nombre de simulations décrites et montrées (4 par défaut)."),
    sans_images: z.boolean().optional().describe("Vrai : description seule, aucune image jointe."),
  }),
  executer: async (e, contexte) => {
    const depuis = new Date(contexte.maintenant.getTime() - (e.jours ?? 7) * 24 * 60 * 60_000);
    const lignes = await prisma.simulationSite.findMany({
      where: { createdAt: { gte: depuis }, ...(e.lead_id ? { leadId: e.lead_id } : e.rattachees === true ? { leadId: { not: null } } : e.rattachees === false ? { leadId: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const total = lignes.length;
    const choisies = lignes.slice(0, e.nombre ?? 4);
    const leads = new Map((await prisma.lead.findMany({ where: { id: { in: choisies.map((s) => s.leadId).filter((x): x is string => Boolean(x)) } }, select: { id: true, prenom: true, nom: true, ville: true } })).map((l) => [l.id, `${l.prenom} ${l.nom}`.trim() + (l.ville ? ` (${l.ville})` : "")]));
    const images: ImageOutil[] = [];
    const textes: string[] = [];
    for (const [i, s] of choisies.entries()) {
      const references = lireReferences(s.references);
      const teintes = references.length ? references.map((r) => `${r.libelle || r.zone || "zone"} : ${r.nom || r.ref || "?"}${r.ref && r.nom ? ` (${r.ref})` : ""}`).join(", ") : "teintes non renseignées";
      const qui = s.leadId ? `rattachée à ${leads.get(s.leadId) ?? "un lead"} [lead:${s.leadId}]` : "anonyme (pas de coordonnées laissées)";
      const titre = `Simulation site ${i + 1} du ${format.jourCourt(s.createdAt)} — ${LIBELLES_PROJET[s.projet] ?? s.projet} — ${teintes}${s.referenceChoisie ? ` — teinte retenue ${s.referenceChoisie}` : ""} — ${qui}${s.page ? ` — page ${s.page}` : ""}${s.source ? ` — source ${s.source}` : ""}${s.campagne ? ` — campagne ${s.campagne}` : ""}${s.archiveLe ? " — purgée (images effacées)" : ""} [simulation_site:${s.id}]`;
      textes.push(titre);
      if (e.sans_images || s.archiveLe || images.length >= IMAGES_MAX_PAR_RESULTAT) continue;
      const apres = s.imageAfterPath ? await imagePourResultat((await lireImage(s.imageAfterPath).catch(() => null))?.contenu ?? null, `${titre} — APRÈS`) : null;
      if (apres) images.push(apres);
      if (s.imageBeforePath && images.length < IMAGES_MAX_PAR_RESULTAT) {
        const avant = await imagePourResultat((await lireImage(s.imageBeforePath).catch(() => null))?.contenu ?? null, `Simulation site ${i + 1} — AVANT (photo du visiteur)`);
        if (avant) images.push(avant);
      }
    }
    const anonymes = lignes.filter((s) => !s.leadId).length;
    const texte = total === 0 ? `Aucune simulation faite sur le site sur ${e.jours ?? 7} jour(s)${e.lead_id ? " pour ce lead" : ""}.` : [`${total} simulation(s) sur le site sur ${e.jours ?? 7} jour(s) : ${anonymes} anonyme(s), ${total - anonymes} rattachée(s) à un lead ; ${choisies.length} décrite(s), ${images.length} image(s) jointe(s).`, ...textes].join("\n");
    return { texte, images, donnees: { total, anonymes, simulations: choisies.map((s) => ({ id: s.id, le: s.createdAt.toISOString(), projet: s.projet, references: lireReferences(s.references), referenceChoisie: s.referenceChoisie, page: s.page, source: s.source, campagne: s.campagne, leadId: s.leadId, rattacheeLe: s.rattacheeLe?.toISOString() ?? null, purgee: Boolean(s.archiveLe) })) }, liens: [lien("Synthèse", "/synthese")] };
  },
});

export const OUTILS_SITE = [outilSimulationsSite];
