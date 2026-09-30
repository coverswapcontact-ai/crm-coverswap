import prisma from "@/lib/prisma";
import { rendreSimulation } from "@/lib/acces/limite-site";
import { assurerDossierDeSimulation } from "@/lib/dossiers/depuis-lead";
import { rattacherImagesSimulation } from "@/lib/simulations/images";
import { generateurSite } from "@/lib/simulations/travaux";
import { enregistrerSimulationSite, rattacherSimulationsSite, type ReferenceSimulee } from "@/lib/site/simulations";

/**
 * ANCIEN contrat de POST /api/simulate (synchrone) : le site d'avant la mission
 * 15 appelle sans le champ `asynchrone: true` et attend l'image dans la réponse.
 * Gardé à l'identique PENDANT LA TRANSITION (le site se déploie après le CRM) ;
 * à retirer en partie 4, une fois le site déployé. Extraction pure de la route.
 */

export type EntreeSynchrone = {
  prompt: string;
  swatchUrls: string[];
  photoBase64: string;
  ip: string;
  leadId?: string;
  referenceChoisie?: string;
  parcoursId?: string;
  projet?: unknown;
  references: ReferenceSimulee[];
  page?: unknown;
  source?: unknown;
  campagne?: unknown;
};

export type ReponseSynchrone = { status: number; corps: Record<string, unknown> };

export async function genererEtGarderSynchrone(entree: EntreeSynchrone): Promise<ReponseSynchrone> {
  const { prompt, swatchUrls, leadId, referenceChoisie, parcoursId, projet, page, source, campagne, references, ip } = entree;
  const photo_base64 = entree.photoBase64;
  try {
    const rawBase64 = photo_base64.replace(/^data:image\/\w+;base64,/, "");
    // Le même générateur que la tâche (remplaçable pour les essais : aucun appel OpenAI d'un test).
    const resultat = await generateurSite()({ prompt, swatchUrls, photo: Buffer.from(rawBase64, "base64"), origine: "SITE" });
    if (!resultat.ok) {
      // Panne de notre côté (crédit épuisé, clé refusée) : le quota est rendu au visiteur,
      // qui lit un message clair et peut laisser ses coordonnées ; le gérant est prévenu par mail.
      if (resultat.raison === "service-indisponible" || resultat.raison === "config") rendreSimulation(ip);
      const raison = resultat.raison === "config" ? "service-indisponible" : resultat.raison;
      return { status: resultat.status, corps: { error: resultat.message, reason: raison } };
    }
    // Le rendu est JPEG depuis la mission 15 (`output_format`) : la data URL, et donc l'extension des fichiers, suivent son type réel.
    const rendu = `data:${resultat.type};base64,${resultat.image.toString("base64")}`;
    const cadrage = { avant: resultat.avant };
    const startMs = Date.now() - resultat.dureeMs;

    // Photo avant + rendu après : sur la simulation du lead (ancien parcours), ou
    // gardés avec le parcours en attendant la demande de devis (jamais bloquant).
    let simulationId: string | null = null;
    let simulationSiteId: string | null = null;
    if (!leadId && parcoursId) {
      try {
        const gardee = await enregistrerSimulationSite({
          parcoursId,
          projet: typeof projet === "string" ? projet.slice(0, 40) : "cuisine",
          references,
          imageAvantBase64: photo_base64,
          imageApresBase64: rendu,
          page: typeof page === "string" ? page.slice(0, 200) : null,
          source: typeof source === "string" ? source.slice(0, 120) : null,
          campagne: typeof campagne === "string" ? campagne.slice(0, 120) : null,
          ipOrigine: ip === "inconnue" ? null : ip,
          dureeMs: Date.now() - startMs,
        });
        simulationSiteId = gardee.id;
        console.log(`[simulate] simulation gardée parcours=${parcoursId} id=${gardee.id}`);
        // La personne a déjà laissé ses coordonnées pendant ce parcours : la nouvelle simulation rejoint sa fiche et son dossier.
        const connu = await prisma.lead.findFirst({ where: { parcoursId }, orderBy: { createdAt: "desc" }, select: { id: true } });
        if (connu) {
          await rattacherSimulationsSite(connu.id, parcoursId, [gardee.id]);
          await assurerDossierDeSimulation(connu.id);
        }
      } catch (err) {
        console.error("[simulate] simulation du parcours non gardée (non bloquant) :", err);
      }
    }
    if (leadId) {
      try {
        simulationId = await rattacherImagesSimulation(leadId, photo_base64, rendu, referenceChoisie ?? null);
        console.log(`[simulate] images rattachées lead=${leadId} simulation=${simulationId ?? "?"}`);
        await assurerDossierDeSimulation(leadId);
      } catch (err) {
        console.error("[simulate] rattachement des images impossible (non bloquant) :", err);
      }
    }

    return {
      status: 200,
      // imageAvant : la photo au cadrage exact du rendu (rognée au format du modèle), pour un avant / après superposable.
      corps: { success: true, image: rendu, imageAvant: cadrage.avant ? `data:image/jpeg;base64,${cadrage.avant.toString("base64")}` : null, simulationId, simulationSiteId },
    };
  } catch (err) {
    console.error("[simulate] erreur:", err);
    return { status: 500, corps: { error: "Service indisponible.", reason: "internal" } };
  }
}
