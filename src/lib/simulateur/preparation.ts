import { createHmac } from "node:crypto";
import { recalculerMain } from "@/lib/dossiers/main";
import { z } from "zod/v4";
import type { PreparationSimulation } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { alerter } from "@/lib/alertes/canaux";
import { avecActeur } from "@/lib/journal/contexte";
import { lireFichier, idPhoto, lirePhotos, estPhotoApres } from "@/lib/dossiers/stockage";
import { adresseDuSite, ouvrirEspace } from "@/lib/espace/liens";
import { photosDuClient } from "@/lib/espace/service";
import { mettreEnFile } from "@/lib/taches/file";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { coutEstime, genererRendu } from "@/lib/simulations/generation";
import { ecrireImageSimulation, lireImage } from "@/lib/simulations/dossier";
import { tailleSelonRatio } from "@/lib/simulations/cadrage";
import { analyseDe, referenceObligatoire } from "./catalogue";
import { promptCourant } from "./bibliotheque";
import { etiquettes, formatDePhoto, rendrePrompt } from "./rendu";
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
 *  - API : la consigne est demandée au SITE (même moteur, mêmes prompts que le
 *    simulateur public), l'image est générée ici en tâche de fond, et arrive
 *    en brouillon dans le dossier.
 */

export const TACHE_SIMULATION_API = "SIMULATION_API";

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
  typeSurface: string;
  typeLibelle: string;
  /** La photo du dossier choisie (identifiant public), pour rouvrir la préparation dans l'écran. */
  photoId: string;
  zones: ZonePreparee[];
  prompt: string | null;
  promptVersion: number | null;
  format: string | null;
  photo: string;
  planche: string;
  coutEstime: number | null;
  erreur: string | null;
  resultatId: string | null;
  le: string;
};

function versVue(p: PreparationSimulation): PreparationVue {
  const zones = (() => {
    try {
      return JSON.parse(p.zones) as ZonePreparee[];
    } catch {
      return [];
    }
  })();
  const format = p.promptTexte ? (/(landscape 3:2|portrait 2:3|square 1:1)/.exec(p.promptTexte)?.[1] ?? null) : null;
  return {
    id: p.id,
    dossierId: p.dossierId,
    mode: p.mode === "API" ? "API" : "CHATGPT",
    statut: p.statut,
    typeSurface: p.typeSurface,
    typeLibelle: typeSurface(p.typeSurface)?.libelle ?? p.typeSurface,
    photoId: idPhoto(p.photoSource),
    zones,
    prompt: p.mode === "CHATGPT" ? p.promptTexte : null,
    promptVersion: p.promptVersion,
    format,
    photo: `/api/simulateur/preparations/${p.id}/photo`,
    planche: `/api/simulateur/preparations/${p.id}/planche`,
    coutEstime: p.coutEstime,
    erreur: p.erreur,
    resultatId: p.resultatId,
    le: p.createdAt.toISOString(),
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

  const octets = await lireFichier(chemin);
  if (!octets) throw new ErreurMetier("Photo introuvable sur le serveur.", 404);
  const cadree = await cadrerPhoto(octets);
  const photoAvant = await ecrireImageSimulation(dossier.id, cadree.image, "jpg", "-avant");

  const zones: ZonePreparee[] = [];
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
      hex: analyse?.hex ?? null,
      description: decrireTeintePourPrompt(reference, analyse, zone),
    });
  }

  const format = formatDePhoto(cadree.largeur, cadree.hauteur);
  const prompt = entree.mode === "CHATGPT" ? await promptCourant(type.id) : null;
  const creee = await prisma.preparationSimulation.create({
    data: {
      dossierId: dossier.id,
      mode: entree.mode,
      origine: options.origine ?? "CRM",
      statut: entree.mode === "API" ? "EN_COURS" : "PREPAREE",
      photoSource: chemin,
      photoAvant,
      typeSurface: type.id,
      zones: JSON.stringify(zones),
      promptId: prompt?.promptId ?? null,
      promptVersion: prompt?.version ?? null,
      promptTexte: prompt ? rendrePrompt(prompt.texte, { type, zones: zones.map((z) => ({ zone: z.zone as IdZone, etiquette: z.etiquette, teinte: z.description })), format }) : null,
      coutEstime: entree.mode === "API" ? coutEstime(new Set(zones.map((z) => z.ref)).size) : null,
    },
  });
  if (entree.mode === "API") {
    await mettreEnFile({ type: TACHE_SIMULATION_API, cle: `simulation-api:${creee.id}`, charge: { preparationId: creee.id }, priorite: 7, tentativesMax: 1 });
  }
  return versVue(creee);
}

export async function lirePreparation(id: string): Promise<PreparationVue> {
  const p = await prisma.preparationSimulation.findUnique({ where: { id } });
  if (!p) throw new ErreurMetier("Préparation introuvable.", 404);
  return versVue(p);
}

