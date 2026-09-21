import prisma from "@/lib/prisma";
import { cadrerPourGeneration, recadrerRendu, tailleSelonRatio, type TailleSortie } from "./cadrage";
import { MESSAGES_ECHEC, alerterPanneSimulateur, classerErreurOpenAI, type RaisonEchec } from "@/lib/site/erreurs-generation";

/**
 * LE générateur d'images des simulations — un seul, pour toutes les portes :
 *  - le simulateur du site (/api/simulate : consigne construite et signée par
 *    le site, image générée ici) ;
 *  - le simulateur du CRM en mode API (consigne demandée au site, même
 *    fichier de prompts, puis générée ici).
 *
 * Réglage validé en production (mai 2026) : `input_fidelity: high` (LE levier
 * contre la dérive de teinte, l'application partielle et les modifications
 * parasites) et `quality: medium` (le passage à high triplait le coût sans
 * gain sur ces symptômes). La photo est mise au format du modèle avant l'envoi
 * (cadrage.ts) : avant et après restent superposables.
 *
 * Chaque appel écrit une ligne `GenerationImage` (jetons, coût en dollars) :
 * c'est le compteur de consommation du simulateur.
 */

// Seuls les hôtes de Cover Styl' sont autorisés pour les échantillons (anti-SSRF).
const HOTES_ECHANTILLONS = new Set(["ssi.s3.fr-par.scw.cloud", "cms.coverstyl.com"]);
// OpenAI peut être lent (input_fidelity high : 40 à 90 s). Railway n'a pas de plafond ; on coupe à 180 s.
const DELAI_OPENAI_MS = 180_000;

/** Prix publics en dollars par million de jetons (entrée texte, entrée image, sortie image). */
const PRIX: Record<string, { texte: number; image: number; sortie: number }> = {
  "gpt-image-1": { texte: 5, image: 10, sortie: 40 },
  "gpt-image-1-mini": { texte: 2, image: 2.5, sortie: 8 },
};

export const modeleImage = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const baseOpenAI = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

export type Usage = { texte: number; image: number; sortie: number };

export function coutEnDollars(usage: Usage, modele = modeleImage()): number {
  const prix = PRIX[modele] ?? PRIX["gpt-image-1"];
  return Math.round(((usage.texte * prix.texte + usage.image * prix.image + usage.sortie * prix.sortie) / 1_000_000) * 10_000) / 10_000;
}

/** Coût annoncé AVANT de lancer (mesuré en production, qualité medium, 1536 × 1024) : 0,21 $ avec un échantillon, +0,066 $ par échantillon de plus. */
export function coutEstime(echantillons: number): number {
  return Math.round((0.21 + 0.066 * Math.max(0, echantillons - 1)) * 100) / 100;
}

type Sortie = { status: number; raison: RaisonEchec | "swatch-download-failed" | "no-image-data" | "config"; message: string };

export type ResultatGeneration =
  | { ok: true; image: Buffer; avant: Buffer | null; taille: TailleSortie; dureeMs: number; usage: Usage; coutDollars: number; generationId: string | null }
  | ({ ok: false; dureeMs: number } & Sortie);

/** Dimensions d'une image JPEG ou PNG, lues dans ses premiers octets. */
export function dimensionsImage(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      offset += 2 + buf.readUInt16BE(offset + 2);
    }
  }
  return null;
}

async function telechargerEchantillon(url: string): Promise<Buffer | null> {
  try {
    const adresse = new URL(url);
    if (adresse.protocol !== "https:" || !HOTES_ECHANTILLONS.has(adresse.hostname)) {
      console.error(`[simulate] hôte d'échantillon refusé : ${adresse.hostname}`);
      return null;
    }
    const reponse = await fetch(adresse, { signal: AbortSignal.timeout(8000) });
    if (!reponse.ok) return null;
    return Buffer.from(await reponse.arrayBuffer());
  } catch {
    return null;
  }
}

async function noter(ligne: {
  origine: "SITE" | "CRM" | "ESPACE";
  statut: "REUSSI" | "ECHEC";
  erreur?: string | null;
  dureeMs: number;
  taille?: string | null;
  echantillons: number;
  usage?: Usage;
  coutDollars?: number | null;
  dossierId?: string | null;
  preparationId?: string | null;
}): Promise<string | null> {
  try {
    const creee = await prisma.generationImage.create({
      data: {
        origine: ligne.origine,
        modele: modeleImage(),
        statut: ligne.statut,
        erreur: ligne.erreur?.slice(0, 500) ?? null,
        dureeMs: ligne.dureeMs,
        taille: ligne.taille ?? null,
        echantillons: ligne.echantillons,
        jetonsTexte: ligne.usage?.texte ?? 0,
        jetonsImage: ligne.usage?.image ?? 0,
        jetonsSortie: ligne.usage?.sortie ?? 0,
        coutDollars: ligne.coutDollars ?? null,
        dossierId: ligne.dossierId ?? null,
        preparationId: ligne.preparationId ?? null,
      },
    });
    return creee.id;
  } catch (erreur) {
    console.error("[simulate] consommation non enregistrée (non bloquant) :", erreur);
    return null;
  }
}

