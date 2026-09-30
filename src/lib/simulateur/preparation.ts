import { recalculerMain } from "@/lib/dossiers/main";
import { z } from "zod/v4";
import type { PreparationSimulation } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { alerter } from "@/lib/alertes/canaux";
import { avecActeur } from "@/lib/journal/contexte";
import { lireFichier, idPhoto, lirePhotos, estPhotoApres } from "@/lib/dossiers/stockage";
import { ouvrirEspace } from "@/lib/espace/liens";
import { photosDuClient } from "@/lib/espace/service";
import { mettreEnFile } from "@/lib/taches/file";
import { coutEstime, extensionDe, typeImage } from "@/lib/simulations/generation";
import { ecrireImageSimulation, lireImage } from "@/lib/simulations/dossier";
import { genererAvecMoteur, type SortiePipeline } from "@/lib/simulations/pipeline";
import { tailleSelonRatio } from "@/lib/simulations/cadrage";
import type { EtapeTravail } from "@/lib/simulations/travaux-lecture";
import { analyseDe, referenceObligatoire } from "./catalogue";
import { promptCourant } from "./bibliotheque";
import { directionArtistique } from "./moteur/direction-artistique";
import type { DefautRendu } from "./moteur/types";
import { etiquettes, formatDePhoto, rendrePrompt } from "./rendu";
import { qualitePourOrigine, reglagesSimulateur } from "./reglages";
import { decrireTeintePourPrompt, resumerTeinte } from "./teintes";
import { ZONES, estZone, lireZones, typeSurface, type IdZone } from "./types-surface";

/**
 * Préparer une simulation depuis le CRM — les étapes communes aux deux modes :
 * un dossier, une photo « avant » du client, un type de surface, une teinte
 * par zone. Puis :
 *  - ChatGPT : le prompt de la bibliothèque rempli avec les teintes (nom,
 *    référence, couleur mesurée, veinage, finition), la planche des teintes
 *    (image) et la photo cadrée au format de ChatGPT ; l'image rendue, déposée
 *    ensuite, reprend tout (version du prompt comprise) ;
 *  - API : la génération part en tâche de fond par le pipeline commun
 *    (`simulations/pipeline.ts` : moteur V1 ou V2 selon Paramètres —
 *    analyse de la photo réutilisée par empreinte, planche, contrôle du rendu),
 *    et l'image arrive en brouillon dans le dossier (ou publiée, pour le client).
 *
 * Mission 15 (partie 2) : plus aucune consigne demandée au site (`consigneDuSite`
 * a disparu) ; le prompt de la bibliothèque est lu AVANT le cadrage de la photo
 * (un type sans prompt ne laisse plus de fichier « avant » orphelin).
 */

export const TACHE_SIMULATION_API = "SIMULATION_API";
/** Mission 15 (partie 2) : analyse + rendu + contrôle + seconde tentative tiennent dans 8 min. */
export const DELAI_TACHE_API_MS = 480_000;

export const schemaPreparation = z.object({
  dossierId: z.string().min(1).max(40),
  photoId: z.string().min(1).max(80),
  typeSurface: z.string().min(1).max(40),
  zones: z.array(z.object({ zone: z.string().min(1).max(40), ref: z.string().min(1).max(40) })).min(1, "Choisissez au moins une teinte.").max(4, "Quatre zones au plus par simulation."),
  mode: z.enum(["CHATGPT", "API"]),
});

export type ZonePreparee = { zone: string; libelle: string; etiquette: string; ref: string; nom: string; resume: string; hex: string | null; description: string };

