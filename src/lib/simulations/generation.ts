import prisma from "@/lib/prisma";
import { cadrerPourGeneration, recadrerRendu, tailleSelonRatio, type TailleSortie } from "./cadrage";
import { MESSAGES_ECHEC, alerterPanneSimulateur, classerErreurOpenAI, type RaisonEchec } from "@/lib/site/erreurs-generation";
import { pluriel } from "@/lib/commun/format";
import { coutEnDollars as coutEnDollarsPrix, type Qualite, type Usage } from "./prix";

/**
 * LE générateur d'images des simulations — un seul, pour toutes les portes :
 *  - le simulateur du site (/api/simulate, travail asynchrone) ;
 *  - l'espace client et le simulateur du CRM en mode API ;
 *  - le banc de comparaison (partie 3).
 *
 * Réglage validé en production (mai 2026) : `input_fidelity: high` (LE levier
 * contre la dérive de teinte, l'application partielle et les modifications
 * parasites). La qualité (`low | medium | high`) vient des paramètres
 * (mission 15 : medium pour le site, high pour l'espace et le CRM). La photo est
 * mise au format du modèle avant l'envoi (cadrage.ts) : avant et après restent
 * superposables.
 *
 * Mission 15 (partie 2) : les images jointes sont fournies par l'appelant —
 * `planche` (l'Image 2 étiquetée) ou `swatches` (échantillons bruts, lus dans
 * le cache du CRM) ; `swatchUrls` reste accepté pour le prompt V1 du site
 * (téléchargés en parallèle). Sortie JPEG q90 (`output_format`,
 * `output_compression`) : des rendus trois à cinq fois plus légers sur le
 * volume. Chaque appel écrit une ligne `GenerationImage` (phase `rendu`).
 */

// Seuls les hôtes de Cover Styl' sont autorisés pour les échantillons (anti-SSRF).
const HOTES_ECHANTILLONS = new Set(["ssi.s3.fr-par.scw.cloud", "cms.coverstyl.com"]);
// OpenAI peut être lent (input_fidelity high : 40 à 90 s). Railway n'a pas de plafond ; on coupe à 180 s.
export const DELAI_OPENAI_MS = 180_000;

export { PRIX, coutEstime, type Qualite, type Usage } from "./prix";

export const modeleImage = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const baseOpenAI = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

export function coutEnDollars(usage: Usage, modele = modeleImage()): number {
  return coutEnDollarsPrix(usage, modele);
}

type Sortie = { status: number; raison: RaisonEchec | "swatch-download-failed" | "no-image-data" | "config"; message: string };

export type TypeImage = "image/jpeg" | "image/png";

export type ResultatGeneration =
  | { ok: true; image: Buffer; /** Type réel du rendu, lu dans ses octets : JPEG depuis la mission 15 (`output_format`), PNG si le modèle en rend un malgré tout. */ type: TypeImage; avant: Buffer | null; taille: TailleSortie; dureeMs: number; usage: Usage; coutDollars: number; generationId: string | null }
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

/** Le type d'une image d'après ses premiers octets (PNG, sinon JPEG). */
export function typeImage(buf: Buffer): TypeImage {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 ? "image/png" : "image/jpeg";
}

export const extensionDe = (type: TypeImage): "png" | "jpg" => (type === "image/png" ? "png" : "jpg");

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
  /** `rendu` (défaut) ou `ambiance` (image d'illustration du site, mission 16 : sans photo, sans dossier). */
  phase?: "rendu" | "ambiance";
  /** Le modèle noté (défaut : celui des rendus) ; `essai` pour une image unie du mode essai, jamais facturée. */
  modele?: string;
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
        modele: ligne.modele ?? modeleImage(),
        phase: ligne.phase ?? "rendu",
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

export type EntreeGeneration = {
  prompt: string;
  photo: Buffer;
  origine: "SITE" | "CRM" | "ESPACE";
  /** Échantillons bruts à télécharger (prompt V1 du site) — ignorés si `swatches` ou `planche` est donné. */
  swatchUrls?: string[];
  /** Échantillons bruts déjà lus (cache du CRM) : Images 2, 3… */
  swatches?: Buffer[];
  /** La planche étiquetée : Image 2. */
  planche?: Buffer | null;
  qualite?: Qualite;
  dossierId?: string | null;
  preparationId?: string | null;
  signal?: AbortSignal;
};

/* ── Générateur remplaçable pour les essais (aucun appel OpenAI d'un test) ── */
export type Generateur = (entree: EntreeGeneration) => Promise<ResultatGeneration>;
const CLE_GENERATEUR = "__coverswapGenerateurSiteEssai";
const globalEssai = globalThis as unknown as Record<string, Generateur | null | undefined>;