export async function genererRendu(entree: {
  prompt: string;
  swatchUrls: string[];
  photo: Buffer;
  origine: "SITE" | "CRM" | "ESPACE";
  dossierId?: string | null;
  preparationId?: string | null;
}): Promise<ResultatGeneration> {
  const debut = Date.now();
  const cle = process.env.OPENAI_API_KEY;
  if (!cle) return { ok: false, dureeMs: 0, status: 503, raison: "config", message: MESSAGES_ECHEC["service-indisponible"] };
  const echec = async (sortie: Sortie, detail?: string): Promise<ResultatGeneration> => {
    const dureeMs = Date.now() - debut;
    await noter({ origine: entree.origine, statut: "ECHEC", erreur: `${sortie.raison}${detail ? ` : ${detail}` : ""}`, dureeMs, echantillons: entree.swatchUrls.length, dossierId: entree.dossierId, preparationId: entree.preparationId });
    return { ok: false, dureeMs, ...sortie };
  };

  // 1) Échantillons : tous requis — mieux vaut refuser que laisser le modèle inventer une couleur.
  const echantillons: Buffer[] = [];
  for (const url of entree.swatchUrls) {
    const octets = await telechargerEchantillon(url);
    if (!octets) return { ok: false, dureeMs: Date.now() - debut, status: 502, raison: "swatch-download-failed", message: "Impossible de charger les références de texture. Réessayez dans un instant." };
    echantillons.push(octets);
  }

  // 2) Photo au format du modèle : sans cela il recadre à sa façon et le rendu n'est plus superposable.
  const dims = dimensionsImage(entree.photo);
  const cadrage = await cadrerPourGeneration(entree.photo, dims ? tailleSelonRatio(dims.width, dims.height) : "1024x1024");

  // 3) Appel OpenAI.
  const formulaire = new FormData();
  formulaire.append("model", modeleImage());
  formulaire.append("prompt", entree.prompt);
  formulaire.append("size", cadrage.taille);
  formulaire.append("quality", "medium");
  formulaire.append("input_fidelity", "high");
  formulaire.append("image[]", new Blob([new Uint8Array(cadrage.photo)], { type: cadrage.type }), "kitchen.png");
  echantillons.forEach((octets, i) => formulaire.append("image[]", new Blob([new Uint8Array(octets)], { type: "image/jpeg" }), `texture_${i}.jpg`));

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_OPENAI_MS);
  let reponse: Response;
  try {
    reponse = await fetch(`${baseOpenAI()}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${cle}` }, body: formulaire, signal: controleur.signal });
  } catch (erreur) {
    clearTimeout(minuterie);
    const delai = erreur instanceof Error && (erreur.name === "AbortError" || /aborted/i.test(erreur.message));
    console.error(`[simulate] OpenAI ${delai ? "délai dépassé" : "injoignable"} après ${Date.now() - debut} ms :`, erreur);
    return echec({ status: delai ? 504 : 502, raison: delai ? "delai" : "surcharge", message: delai ? MESSAGES_ECHEC.delai : MESSAGES_ECHEC.surcharge });
  }
  clearTimeout(minuterie);

  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => "");
    const raison = classerErreurOpenAI(reponse.status, texte);
    console.error(`[simulate] OpenAI HTTP ${reponse.status} (${raison}) :`, texte.slice(0, 400));
    if (raison === "service-indisponible") void alerterPanneSimulateur(reponse.status, texte);
    return echec({ status: raison === "service-indisponible" ? 503 : 502, raison, message: MESSAGES_ECHEC[raison] }, `HTTP ${reponse.status} ${texte.slice(0, 200)}`);
  }

  const donnees = (await reponse.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[];
    usage?: { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; input_tokens?: number; output_tokens?: number };
  };
  const b64 = donnees.data?.[0]?.b64_json;
  if (!b64) {
    console.error("[simulate] réponse OpenAI sans image");
    return echec({ status: 502, raison: "no-image-data", message: "Aucune image générée. Réessayez." });
  }
  const image = await recadrerRendu(Buffer.from(b64, "base64"), cadrage);
  const detail = donnees.usage?.input_tokens_details;
  const usage: Usage = {
    texte: detail?.text_tokens ?? (detail ? 0 : (donnees.usage?.input_tokens ?? 0)),
    image: detail?.image_tokens ?? 0,
    sortie: donnees.usage?.output_tokens ?? 0,
  };
  const coutDollars = coutEnDollars(usage);
  const dureeMs = Date.now() - debut;
  console.log(`[simulate] OK en ${dureeMs} ms (${cadrage.taille}, ${echantillons.length} échantillon(s), ${entree.origine}) ${JSON.stringify(donnees.usage ?? {})} ≈ ${coutDollars} $`);
  const generationId = await noter({ origine: entree.origine, statut: "REUSSI", dureeMs, taille: cadrage.taille, echantillons: echantillons.length, usage, coutDollars, dossierId: entree.dossierId, preparationId: entree.preparationId });
  return { ok: true, image, avant: cadrage.avant, taille: cadrage.taille, dureeMs, usage, coutDollars, generationId };
}