export type PreparationVue = {
  id: string;
  dossierId: string;
  mode: "CHATGPT" | "API";
  statut: string;
  /** Mission 15 : l'étape en cours d'une génération par l'API (analyse | matieres | rendu). */
  etape: string | null;
  typeSurface: string;
  typeLibelle: string;
  /** La photo du dossier choisie (identifiant public), pour rouvrir la préparation dans l'écran. */
  photoId: string;
  zones: ZonePreparee[];
  /** Le prompt : celui à copier (ChatGPT), ou celui que le moteur a donné au modèle (API, une fois générée). */
  prompt: string | null;
  promptVersion: number | null;
  format: string | null;
  photo: string;
  planche: string;
  coutEstime: number | null;
  erreur: string | null;
  resultatId: string | null;
  le: string;
  moteur: string | null;
  directionArtistique: string | null;
  scoreControle: number | null;
  /** Le score est sous le seuil du contrôle (Paramètres) : la pastille de l'écran passe en ambre. */
  sousSeuil: boolean;
  defautsControle: DefautRendu[];
  tentatives: number | null;
};

export function lireDefauts(json: string | null | undefined): DefautRendu[] {
  if (!json) return [];
  try {
    const lu: unknown = JSON.parse(json);
    return Array.isArray(lu) ? (lu as DefautRendu[]).filter((d) => d && typeof d === "object" && typeof d.detail === "string") : [];
  } catch {
    return [];
  }
}

function versVue(p: PreparationSimulation, seuilControle: number): PreparationVue {
  const zones = (() => {
    try {
      return JSON.parse(p.zones) as ZonePreparee[];
    } catch {
      return [];
    }
  })();
  const format = p.promptTexte ? (/(landscape 3:2|portrait 2:3|square 1:1|1536×1024 landscape|1024×1536 portrait|1024×1024 square)/.exec(p.promptTexte)?.[1] ?? null) : null;
  return {
    id: p.id,
    dossierId: p.dossierId,
    mode: p.mode === "API" ? "API" : "CHATGPT",
    statut: p.statut,
    etape: p.etape,
    typeSurface: p.typeSurface,
    typeLibelle: typeSurface(p.typeSurface)?.libelle ?? p.typeSurface,
    photoId: idPhoto(p.photoSource),
    zones,
    prompt: p.promptTexte,
    promptVersion: p.promptVersion,
    format,
    photo: `/api/simulateur/preparations/${p.id}/photo`,
    planche: `/api/simulateur/preparations/${p.id}/planche`,
    coutEstime: p.coutEstime,
    erreur: p.erreur,
    resultatId: p.resultatId,
    le: p.createdAt.toISOString(),
    moteur: p.moteur,
    directionArtistique: p.directionArtistique,
    scoreControle: p.scoreControle,
    sousSeuil: typeof p.scoreControle === "number" && p.scoreControle < seuilControle,
    defautsControle: lireDefauts(p.defautsControle),
    tentatives: p.tentatives,
  };
}

/** Photo recadrée au format du modèle (3:2, 2:3 ou carré), à pleine résolution : avant et après se superposent. */
async function cadrerPhoto(octets: Buffer): Promise<{ image: Buffer; largeur: number; hauteur: number }> {
  const sharp = (await import("sharp")).default;
  const tournee = sharp(octets).rotate();
  // Une photo HEIC d'iPhone déposée telle quelle (ancien iOS) ne se lit pas ici : on le dit, au lieu d'une erreur muette.
  const meta = await tournee.metadata().catch(() => {
    throw new ErreurMetier("Cette photo ne se lit pas ici (format HEIC d'iPhone, sans doute) : choisissez-en une autre, ou demandez-la au client en JPEG.", 400);
  });
  const quartTour = (meta.orientation ?? 1) >= 5;
  const largeur = (quartTour ? meta.height : meta.width) ?? 0;
  const hauteur = (quartTour ? meta.width : meta.height) ?? 0;
  if (!largeur || !hauteur) throw new ErreurMetier("Photo illisible : choisissez-en une autre.", 400);
  const [L, H] = tailleSelonRatio(largeur, hauteur).split("x").map(Number);
  const cible = L / H;
  let [w, h] = [largeur, hauteur];
  if (largeur / hauteur > cible) w = Math.round(hauteur * cible);
  else h = Math.round(largeur / cible);
  const image = await sharp(octets)
    .rotate()
    .extract({ left: Math.floor((largeur - w) / 2), top: Math.floor((hauteur - h) / 2), width: w, height: h })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { image, largeur: w, hauteur: h };
}

