import { ZONES_SIMULATEUR, piece as lirePiece, zonesCouvertes, zonesElementaires, type IdPiece, type IdZone, type IdZoneElementaire } from "../zones";
import { formatDepuisDimensions, type AnalysePhoto, type FormatImage } from "./types";
import { appelerVision, imageEnDataUrl, type ContexteVision, type ResultatVision } from "./vision";

/**
 * L'analyse de la photo (mission 15, partie 2) : AVANT la génération, un appel
 * vision décrit la pièce (3 à 5 phrases, style « THE KITCHEN IN IMAGE 1 »), dit
 * quelles zones sont visibles, liste les objets, la lumière, le format, et
 * juge la qualité de la photo avec un conseil pour le visiteur. Le résultat
 * nourrit le prompt (THE ROOM IN IMAGE 1, NOT COVERED, LOCKED) et l'écran
 * (zones non visibles grisées, conseil de qualité).
 */

const VERDICTS = ["bonne", "floue", "sombre", "contre-jour", "trop-loin"] as const;

export function schemaAnalyse(zones: IdZoneElementaire[]): Record<string, unknown> {
  const zonesVisibles: Record<string, unknown> = {};
  for (const z of zones) zonesVisibles[z] = { type: "object", additionalProperties: false, properties: { visible: { type: "boolean" }, description: { type: "string" } }, required: ["visible", "description"] };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string" },
      zones_visibles: { type: "object", additionalProperties: false, properties: zonesVisibles, required: zones },
      objets: { type: "array", items: { type: "string" } },
      lumiere: { type: "object", additionalProperties: false, properties: { source: { type: "string" }, direction: { type: "string" }, temperature: { type: "string" }, dominante: { type: "string" } }, required: ["source", "direction", "temperature", "dominante"] },
      format: { type: "string", enum: ["paysage", "portrait", "carre"] },
      qualite_photo: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: [...VERDICTS] }, conseil: { type: "string" } }, required: ["verdict", "conseil"] },
    },
    required: ["description", "zones_visibles", "objets", "lumiere", "format", "qualite_photo"],
  };
}

const SYSTEME = `You are an interior photographer's assistant preparing a surface-covering visualisation. You describe a client's photograph precisely and honestly, in English, for a rendering brief; the advice to the client is written in French (vouvoiement), short and kind. Never invent what is not visible.`;

function texteDemande(pieceId: IdPiece, zones: IdZoneElementaire[]): string {
  const p = lirePiece(pieceId);
  const liste = zones.map((z) => `- ${z}: ${ZONES_SIMULATEUR[z].nom} — ${ZONES_SIMULATEUR[z].cible}`).join("\n");
  return `The image is the photograph of ${p.nomEn} taken by a client with a phone. Return JSON.
1. "description": 3 to 5 sentences in English describing exactly what the photograph shows, in the style of a rendering brief titled "THE ${p.titreEn} IN IMAGE 1": layout, furniture and their current materials and colours, worktops or tops, floor, walls, windows, notable objects, camera position. Facts only.
2. "zones_visibles": for each zone below, "visible": true if at least part of it clearly appears in the photograph, false otherwise; "description": one short English sentence saying where it is in the frame and its current material and colour (empty string if not visible).
${liste}
3. "objets": the objects and living things present that must stay untouched (in English, short noun phrases, 4 to 15 items: appliances, taps, plants, dishes, cables, people, pets…).
4. "lumiere": "source" (daylight from a window, ceiling spots, mixed…), "direction" (from the left, from behind the camera…), "temperature" (warm, neutral, cool), "dominante" (any colour cast: none, warm orange, greenish…). In English.
5. "format": "paysage" if wider than tall, "portrait" if taller than wide, "carre" otherwise.
6. "qualite_photo": "verdict" — "bonne" if the photo is usable as is; "floue" if blurred; "sombre" if too dark; "contre-jour" if a strong backlight blackens the subject; "trop-loin" if the surfaces to cover are too small in the frame. "conseil": one French sentence for the client (vouvoiement) — how to retake a better photo if needed, or an empty string when the verdict is "bonne".`;
}