/** Essais seulement : remplace le générateur d'images pour toutes les portes (null : revient au vrai). */
export function definirGenerateurEssai(generateur: Generateur | null): void {
  if (generateur) globalEssai[CLE_GENERATEUR] = generateur;
  else delete globalEssai[CLE_GENERATEUR];
}
/** Le générateur en vigueur : celui des essais s'il est posé, sinon le vrai (OpenAI). */
export const generateurEnVigueur = (): Generateur => globalEssai[CLE_GENERATEUR] ?? genererRendu;

export async function genererRendu(entree: EntreeGeneration): Promise<ResultatGeneration> {
  const debut = Date.now();
  const cle = process.env.OPENAI_API_KEY;
  if (!cle) return { ok: false, dureeMs: 0, status: 503, raison: "config", message: MESSAGES_ECHEC["service-indisponible"] };
  const swatchUrls = entree.swatchUrls ?? [];
  const nombreJoint = () => (entree.planche ? 1 : (entree.swatches?.length ?? swatchUrls.length));
  const echec = async (sortie: Sortie, detail?: string): Promise<ResultatGeneration> => {
    const dureeMs = Date.now() - debut;
    await noter({ origine: entree.origine, statut: "ECHEC", erreur: `${sortie.raison}${detail ? ` : ${detail}` : ""}`, dureeMs, echantillons: nombreJoint(), dossierId: entree.dossierId, preparationId: entree.preparationId });
    return { ok: false, dureeMs, ...sortie };
  };

  // 1) Les images jointes après la photo : la planche, ou les échantillons bruts (fournis, sinon téléchargés en parallèle —
  //    tous requis : mieux vaut refuser que laisser le modèle inventer une couleur).
  let jointes: { octets: Buffer; type: string; nom: string }[];
  if (entree.planche) jointes = [{ octets: entree.planche, type: "image/png", nom: "board.png" }];
  else if (entree.swatches) jointes = entree.swatches.map((octets, i) => ({ octets, type: "image/jpeg", nom: `sample_${i + 1}.jpg` }));
  else {
    const telecharges = await Promise.all(swatchUrls.map(telechargerEchantillon));
    if (telecharges.some((t) => !t)) return { ok: false, dureeMs: Date.now() - debut, status: 502, raison: "swatch-download-failed", message: "Impossible de charger les références de texture. Réessayez dans un instant." };
    jointes = telecharges.map((octets, i) => ({ octets: octets!, type: "image/jpeg", nom: `sample_${i + 1}.jpg` }));
  }

  // 2) Photo au format du modèle : sans cela il recadre à sa façon et le rendu n'est plus superposable.
  const dims = dimensionsImage(entree.photo);
  const cadrage = await cadrerPourGeneration(entree.photo, dims ? tailleSelonRatio(dims.width, dims.height) : "1024x1024");

  // 3) Appel OpenAI.
  const formulaire = new FormData();
  formulaire.append("model", modeleImage());
  formulaire.append("prompt", entree.prompt);
  formulaire.append("size", cadrage.taille);
  formulaire.append("quality", entree.qualite ?? "medium");
  formulaire.append("input_fidelity", "high");
  formulaire.append("output_format", "jpeg");
  formulaire.append("output_compression", "90");
  formulaire.append("image[]", new Blob([new Uint8Array(cadrage.photo)], { type: cadrage.type }), "room.png");
  for (const j of jointes) formulaire.append("image[]", new Blob([new Uint8Array(j.octets)], { type: j.type }), j.nom);

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_OPENAI_MS);
  entree.signal?.addEventListener("abort", () => controleur.abort(), { once: true });
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
  console.log(`[simulate] OK en ${dureeMs} ms (${cadrage.taille}, ${entree.qualite ?? "medium"}, ${entree.planche ? "planche" : pluriel(jointes.length, "échantillon")}, ${entree.origine}) ${JSON.stringify(donnees.usage ?? {})} ≈ ${coutDollars} $`);
  const generationId = await noter({ origine: entree.origine, statut: "REUSSI", dureeMs, taille: cadrage.taille, echantillons: jointes.length, usage, coutDollars, dossierId: entree.dossierId, preparationId: entree.preparationId });
  return { ok: true, image, type: typeImage(image), avant: cadrage.avant, taille: cadrage.taille, dureeMs, usage, coutDollars, generationId };
}

/* ── Images d'ambiance du site (mission 16, partie 2) : texte → image, sans photo ni dossier ── */

/** Les trois formats de sortie du modèle. */
export type FormatAmbiance = TailleSortie;

/** Le corps envoyé à `POST /images/generations`. */
export type DemandeAmbiance = { model: string; prompt: string; size: FormatAmbiance; quality: Qualite; n: 1; output_format: "png" };

/** La réponse du service d'images : l'image en base64 et les jetons consommés, ou le statut et le corps d'une erreur. */
export type ReponseAmbiance = { ok: true; b64: string; usage: Usage } | { ok: false; status: number; texte: string };