/** Photos du dossier proposées comme photo « avant » : celles du client, les plus récentes d'abord. */
export async function photosAvantDuDossier(dossierId: string): Promise<{ id: string; url: string }[]> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const photos = await photosDuClient(dossierId, dossier.photos);
  return photos.reverse().map((p) => ({ id: p.id, url: `/api/dossiers/${dossierId}/photos/${p.id}` }));
}

export async function preparerSimulation(entree: z.output<typeof schemaPreparation>, options: { origine?: "CRM" | "CLIENT" } = {}): Promise<PreparationVue> {
  const type = typeSurface(entree.typeSurface);
  if (!type) throw new ErreurMetier("Type de surface inconnu.", 400);
  const dossier = await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { id: true, photos: true, archiveLe: true } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const chemin = lirePhotos(dossier.photos).find((c) => idPhoto(c) === entree.photoId && !estPhotoApres(c));
  if (!chemin) throw new ErreurMetier("Photo introuvable dans ce dossier.", 404);

  const vues = new Set<string>();
  const choisies: { zone: IdZone; ref: string }[] = [];
  for (const { zone, ref } of entree.zones) {
    if (!estZone(zone) || !type.zones.includes(zone)) throw new ErreurMetier(`« ${zone} » n'est pas une zone du type ${type.libelle}.`, 400);
    if (vues.has(zone)) continue;
    vues.add(zone);
    choisies.push({ zone, ref });
  }
  // Ordre des zones du type : c'est l'ordre des lettres de la planche (A, B, C…).
  choisies.sort((a, b) => type.zones.indexOf(a.zone) - type.zones.indexOf(b.zone));
  const lettres = etiquettes(type, choisies.map((c) => c.zone));

  // Le prompt de la bibliothèque d'abord : un type sans prompt échoue AVANT d'écrire quoi que ce soit (photo cadrée).
  const prompt = entree.mode === "CHATGPT" ? await promptCourant(type.id) : null;
  const reglages = await reglagesSimulateur();

  const zones: ZonePreparee[] = [];
  const zonesMoteur = [];
  for (const { zone, ref } of choisies) {
    const reference = await referenceObligatoire(ref);
    const analyse = await analyseDe(ref);
    zones.push({
      zone,
      libelle: ZONES[zone].libelle,
      etiquette: lettres.get(zone)!,
      ref: reference.id,
      nom: reference.nom,
      resume: resumerTeinte(reference, analyse),
      hex: analyse?.hex ?? reference.hex ?? null,
      description: decrireTeintePourPrompt(reference, analyse, zone),
    });
    zonesMoteur.push({ zone, etiquette: lettres.get(zone)!.charAt(0) as "A" | "B" | "C" | "D", reference: { ref: reference.id, nom: reference.nom, famille: reference.famille, categorie: reference.categorie, finition: reference.finition, tags: reference.tags, hex: reference.hex ?? null, couleur: analyse } });
  }
  const direction = directionArtistique(type.projet, zonesMoteur);

  const octets = await lireFichier(chemin);
  if (!octets) throw new ErreurMetier("Photo introuvable sur le serveur.", 404);
  const cadree = await cadrerPhoto(octets);
  const photoAvant = await ecrireImageSimulation(dossier.id, cadree.image, "jpg", "-avant");

  const format = formatDePhoto(cadree.largeur, cadree.hauteur);
  const origine = options.origine ?? "CRM";
  const creee = await prisma.preparationSimulation.create({
    data: {
      dossierId: dossier.id,
      mode: entree.mode,
      origine,
      statut: entree.mode === "API" ? "EN_COURS" : "PREPAREE",
      photoSource: chemin,
      photoAvant,
      typeSurface: type.id,
      zones: JSON.stringify(zones),
      promptId: prompt?.promptId ?? null,
      promptVersion: prompt?.version ?? null,
      promptTexte: prompt ? rendrePrompt(prompt.texte, { type, zones: zones.map((z) => ({ zone: z.zone as IdZone, etiquette: z.etiquette, teinte: z.description })), format, directionArtistique: direction }) : null,
      coutEstime: entree.mode === "API" ? coutEstime(new Set(zones.map((z) => z.ref)).size, qualitePourOrigine(reglages, origine === "CLIENT" ? "ESPACE" : "CRM")) : null,
      moteur: entree.mode === "API" ? reglages.moteur : null,
      directionArtistique: direction,
    },
  });
  if (entree.mode === "API") {
    await mettreEnFile({ type: TACHE_SIMULATION_API, cle: `simulation-api:${creee.id}`, charge: { preparationId: creee.id }, priorite: 7, tentativesMax: 1 });
  }
  return versVue(creee, reglages.seuilControle);
}

