import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireProjet } from "@/lib/espace/projet";
import { famillesDe, lireSelection } from "@/lib/prestations/prestations";
import { repererFamille } from "@/lib/prestations/reperage";
import { analysesConnues, catalogue, type Reference } from "./catalogue";
import { photosAvantDuDossier, preparerSimulation, type PreparationVue } from "./preparation";
import { correspondRecherche, sansAccents } from "./recherche-teintes";
import { resumerTeinte } from "./teintes";
import { TYPES_SURFACE, TYPES_SURFACE_ESPACE, typeSurface, typeSurfacePourProjet, ZONES, type IdZone, type TypeSurface } from "./types-surface";

/**
 * « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot bois »
 * (mission 10) : l'assistant nomme les zones et les teintes en mots ; ici on les
 * retrouve — la zone par son identifiant ou son libellé, la teinte par sa
 * référence ou par les mots du catalogue (plusieurs teintes possibles →
 * candidats, jamais un choix) —, on prend la dernière photo du client à défaut,
 * et on appelle la préparation existante en mode ChatGPT : prompt verrouillé,
 * planche des teintes étiquetées, photo cadrée. Rien n'est généré, rien n'est publié.
 */

export type TeinteCandidate = { ref: string; nom: string; famille: string; resume: string };
export type ZoneDemandee = { zone: string; teinte: string };

/** « îlot », « colonnes », « meubles bas », « plan » → la zone du type de surface. */
export function repererZone(texte: string, type: TypeSurface): IdZone | null {
  const n = sansAccents(texte).replace(/[^a-z0-9]+/g, " ").trim();
  const exact = type.zones.find((z) => z === n || sansAccents(ZONES[z].libelle) === n);
  if (exact) return exact;
  const ALIAS: Record<string, IdZone[]> = {
    ilot: ["meubles-bas"],
    "ilot central": ["meubles-bas"],
    colonnes: ["meubles-bas"],
    colonne: ["meubles-bas"],
    bas: ["meubles-bas"],
    "meubles bas": ["meubles-bas"],
    "facades basses": ["meubles-bas"],
    hauts: ["meubles-hauts"],
    "meubles hauts": ["meubles-hauts"],
    "facades hautes": ["meubles-hauts"],
    facades: ["meubles-hauts", "meubles-bas"],
    portes: ["meubles-hauts", "meubles-bas"],
    plan: ["plan-de-travail", "plan-vasque"],
    "plan de travail": ["plan-de-travail"],
    credence: ["credence", "carrelage-mural"],
    vasque: ["meuble-vasque"],
    "meuble vasque": ["meuble-vasque"],
    "plan vasque": ["plan-vasque"],
    dressing: ["portes-dressing"],
    placards: ["portes-dressing"],
    tv: ["meuble-tv"],
    comptoir: ["comptoir-habillage"],
    plateau: ["comptoir-plateau"],
    bar: ["comptoir-habillage"],
    mur: ["mur-principal", "habillage-mural"],
    murs: ["carrelage-mural", "mur-principal"],
    plafond: ["plafond"],
  };
  const parAlias = (ALIAS[n] ?? []).find((z) => type.zones.includes(z));
  if (parAlias) return parAlias;
  const parPrefixe = type.zones.filter((z) => sansAccents(ZONES[z].libelle).startsWith(n) || z.startsWith(n));
  return parPrefixe.length === 1 ? parPrefixe[0] : null;
}

/** Le type de surface : dit (« cuisine », « plan vasque », « salle de bain »), sinon celui du projet du dossier. */
export function repererTypeSurface(texte: string | null | undefined, typeProjet: string | null, zonesProjet: string[]): TypeSurface {
  if (texte?.trim()) {
    const n = sansAccents(texte).replace(/[^a-z0-9]+/g, " ").trim();
    const direct = typeSurface(texte.trim()) ?? TYPES_SURFACE.find((t) => sansAccents(t.libelle) === n) ?? Object.values(TYPES_SURFACE_ESPACE).find((t) => sansAccents(t.libelle) === n);
    if (direct) return direct;
    const f = repererFamille(texte);
    if (f) return TYPES_SURFACE_ESPACE[f.id] ?? TYPES_SURFACE_ESPACE.CUISINE;
    throw new ErreurMetier(`Type de surface inconnu : « ${texte} ». Possibles : ${TYPES_SURFACE.map((t) => `${t.libelle} (${t.id})`).join(", ")}.`, 400);
  }
  return typeSurface(typeSurfacePourProjet(typeProjet, zonesProjet)) ?? TYPES_SURFACE[0];
}

export type ResolutionTeinte = { trouvee: Reference } | { candidats: TeinteCandidate[] } | { aucune: true };