/** L'appel au service d'images ; remplaçable (le mode `--essai` du script rend une image unie, sans réseau). */
export type AppelAmbiance = (demande: DemandeAmbiance, signal: AbortSignal) => Promise<ReponseAmbiance>;

export type ResultatAmbiance =
  | { ok: true; image: Buffer; dureeMs: number; usage: Usage; coutDollars: number; generationId: string | null }
  | ({ ok: false; dureeMs: number } & Omit<Sortie, "raison"> & { raison: RaisonEchec | "no-image-data" | "config" });

/** L'appel réel : `POST <OpenAI>/images/generations` (JSON), sortie PNG en base64 et jetons consommés. */
async function appelAmbianceOpenAI(demande: DemandeAmbiance, signal: AbortSignal): Promise<ReponseAmbiance> {
  const reponse = await fetch(`${baseOpenAI()}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify(demande), signal });
  if (!reponse.ok) return { ok: false, status: reponse.status, texte: await reponse.text().catch(() => "") };
  const donnees = (await reponse.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[];
    usage?: { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; input_tokens?: number; output_tokens?: number };
  };
  const detail = donnees.usage?.input_tokens_details;
  const usage: Usage = { texte: detail?.text_tokens ?? (detail ? 0 : (donnees.usage?.input_tokens ?? 0)), image: detail?.image_tokens ?? 0, sortie: donnees.usage?.output_tokens ?? 0 };
  return { ok: true, b64: donnees.data?.[0]?.b64_json ?? "", usage };
}

/**
 * Une image d'ambiance pour le site (mission 16, partie 2) : `gpt-image-1` sur un prompt seul, qualité `high` par
 * défaut, sortie PNG. Jamais une photo de client, jamais présentée comme un chantier (étiquette « Ambiance » sur le
 * site). Chaque appel écrit une ligne `GenerationImage` (origine CRM, phase `ambiance`, sans dossier) : le coût se lit
 * avec les autres dépenses du simulateur. Lancée seulement par `scripts/generer-ambiances.ts`, jamais par un test
 * (qui passe `appel`).
 */
export async function genererAmbiance(entree: { prompt: string; format: FormatAmbiance; qualite?: Qualite; signal?: AbortSignal }, options: { appel?: AppelAmbiance; modele?: string } = {}): Promise<ResultatAmbiance> {
  const debut = Date.now();
  if (!options.appel && !process.env.OPENAI_API_KEY) return { ok: false, dureeMs: 0, status: 503, raison: "config", message: "OPENAI_API_KEY absente." };
  const appel = options.appel ?? appelAmbianceOpenAI;
  const modele = options.modele ?? modeleImage();
  const qualite = entree.qualite ?? "high";
  const echec = async (sortie: Omit<Extract<ResultatAmbiance, { ok: false }>, "ok" | "dureeMs">, detail?: string): Promise<ResultatAmbiance> => {
    const dureeMs = Date.now() - debut;
    await noter({ origine: "CRM", phase: "ambiance", modele, statut: "ECHEC", erreur: `${sortie.raison}${detail ? ` : ${detail}` : ""}`, dureeMs, taille: entree.format, echantillons: 0 });
    return { ok: false, dureeMs, ...sortie };
  };

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_OPENAI_MS);
  entree.signal?.addEventListener("abort", () => controleur.abort(), { once: true });
  let reponse: ReponseAmbiance;
  try {
    reponse = await appel({ model: modele, prompt: entree.prompt, size: entree.format, quality: qualite, n: 1, output_format: "png" }, controleur.signal);
  } catch (erreur) {
    const delai = erreur instanceof Error && (erreur.name === "AbortError" || /aborted/i.test(erreur.message));
    return echec({ status: delai ? 504 : 502, raison: delai ? "delai" : "surcharge", message: delai ? MESSAGES_ECHEC.delai : MESSAGES_ECHEC.surcharge }, erreur instanceof Error ? erreur.message.slice(0, 200) : undefined);
  } finally {
    clearTimeout(minuterie);
  }
  if (!reponse.ok) {
    const raison = classerErreurOpenAI(reponse.status, reponse.texte);
    return echec({ status: raison === "service-indisponible" ? 503 : 502, raison, message: MESSAGES_ECHEC[raison] }, `HTTP ${reponse.status} ${reponse.texte.slice(0, 200)}`);
  }
  if (!reponse.b64) return echec({ status: 502, raison: "no-image-data", message: "Aucune image générée." });
  const image = Buffer.from(reponse.b64, "base64");
  const coutDollars = coutEnDollars(reponse.usage, modele);
  const dureeMs = Date.now() - debut;
  const generationId = await noter({ origine: "CRM", phase: "ambiance", modele, statut: "REUSSI", dureeMs, taille: entree.format, echantillons: 0, usage: reponse.usage, coutDollars });
  return { ok: true, image, dureeMs, usage: reponse.usage, coutDollars, generationId };
}
