import crypto from "crypto";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { reference } from "@/lib/simulateur/catalogue";
import { ZONES_MAX, ZONES_SIMULATEUR, estIdPiece, estIdZone, piece as lirePiece, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import type { ReferenceSimulee } from "./simulations";

/**
 * Mission 15 (partie 4) — le contrat de `POST /api/simulate` quand le site n'est
 * plus qu'un client du CRM : il ne construit plus de prompt. Il envoie la pièce
 * et les sélections `{ surface, ref }` signées par `coverswap.fr/api/simulation/prepare`
 * (captcha, pot de miel, validation), avec l'expiration et le parcours :
 *   sig = HMAC-SHA256(SIMULATE_TOKEN_SECRET, chaineSigneeSelections(...))
 * Le CRM recalcule la chaîne depuis ce qu'il reçoit (même ordre, même forme),
 * puis relit lui-même les zones (source unique `zones.ts`) et les références
 * (catalogue du site) : rien du navigateur n'entre dans la consigne.
 *
 * La chaîne signée est la même des deux côtés (site : `lib/simulateur/signature.ts`).
 */

export type SelectionSite = { surface: string; ref: string };

export type EntreeSignature = { parcoursId: string; projet: string; selections: SelectionSite[]; exp: number };

/** Une ligne par élément, dans l'ordre reçu : `v2 \n parcours \n projet \n surface:ref,surface:ref \n exp`. */
export function chaineSigneeSelections(entree: EntreeSignature): string {
  return `v2\n${entree.parcoursId}\n${entree.projet}\n${entree.selections.map((s) => `${s.surface}:${s.ref}`).join(",")}\n${entree.exp}`;
}

export function signatureSelections(secret: string, entree: EntreeSignature): string {
  return crypto.createHmac("sha256", secret).update(chaineSigneeSelections(entree)).digest("hex");
}

/** Comparaison en temps constant ; une signature mal formée vaut faux. */
export function signatureValide(secret: string, sig: string, attendue: string): boolean {
  const recue = Buffer.from(sig, "hex");
  const calculee = Buffer.from(attendue, "hex");
  return recue.length > 0 && recue.length === calculee.length && crypto.timingSafeEqual(recue, calculee);
}

/** Les sélections telles que le navigateur les envoie ; null si le champ n'est pas une liste lisible. */
export function lireSelectionsCorps(brut: unknown): SelectionSite[] | null {
  if (!Array.isArray(brut)) return null;
  const selections: SelectionSite[] = [];
  for (const item of brut.slice(0, 8)) {
    if (!item || typeof item !== "object") return null;
    const { surface, ref } = item as { surface?: unknown; ref?: unknown };
    if (typeof surface !== "string" || typeof ref !== "string" || !surface || !ref || surface.length > 40 || ref.length > 24) return null;
    selections.push({ surface, ref });
  }
  return selections;
}

export type LectureSelections =
  | { ok: true; piece: IdPiece; zones: { zone: IdZone; ref: string }[]; references: ReferenceSimulee[] }
  | { ok: false; status: number; raison: string; message: string };

/**
 * Relit les sélections signées : pièce connue, zones de cette pièce (sans
 * doublon), au plus ZONES_MAX, pas deux zones qui couvrent les mêmes meubles,
 * références présentes au catalogue. Les libellés viennent de la source unique
 * des zones, les noms du catalogue : ce sont eux qui partent au moteur et dans
 * la fiche, jamais un texte du navigateur.
 */
export async function resoudreSelections(projet: string, selections: SelectionSite[]): Promise<LectureSelections> {
  if (!estIdPiece(projet)) return { ok: false, status: 400, raison: "projet", message: "Pièce inconnue : rechargez la page." };
  const zonesDeLaPiece = new Set<string>(lirePiece(projet).zones);
  const vues = new Set<IdZone>();
  const zones: { zone: IdZone; ref: string }[] = [];
  for (const s of selections) {
    if (!estIdZone(s.surface) || !zonesDeLaPiece.has(s.surface)) return { ok: false, status: 400, raison: "zone-inconnue", message: `La zone « ${s.surface.slice(0, 30)} » n'existe pas pour cette pièce : rechargez la page.` };
    if (vues.has(s.surface)) continue;
    vues.add(s.surface);
    zones.push({ zone: s.surface, ref: s.ref });
  }
  if (zones.length === 0) return { ok: false, status: 400, raison: "aucune-zone", message: "Choisissez au moins une zone et sa matière." };
  if (zones.length > ZONES_MAX) return { ok: false, status: 400, raison: "trop-de-zones", message: `Au plus ${ZONES_MAX} zones par simulation : retirez-en une, vous pourrez relancer une simulation ensuite.` };
  for (const z of zones) {
    const conflit = (ZONES_SIMULATEUR[z.zone].exclut ?? []).find((autre) => vues.has(autre));
    if (conflit) return { ok: false, status: 400, raison: "surfaces-incompatibles", message: `« ${ZONES_SIMULATEUR[z.zone].libelle} » et « ${ZONES_SIMULATEUR[conflit].libelle} » couvrent les mêmes meubles : gardez l'une ou l'autre.` };
  }
  const references: ReferenceSimulee[] = [];
  for (const z of zones) {
    let connue: Awaited<ReturnType<typeof reference>>;
    try {
      connue = await reference(z.ref);
    } catch (erreur) {
      // Catalogue du site injoignable ET aucune copie sur le volume : une panne de notre côté, dite comme telle.
      const message = erreur instanceof ErreurMetier ? erreur.message : "Catalogue momentanément indisponible : réessayez dans un instant.";
      return { ok: false, status: 503, raison: "service-indisponible", message };
    }
    if (!connue) return { ok: false, status: 400, raison: "reference-inconnue", message: `La référence ${z.ref.slice(0, 12)} n'est plus au catalogue : choisissez-en une autre.` };
    references.push({ zone: z.zone, libelle: ZONES_SIMULATEUR[z.zone].libelle, ref: connue.id, nom: connue.nom });
  }
  return { ok: true, piece: projet, zones, references };
}
