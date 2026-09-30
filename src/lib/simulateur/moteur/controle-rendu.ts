import { ZONES_SIMULATEUR, type IdZone } from "../zones";
import type { DefautRendu, ResultatControle } from "./types";
import { appelerVision, imageEnDataUrl, type ContexteVision, type ResultatVision } from "./vision";

/**
 * Le contrôle automatique du rendu (mission 15, partie 2) : après la
 * génération, un appel vision compare la photo et le rendu et note de 0 à 10,
 * avec la liste des défauts typés. Sous le seuil (`SIMULATEUR_SEUIL_CONTROLE`),
 * une seconde génération rappelle ces défauts dans FINAL CHECK ; la meilleure
 * des deux est gardée. Le client ne voit que le rendu final ; Lucas voit le
 * score et les défauts dans le CRM.
 */

export const TYPES_DEFAUT: readonly DefautRendu["type"][] = ["objet-disparu", "objet-ajoute", "facades-differentes", "zone-non-couverte", "debordement", "aspect-3d", "autre"];
export const SEUIL_CONTROLE_PAR_DEFAUT = 7;

export const SCHEMA_CONTROLE: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Pas de minimum/maximum : la sortie stricte d'OpenAI ne les accepte pas ; la borne est dite dans le texte et appliquée à la lecture.
    score: { type: "integer" },
    defauts: { type: "array", items: { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: [...TYPES_DEFAUT] }, detail: { type: "string" } }, required: ["type", "detail"] } },
  },
  required: ["score", "defauts"],
};

const SYSTEME = `You are a demanding quality controller for photorealistic surface-covering visualisations. You compare a client's photograph (image 1) with a rendering (image 2) in which ONLY the listed zones were supposed to receive a new adhesive decor film. You score honestly and list concrete defects in English. Return JSON.`;

function texteDemande(zones: { zone: IdZone; ref: string; nom: string }[]): string {
  const liste = zones.map((z) => `- ${ZONES_SIMULATEUR[z.zone].nomCourt}: ${z.ref} "${z.nom}"`).join("\n");
  return `Zones that were supposed to change, and the film assigned to each:
${liste}

Score the rendering from 0 to 10 (10 = a real, professionally photographed room where only those zones changed, each wearing its own film exactly, everything else identical to the photograph).
List every defect you can see, one entry per defect, with a precise "detail" in English (which object, which door, which zone):
- "objet-disparu": an object of the photograph is missing or melted into a surface;
- "objet-ajoute": an object, a handle, a light, a window or a person was added;
- "facades-differentes": doors, drawers, panels or handles changed in count, size, shape or position;
- "zone-non-couverte": a listed zone (or part of it) still shows its old material;
- "debordement": the film spread beyond its zone, onto a wall, a floor, an appliance or another zone;
- "aspect-3d": the image looks like a render, a collage or a CGI, or the materials look flat, plastic or blurred;
- "autre": anything else (colour cast, wrong film on a zone, framing changed…).
An empty list means no defect.`;
}

export function lireControle(brut: unknown): ResultatControle | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const score = Number(o.score);
  if (!Number.isFinite(score)) return null;
  const defauts: DefautRendu[] = Array.isArray(o.defauts)
    ? o.defauts
        .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
        .map((d) => ({ type: (TYPES_DEFAUT as readonly string[]).includes(String(d.type)) ? (d.type as DefautRendu["type"]) : "autre", detail: String(d.detail ?? "").trim().slice(0, 300) }))
        .filter((d) => d.detail.length > 0)
        .slice(0, 12)
    : [];
  return { score: Math.max(0, Math.min(10, Math.round(score))), defauts };
}

/** Compare la photo et le rendu ; ne lève jamais (une raison de saut sinon). */
export async function controlerRendu(photo: Buffer, rendu: Buffer, zones: { zone: IdZone; ref: string; nom: string }[], contexte: ContexteVision = {}): Promise<ResultatVision<ResultatControle>> {
  return appelerVision<ResultatControle>(
    "controle",
    { systeme: SYSTEME, texte: texteDemande(zones), images: [await imageEnDataUrl(photo), await imageEnDataUrl(rendu)], schema: { nom: "controle_rendu", json: SCHEMA_CONTROLE }, jetonsSortieMax: 700, signal: contexte.signal },
    lireControle,
    contexte
  );
}

/** Les défauts en phrases courtes pour FINAL CHECK (« the kettle disappeared from the worktop »). */
export function defautsEnPhrases(controle: ResultatControle | null | undefined): string[] {
  return (controle?.defauts ?? []).map((d) => d.detail).filter(Boolean).slice(0, 6);
}