export async function lirePreparation(id: string): Promise<PreparationVue> {
  const p = await prisma.preparationSimulation.findUnique({ where: { id } });
  if (!p) throw new ErreurMetier("Préparation introuvable.", 404);
  return versVue(p, (await reglagesSimulateur()).seuilControle);
}

export async function preparationsRecentes(dossierId: string): Promise<PreparationVue[]> {
  const [lignes, reglages] = await Promise.all([prisma.preparationSimulation.findMany({ where: { dossierId, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 12 }), reglagesSimulateur()]);
  return lignes.map((p) => versVue(p, reglages.seuilControle));
}

export async function photoDePreparation(id: string): Promise<{ contenu: Buffer; type: string }> {
  const p = await prisma.preparationSimulation.findUnique({ where: { id }, select: { photoAvant: true, photoSource: true } });
  if (!p) throw new ErreurMetier("Préparation introuvable.", 404);
  return lireImage(p.photoAvant ?? p.photoSource);
}

/* ── Mode API : la génération par le pipeline commun, ici ─────────── */

const ACTEUR_API = { acteur: "SYSTEME:simulateur", origine: "Simulation générée par l'API depuis le CRM" };
const ACTEUR_ESPACE = { acteur: "EXTERNE:espace-client", origine: "Simulation créée par le client dans son espace" };
/** Message d'échec quand OpenAI refuse faute de crédit : l'espace le reconnaît (préfixe) pour parler au client autrement. */
export const CREDIT_EPUISE = "Crédit OpenAI épuisé ou clé refusée : rechargez le crédit, puis relancez.";
/** La tâche a été reprise après une coupure (redéploiement pendant la génération) : OpenAI n'est jamais rappelé. */
export const MESSAGE_INTERROMPUE_API = "Génération interrompue par une mise à jour du service : relancez la simulation.";

type Reussite = Extract<SortiePipeline, { ok: true }>;

/** Ce que le moteur a produit, écrit sur la SimulationEspace et sur la préparation (visible au CRM). */
function traceDe(resultat: Reussite) {
  return {
    moteur: resultat.moteur,
    directionArtistique: resultat.directionArtistique,
    analyse: resultat.analyse ? JSON.stringify(resultat.analyse) : null,
    scoreControle: resultat.scoreControle,
    defautsControle: resultat.defautsControle ? JSON.stringify(resultat.defautsControle) : null,
    tentatives: resultat.tentatives,
  };
}

/**
 * Une simulation créée par le client dans son espace : visible tout de suite
 * dans sa galerie (c'est lui qui l'a faite, rien à relire), rangée dans le
 * dossier (et donc dans Drive), notée dans l'historique ; Lucas est prévenu —
 * un client qui simule se projette.
 */
async function publierSimulationDuClient(
  p: { id: string; dossierId: string; photoAvant: string | null; typeSurface: string },
  type: NonNullable<ReturnType<typeof typeSurface>>,
  zones: ReturnType<typeof lireZones>,
  resultat: Reussite,
  clientNom: string
): Promise<{ simulationId: string | null }> {
  return avecActeur(ACTEUR_ESPACE, async () => {
    const { espace } = await ouvrirEspace(p.dossierId);
    const chemin = await ecrireImageSimulation(p.dossierId, resultat.image, extensionDe(resultat.type ?? typeImage(resultat.image)));
    const ordre = await prisma.simulationEspace.count({ where: { espaceId: espace.id } });
    const maintenant = new Date();
    const titre = `Votre simulation — ${zones.map((z) => z.nom).join(", ")}`.slice(0, 80);
    const trace = traceDe(resultat);
    const simulation = await prisma.$transaction(async (tx) => {
      const creee = await tx.simulationEspace.create({
        data: { espaceId: espace.id, dossierId: p.dossierId, chemin, titre, ordre, source: "CLIENT", statut: "PUBLIEE", publieeLe: maintenant, vueLe: maintenant, photoAvant: p.photoAvant, typeSurface: p.typeSurface, zones: JSON.stringify(zones), promptTexte: resultat.prompt, preparationId: p.id, coutDollars: resultat.coutTotalDollars, ...trace },
      });
      await tx.preparationSimulation.update({ where: { id: p.id }, data: { statut: "TERMINEE", resultatId: creee.id, promptTexte: resultat.prompt, photoEmpreinte: resultat.empreinte, etape: "rendu", ...trace } });
      await tx.dossierEvenement.create({
        data: { dossierId: p.dossierId, type: "ESPACE_SIMULATION_CLIENT", direction: "ENTRANT", contenu: `Le client a créé une simulation dans son espace : ${zones.map((z) => `${z.libelle} — ${z.nom} (${z.ref})`).join(" · ")} (≈ ${resultat.coutTotalDollars.toFixed(2).replace(".", ",")} $${resultat.scoreControle !== null ? `, contrôle ${resultat.scoreControle}/10` : ""})`, metadata: JSON.stringify({ simulationId: creee.id, preparationId: p.id }) },
      });
      return creee;
    });
    await recalculerMain(p.dossierId);
    await alerter(
      { titre: `${clientNom} a créé une simulation`, texte: `${type.libelle} : ${zones.map((z) => `${z.libelle} ${z.nom}`).join(", ")}.
Il se projette : c'est le moment de l'appeler.`, lien: `${appUrl()}/dossiers?dossier=${p.dossierId}`, libelleLien: "Ouvrir le dossier", urgence: 3, etiquette: `simulation-client-${p.dossierId}` },
      { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch(() => undefined);
    return { simulationId: simulation.id };
  });
}
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

export async function executerGenerationApi(preparationId: string, signal?: AbortSignal): Promise<{ simulationId: string | null }> {
  const p = await prisma.preparationSimulation.findUnique({ where: { id: preparationId } });
  if (!p || p.mode !== "API" || p.statut !== "EN_COURS") return { simulationId: p?.resultatId ?? null };
  const type = typeSurface(p.typeSurface);
  const zones = lireZones(p.zones);
  const dossier = await prisma.dossier.findUnique({ where: { id: p.dossierId }, select: { clientNom: true } });
  const echouer = async (message: string) => {
    await prisma.preparationSimulation.update({ where: { id: p.id }, data: { statut: "ECHEC", erreur: message.slice(0, 500) } });
    await alerter(
      { titre: `Simulation non générée — ${dossier?.clientNom ?? "dossier"}`, texte: message, lien: `${appUrl()}/simulateur?dossier=${p.dossierId}`, libelleLien: "Ouvrir le simulateur", urgence: 3, etiquette: `simulation-${p.dossierId}` },
      { origine: "simulateur", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch(() => undefined);
    return { simulationId: null };
  };
  if (!type) return echouer("Type de surface inconnu.");
  const zonesMoteur = zones.filter((z) => estZone(z.zone)).map((z) => ({ zone: z.zone as IdZone, ref: z.ref }));
  if (zonesMoteur.length === 0) return echouer("Aucune zone connue dans cette préparation.");
  const photo = await lireFichier(p.photoAvant ?? p.photoSource);
  if (!photo) return echouer("Photo avant introuvable sur le serveur.");
  const duClient = p.origine === "CLIENT";
  const reglages = await reglagesSimulateur();
  // Comme le site (`demarreLe`) : la première étape est posée d'un seul geste, seulement si aucune ne l'était.
  // Une préparation déjà démarrée (tâche réclamée une seconde fois après un redéploiement) devient ECHEC sans
  // rappeler OpenAI — l'analyse, le rendu et le contrôle déjà payés ne le seraient pas deux fois.
  const demarreLe = Date.now();
  const { count } = await prisma.preparationSimulation.updateMany({ where: { id: p.id, statut: "EN_COURS", etape: null }, data: { etape: reglages.moteur === "V2" ? "analyse" : "rendu" } });
  if (count !== 1) return echouer(MESSAGE_INTERROMPUE_API);
  const surEtape = async (etape: EtapeTravail) => {
    await prisma.preparationSimulation.updateMany({ where: { id: p.id, statut: "EN_COURS" }, data: { etape } }).catch(() => undefined);
  };
  let resultat: SortiePipeline;
  try {
    resultat = await genererAvecMoteur({ photo, piece: type.projet, zones: zonesMoteur, origine: duClient ? "ESPACE" : "CRM", reglages, dossierId: p.dossierId, preparationId: p.id, echeance: demarreLe + DELAI_TACHE_API_MS, surEtape, signal });
  } catch (erreur) {
    return echouer(erreur instanceof Error ? erreur.message : "Génération impossible.");
  }
  if (!resultat.ok) return echouer(resultat.raison === "service-indisponible" || resultat.raison === "config" ? CREDIT_EPUISE : resultat.message);
  if (duClient) return publierSimulationDuClient(p, type, zones, resultat, dossier?.clientNom ?? "Le client");

  const trace = traceDe(resultat);
  return avecActeur(ACTEUR_API, async () => {
    const { espace } = await ouvrirEspace(p.dossierId);
    const chemin = await ecrireImageSimulation(p.dossierId, resultat.image, extensionDe(resultat.type ?? typeImage(resultat.image)));
    const ordre = await prisma.simulationEspace.count({ where: { espaceId: espace.id } });
    const simulation = await prisma.$transaction(async (tx) => {
      const creee = await tx.simulationEspace.create({
        data: {
          espaceId: espace.id,
          dossierId: p.dossierId,
          chemin,
          titre: `${type.libelle} — ${zones.map((z) => z.nom).join(", ")}`.slice(0, 80),
          ordre,
          source: "API",
          statut: "BROUILLON",
          photoAvant: p.photoAvant,
          typeSurface: p.typeSurface,
          zones: JSON.stringify(zones),
          promptTexte: resultat.prompt,
          preparationId: p.id,
          coutDollars: resultat.coutTotalDollars,
          ...trace,
        },
      });
      await tx.preparationSimulation.update({ where: { id: p.id }, data: { statut: "TERMINEE", resultatId: creee.id, promptTexte: resultat.prompt, photoEmpreinte: resultat.empreinte, etape: "rendu", ...trace } });
      await tx.dossierEvenement.create({ data: { dossierId: p.dossierId, type: "SIMULATION_BROUILLON", direction: "INTERNE", contenu: `Simulation générée par l'API en brouillon : ${creee.titre} (≈ ${resultat.coutTotalDollars.toFixed(2).replace(".", ",")} $${resultat.scoreControle !== null ? `, contrôle ${resultat.scoreControle}/10` : ""}, moteur ${resultat.moteur})`, metadata: JSON.stringify({ simulationId: creee.id, preparationId: p.id }) } });
      return creee;
    });
    await recalculerMain(p.dossierId);
    await alerter(
      { titre: `Simulation prête — ${dossier?.clientNom ?? "dossier"}`, texte: `${simulation.titre}\nEn brouillon : à relire, puis publier dans l'espace du client.`, lien: `${appUrl()}/dossiers?dossier=${p.dossierId}`, libelleLien: "Ouvrir le dossier", urgence: 3, etiquette: `simulation-${p.dossierId}` },
      { origine: "simulateur", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch(() => undefined);
    return { simulationId: simulation.id };
  });
}