/** La teinte par sa référence exacte, sinon par les mots du catalogue (« café latte », « chêne clair ») : une seule, ou les candidats. */
export async function resoudreTeinte(texte: string): Promise<ResolutionTeinte> {
  const [references, analyses] = await Promise.all([catalogue(), analysesConnues()]);
  const brut = texte.trim();
  const parRef = references.find((r) => r.id.toLowerCase() === brut.toLowerCase());
  if (parRef) return { trouvee: parRef };
  const resumes = new Map(references.map((r) => [r.id, resumerTeinte(r, analyses[r.id] ?? null)]));
  const candidats = references.filter((r) => correspondRecherche({ ref: r.id, nom: r.nom, resume: resumes.get(r.id) ?? "", famille: r.famille }, brut));
  // Le nom exact l'emporte sur les rapprochements par mots.
  const exacts = candidats.filter((r) => sansAccents(r.nom) === sansAccents(brut));
  const retenus = exacts.length ? exacts : candidats;
  if (retenus.length === 1) return { trouvee: retenus[0] };
  if (retenus.length === 0) return { aucune: true };
  return { candidats: retenus.slice(0, 8).map((r) => ({ ref: r.id, nom: r.nom, famille: r.famille, resume: resumes.get(r.id) ?? "" })) };
}

export type DemandePreparation = { dossierId: string; photoId?: string | null; typeSurface?: string | null; zones: ZoneDemandee[] };
export type PreparationAssistant = { preparation: PreparationVue; photoId: string; type: TypeSurface; teintes: { zone: IdZone; libelle: string; ref: string; nom: string; dit: string }[] };
export type BlocagePreparation = { zone: string; teinte: string; candidats?: TeinteCandidate[]; probleme: string };

/** Résout tout, puis prépare (mode ChatGPT). Une ambiguïté ou une zone inconnue bloque AVANT de préparer : rien n'est écrit. */
export async function preparerDepuisLAssistant(demande: DemandePreparation): Promise<{ ok: true; resultat: PreparationAssistant } | { ok: false; blocages: BlocagePreparation[]; type: TypeSurface }> {
  const dossier = await prisma.dossier.findUnique({ where: { id: demande.dossierId }, select: { id: true, archiveLe: true, prestations: true, lead: { select: { typeProjet: true } }, espaces: { where: { archiveLe: null }, take: 1, select: { souhaits: true } } } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const selection = lireSelection(dossier.prestations);
  const typeProjet = famillesDe(selection)[0] ?? dossier.lead?.typeProjet ?? "CUISINE";
  const projet = lireProjet(dossier.espaces[0]?.souhaits ?? null, selection, dossier.lead?.typeProjet);
  const type = repererTypeSurface(demande.typeSurface, typeProjet, projet?.zones ?? []);

  const photos = await photosAvantDuDossier(demande.dossierId);
  const photoId = demande.photoId ?? photos[0]?.id ?? null;
  if (!photoId) throw new ErreurMetier("Aucune photo « avant » du client dans ce dossier : demande-lui des photos (ou dépose-les) avant de préparer une simulation.", 409);
  if (demande.photoId && !photos.some((p) => p.id === demande.photoId)) throw new ErreurMetier(`La photo « ${demande.photoId} » n'est pas une photo avant de ce dossier (voir « voir_photos »).`, 404);

  const blocages: BlocagePreparation[] = [];
  const teintes: PreparationAssistant["teintes"] = [];
  for (const z of demande.zones) {
    const zone = repererZone(z.zone, type);
    if (!zone) {
      blocages.push({ zone: z.zone, teinte: z.teinte, probleme: `zone inconnue pour ${type.libelle} (possibles : ${type.zones.map((id) => `${ZONES[id].libelle} (${id})`).join(", ")})` });
      continue;
    }
    const r = await resoudreTeinte(z.teinte);
    if ("aucune" in r) blocages.push({ zone: z.zone, teinte: z.teinte, probleme: "aucune teinte du catalogue ne correspond : donne la référence Cover Styl' ou d'autres mots" });
    else if ("candidats" in r) blocages.push({ zone: z.zone, teinte: z.teinte, candidats: r.candidats, probleme: `${r.candidats.length} teintes correspondent : demande à Lucas laquelle` });
    else {
      const deja = teintes.find((t) => t.zone === zone);
      if (deja && deja.ref !== r.trouvee.id) blocages.push({ zone: z.zone, teinte: z.teinte, probleme: `« ${z.zone} » et « ${deja.dit} » sont la même zone du simulateur (${ZONES[zone].libelle}) : une seule teinte par zone — ${deja.nom} ou ${r.trouvee.nom} ? Demande à Lucas.` });
      else if (!deja) teintes.push({ zone, libelle: ZONES[zone].libelle, ref: r.trouvee.id, nom: r.trouvee.nom, dit: z.zone });
    }
  }
  if (blocages.length) return { ok: false, blocages, type };
  if (teintes.length === 0) throw new ErreurMetier("Indique au moins une zone et sa teinte.", 400);
  const preparation = await preparerSimulation({ dossierId: demande.dossierId, photoId, typeSurface: type.id, zones: teintes.map((t) => ({ zone: t.zone, ref: t.ref })), mode: "CHATGPT" }, { origine: "CRM" });
  return { ok: true, resultat: { preparation, photoId, type, teintes } };
}