export function lireAnalyse(brut: unknown, zones: IdZoneElementaire[], formatMesure: FormatImage | null): AnalysePhoto | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.description !== "string" || !o.zones_visibles || typeof o.zones_visibles !== "object") return null;
  const zonesVisibles: AnalysePhoto["zones_visibles"] = {};
  for (const z of zones) {
    const v = (o.zones_visibles as Record<string, unknown>)[z];
    if (v && typeof v === "object") zonesVisibles[z] = { visible: Boolean((v as { visible?: unknown }).visible), description: String((v as { description?: unknown }).description ?? "").slice(0, 300) };
  }
  const lumiere = (o.lumiere && typeof o.lumiere === "object" ? o.lumiere : {}) as Record<string, unknown>;
  const qualite = (o.qualite_photo && typeof o.qualite_photo === "object" ? o.qualite_photo : {}) as Record<string, unknown>;
  const verdict = (VERDICTS as readonly string[]).includes(String(qualite.verdict)) ? (qualite.verdict as AnalysePhoto["qualite_photo"]["verdict"]) : "bonne";
  const formatLu = ["paysage", "portrait", "carre"].includes(String(o.format)) ? (o.format as FormatImage) : "paysage";
  return {
    description: o.description.trim().slice(0, 1500),
    zones_visibles: zonesVisibles,
    objets: Array.isArray(o.objets) ? o.objets.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 80)).slice(0, 20) : [],
    lumiere: { source: String(lumiere.source ?? "").slice(0, 120), direction: String(lumiere.direction ?? "").slice(0, 120), temperature: String(lumiere.temperature ?? "").slice(0, 60), dominante: String(lumiere.dominante ?? "").slice(0, 60) },
    format: formatMesure ?? formatLu,
    qualite_photo: { verdict, conseil: String(qualite.conseil ?? "").trim().slice(0, 300) },
  };
}

/** L'analyse d'une photo : appel vision (simulé en essai), sortie validée. Ne lève jamais : une raison de saut sinon. */
export async function analyserPhoto(photo: Buffer, pieceId: IdPiece, zonesPossibles: IdZoneElementaire[] = zonesElementaires(pieceId), contexte: ContexteVision = {}): Promise<ResultatVision<AnalysePhoto>> {
  const zones = zonesPossibles.length ? zonesPossibles : zonesElementaires(pieceId);
  const format = await formatDeLaPhoto(photo);
  return appelerVision<AnalysePhoto>(
    "analyse",
    { systeme: SYSTEME, texte: texteDemande(pieceId, zones), images: [await imageEnDataUrl(photo)], schema: { nom: "analyse_photo", json: schemaAnalyse(zones) }, jetonsSortieMax: 900, signal: contexte.signal },
    (brut) => lireAnalyse(brut, zones, format),
    contexte
  );
}

/** Les dimensions d'une image (octets ou chemin absolu), orientation EXIF appliquée ; null si elle est illisible. */
export async function dimensionsImage(source: Buffer | string): Promise<{ largeur: number; hauteur: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(source).rotate().metadata();
    const tourne = (meta.orientation ?? 1) >= 5;
    const largeur = (tourne ? meta.height : meta.width) ?? 0;
    const hauteur = (tourne ? meta.width : meta.height) ?? 0;
    return largeur && hauteur ? { largeur, hauteur } : null;
  } catch {
    return null;
  }
}

/** Le format de la photo, mesuré (jamais demandé au modèle). */
export async function formatDeLaPhoto(photo: Buffer): Promise<FormatImage | null> {
  const dims = await dimensionsImage(photo);
  return dims ? formatDepuisDimensions(dims.largeur, dims.hauteur) : null;
}

/** Une zone choisie est-elle visible d'après l'analyse ? Une zone composée l'est si l'une de ses zones l'est ; une zone inconnue de l'analyse l'est (jamais bloquer à tort). */
export function zoneVisible(analyse: AnalysePhoto | null | undefined, zone: IdZone): boolean {
  if (!analyse) return true;
  const composantes = zonesCouvertes(zone);
  const connues = composantes.filter((z) => analyse.zones_visibles[z] !== undefined);
  if (connues.length === 0) return true;
  return connues.some((z) => analyse.zones_visibles[z]?.visible === true);
}

/** Les zones choisies que l'analyse ne voit pas sur la photo (409 « zone-non-visible »). */
export function zonesNonVisibles(analyse: AnalysePhoto | null | undefined, zones: IdZone[]): IdZone[] {
  return zones.filter((z) => !zoneVisible(analyse, z));
}