export async function preparationsRecentes(dossierId: string): Promise<PreparationVue[]> {
  const lignes = await prisma.preparationSimulation.findMany({ where: { dossierId, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 12 });
  return lignes.map(versVue);
}

export async function photoDePreparation(id: string): Promise<{ contenu: Buffer; type: string }> {
  const p = await prisma.preparationSimulation.findUnique({ where: { id }, select: { photoAvant: true, photoSource: true } });
  if (!p) throw new ErreurMetier("Préparation introuvable.", 404);
  return lireImage(p.photoAvant ?? p.photoSource);
}

/* ── Mode API : la consigne du site, l'image générée ici ─────────── */

/** Demande au site la consigne de son moteur (mêmes prompts que le simulateur public), requête signée. */
export async function consigneDuSite(projet: string, selections: { surface: string; ref: string }[]): Promise<{ prompt: string; swatchUrls: string[] }> {
  const secret = process.env.SIMULATE_TOKEN_SECRET;
  if (!secret) throw new ErreurDefinitive("SIMULATE_TOKEN_SECRET absente : le CRM ne peut pas demander la consigne au site.");
  const corps = JSON.stringify({ project_type: projet, selections });
  const horodatage = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${horodatage}\n${corps}`).digest("hex");
  const reponse = await fetch(`${adresseDuSite()}/api/simulation/consigne`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-coverswap-horodatage": horodatage, "x-coverswap-signature": signature },
    body: corps,
    signal: AbortSignal.timeout(15_000),
  }).catch((erreur: unknown) => {
    throw new Error(`site injoignable (${erreur instanceof Error ? erreur.message : "réseau"})`);
  });
  const donnees = (await reponse.json().catch(() => ({}))) as { prompt?: string; swatchUrls?: string[]; error?: string };
  if (!reponse.ok || !donnees.prompt || !Array.isArray(donnees.swatchUrls)) {
    const message = donnees.error ?? `le site a répondu HTTP ${reponse.status}`;
    if (reponse.status >= 400 && reponse.status < 500) throw new ErreurDefinitive(`Consigne refusée par le site : ${message}`);
    throw new Error(`Consigne indisponible : ${message}`);
  }
  return { prompt: donnees.prompt, swatchUrls: donnees.swatchUrls };
}

const ACTEUR_API = { acteur: "SYSTEME:simulateur", origine: "Simulation générée par l'API depuis le CRM" };
const ACTEUR_ESPACE = { acteur: "EXTERNE:espace-client", origine: "Simulation créée par le client dans son espace" };
/** Message d'échec quand OpenAI refuse faute de crédit : l'espace le reconnaît (préfixe) pour parler au client autrement. */
export const CREDIT_EPUISE = "Crédit OpenAI épuisé ou clé refusée : rechargez le crédit, puis relancez.";

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
  prompt: string,
  image: Buffer,
  coutDollars: number,
  clientNom: string
): Promise<{ simulationId: string | null }> {
  return avecActeur(ACTEUR_ESPACE, async () => {
    const { espace } = await ouvrirEspace(p.dossierId);
    const chemin = await ecrireImageSimulation(p.dossierId, image, "png");
    const ordre = await prisma.simulationEspace.count({ where: { espaceId: espace.id } });
    const maintenant = new Date();
    const titre = `Votre simulation — ${zones.map((z) => z.nom).join(", ")}`.slice(0, 80);
    const simulation = await prisma.$transaction(async (tx) => {
      const creee = await tx.simulationEspace.create({
        data: { espaceId: espace.id, dossierId: p.dossierId, chemin, titre, ordre, source: "CLIENT", statut: "PUBLIEE", publieeLe: maintenant, vueLe: maintenant, photoAvant: p.photoAvant, typeSurface: p.typeSurface, zones: JSON.stringify(zones), promptTexte: prompt, preparationId: p.id, coutDollars },
      });
      await tx.preparationSimulation.update({ where: { id: p.id }, data: { statut: "TERMINEE", resultatId: creee.id } });
      await tx.dossierEvenement.create({
        data: { dossierId: p.dossierId, type: "ESPACE_SIMULATION_CLIENT", direction: "ENTRANT", contenu: `Le client a créé une simulation dans son espace : ${zones.map((z) => `${z.libelle} — ${z.nom} (${z.ref})`).join(" · ")} (≈ ${coutDollars.toFixed(2).replace(".", ",")} $)`, metadata: JSON.stringify({ simulationId: creee.id, preparationId: p.id }) },
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

export async function executerGenerationApi(preparationId: string): Promise<{ simulationId: string | null }> {
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
  let consigne: { prompt: string; swatchUrls: string[] };
  try {
    consigne = await consigneDuSite(type.projet, zones.map((z) => ({ surface: z.zone, ref: z.ref })));
  } catch (erreur) {
    return echouer(erreur instanceof Error ? erreur.message : "Consigne indisponible.");
  }
  const photo = await lireFichier(p.photoAvant ?? p.photoSource);
  if (!photo) return echouer("Photo avant introuvable sur le serveur.");
  const duClient = p.origine === "CLIENT";
  const resultat = await genererRendu({ prompt: consigne.prompt, swatchUrls: consigne.swatchUrls, photo, origine: duClient ? "ESPACE" : "CRM", dossierId: p.dossierId, preparationId: p.id });
  if (!resultat.ok) return echouer(resultat.raison === "service-indisponible" || resultat.raison === "config" ? CREDIT_EPUISE : resultat.message);
  if (duClient) return publierSimulationDuClient(p, type, zones, consigne.prompt, resultat.image, resultat.coutDollars, dossier?.clientNom ?? "Le client");

  return avecActeur(ACTEUR_API, async () => {
    const { espace } = await ouvrirEspace(p.dossierId);
    const chemin = await ecrireImageSimulation(p.dossierId, resultat.image, "png");
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
          promptTexte: consigne.prompt,
          preparationId: p.id,
          coutDollars: resultat.coutDollars,
        },
      });
      await tx.preparationSimulation.update({ where: { id: p.id }, data: { statut: "TERMINEE", resultatId: creee.id } });
      await tx.dossierEvenement.create({ data: { dossierId: p.dossierId, type: "SIMULATION_BROUILLON", direction: "INTERNE", contenu: `Simulation générée par l'API en brouillon : ${creee.titre} (≈ ${resultat.coutDollars.toFixed(2).replace(".", ",")} $)`, metadata: JSON.stringify({ simulationId: creee.id, preparationId: p.id }) } });
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
