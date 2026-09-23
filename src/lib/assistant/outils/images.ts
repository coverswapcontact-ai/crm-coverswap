import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { imageSimulationDossier, listerSimulationsDossier } from "@/lib/simulations/dossier";
import { definirOutil, format, lien, type ImageOutil } from "../definition";
import { IMAGES_MAX_PAR_RESULTAT, imagePourResultat, ko } from "../images";
import { octetsDeLaPhoto, photosDuContact } from "../photos";
import { cibler } from "./cible";

/**
 * Voir (mission 10) : les photos d'un dossier ou d'un lead, et les simulations
 * avant / après, rendues à Claude comme de vraies images (blocs MCP), pas
 * seulement des liens — compressées (assistant/images.ts). Six photos par
 * défaut, les plus récentes ; « decalage » pour les suivantes.
 */

const LIBELLES_SOURCE: Record<string, string> = { SITE: "faite par le client sur le site", API: "générée par l'API depuis le CRM", CHATGPT: "préparée pour ChatGPT depuis le CRM", MANUEL: "déposée dans le CRM", CLIENT: "créée par le client dans son espace" };
const LIBELLES_STATUT: Record<string, string> = { BROUILLON: "brouillon (le client ne la voit pas)", PUBLIEE: "publiée (visible par le client)", MASQUEE: "masquée" };

export const outilVoirPhotos = definirOutil({
  nom: "voir_photos",
  titre: "Voir les photos d'un dossier ou d'un lead",
  description:
    "Rend les photos d'un contact comme de vraies images (pas seulement des liens), avec pour chacune sa date, son origine (déposée par le client dans son espace, jointe à sa demande sur le site, photo avant ou rendu du simulateur du site, déposée dans le CRM) et la zone quand elle est connue. Les 6 plus récentes par défaut ; « nombre » (12 au plus) et « decalage » pour les suivantes ; « apres » pour les photos après chantier. À regarder AVANT de conseiller une teinte ou de préparer une simulation.",
  niveau: "LECTURE",
  schema: z.object({
    dossierId: z.string().max(40).optional(),
    clientId: z.string().max(40).optional(),
    leadId: z.string().max(40).optional(),
    nom: z.string().max(120).optional(),
    nombre: z.number().int().min(1).max(IMAGES_MAX_PAR_RESULTAT).optional(),
    decalage: z.number().int().min(0).max(200).optional().describe("Sauter les N plus récentes (déjà vues)."),
    apres: z.boolean().optional().describe("Vrai : les photos après chantier aussi (portfolio)."),
    photo_id: z.string().max(80).optional().describe("Une seule photo, par son identifiant."),
  }),
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const toutes = await photosDuContact({ dossierId: r.ids.dossierId, leadId: r.ids.leadId });
    const eligibles = e.photo_id ? toutes.filter((p) => p.id === e.photo_id) : toutes.filter((p) => e.apres || !p.apres);
    if (e.photo_id && eligibles.length === 0) throw new ErreurMetier(`Aucune photo « ${e.photo_id} » chez ${r.ids.nom}.`, 404);
    const decalage = e.decalage ?? 0;
    const choisies = eligibles.slice(decalage, decalage + (e.nombre ?? 6));
    if (toutes.length === 0) return { texte: `${r.ids.nom} n'a aucune photo${r.ids.dossierId ? " dans son dossier" : ""}${r.ids.leadId ? " ni sur sa demande" : ""}.`, donnees: { total: 0 } };
    if (choisies.length === 0) return { texte: `${r.ids.nom} a ${eligibles.length} photo(s) ; rien au-delà du décalage ${decalage}.`, donnees: { total: eligibles.length } };
    const images: ImageOutil[] = [];
    const lignes: string[] = [];
    const illisibles: string[] = [];
    for (const [i, p] of choisies.entries()) {
      const numero = decalage + i + 1;
      const libelle = `Photo ${numero}${p.le ? ` du ${format.jourCourt(p.le)}` : " (date non renseignée)"} — ${p.libelleOrigine}${p.apres ? " — après chantier" : ""}${p.zone ? ` — zone : ${p.zone}` : " — zone non renseignée"} [photo:${p.id}]`;
      const image = await imagePourResultat(await octetsDeLaPhoto(p), libelle);
      if (image) {
        images.push(image);
        lignes.push(`${libelle} (${ko(image.octets)})`);
      } else illisibles.push(libelle);
    }
    const texte = [
      `${r.ids.nom} : ${eligibles.length} photo(s)${e.apres ? "" : " avant chantier"}${toutes.length !== eligibles.length ? ` (${toutes.length} en tout)` : ""} ; ${images.length} jointe(s) ci-dessous${eligibles.length > decalage + choisies.length ? `, ${eligibles.length - decalage - choisies.length} de plus avec decalage=${decalage + choisies.length}` : ""}.`,
      ...lignes,
      illisibles.length ? `Illisibles ici (format HEIC d'iPhone sans doute) : ${illisibles.join(" ; ")}` : "",
    ].filter(Boolean).join("\n");
    return { texte, images, donnees: { total: eligibles.length, decalage, photos: choisies.map((p) => ({ id: p.id, le: p.le, origine: p.origine, apres: p.apres, zone: p.zone, source: p.source })) }, liens: r.ids.dossierId ? [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] : r.ids.leadId ? [lien("Lead", `/leads?lead=${r.ids.leadId}`)] : [] };
  },
});

export const outilVoirSimulations = definirOutil({
  nom: "voir_simulations",
  titre: "Voir les simulations d'un dossier (avant / après)",
  description:
    "Rend les simulations d'un dossier comme de vraies images : l'après, et l'avant quand il existe ; pour chacune les teintes posées par zone, la source (site, client, CRM), le statut (brouillon, publiée, masquée), si le client l'a vue, choisie ou commentée. Les 4 plus récentes par défaut (8 au plus) ; « simulation_id » pour une seule.",
  niveau: "LECTURE",
  schema: z.object({
    dossierId: z.string().max(40).optional(),
    clientId: z.string().max(40).optional(),
    leadId: z.string().max(40).optional(),
    nom: z.string().max(120).optional(),
    nombre: z.number().int().min(1).max(8).optional(),
    simulation_id: z.string().max(40).optional(),
    sans_avant: z.boolean().optional().describe("Vrai : ne pas joindre les photos avant (moitié moins d'images)."),
  }),
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier : les simulations vivent dans le dossier.`, 409);
    const { simulations, espace } = await listerSimulationsDossier(r.ids.dossierId);
    const liste = e.simulation_id ? simulations.filter((s) => s.id === e.simulation_id) : simulations;
    if (e.simulation_id && liste.length === 0) throw new ErreurMetier(`Aucune simulation « ${e.simulation_id} » dans le dossier de ${r.ids.nom}.`, 404);
    if (liste.length === 0) return { texte: `Aucune simulation dans le dossier de ${r.ids.nom}.`, donnees: { total: 0 }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
    const choisies = liste.slice(0, e.nombre ?? 4);
    const images: ImageOutil[] = [];
    const lignes: string[] = [];
    for (const [i, s] of choisies.entries()) {
      const teintes = s.zones.length ? s.zones.map((z) => `${z.libelle} : ${z.nom} (${z.ref})`).join(", ") : "teintes non renseignées";
      const etat = [LIBELLES_STATUT[s.statut] ?? s.statut, s.vueLe ? `vue par le client le ${format.jourCourt(s.vueLe)}` : s.statut === "PUBLIEE" ? "pas encore vue par le client" : null, s.choisie ? "CHOISIE par le client" : null, s.commentaire ? `commentaire : « ${s.commentaire} »` : null].filter(Boolean).join(" ; ");
      const titre = `Simulation ${i + 1}${s.titre ? ` « ${s.titre} »` : ""} du ${format.jourCourt(s.le)} — ${LIBELLES_SOURCE[s.source] ?? s.source} — ${s.typeLibelle ?? "surface non renseignée"} — ${teintes} — ${etat} [simulation:${s.id}]`;
      lignes.push(titre);
      if (images.length >= IMAGES_MAX_PAR_RESULTAT) continue;
      const apres = await imagePourResultat((await imageSimulationDossier(r.ids.dossierId, s.id, "image").catch(() => null))?.contenu ?? null, `${titre} — APRÈS`);
      if (apres) images.push(apres);
      if (s.avant && !e.sans_avant && images.length < IMAGES_MAX_PAR_RESULTAT) {
        const avant = await imagePourResultat((await imageSimulationDossier(r.ids.dossierId, s.id, "avant").catch(() => null))?.contenu ?? null, `Simulation ${i + 1} — AVANT (photo d'origine)`);
        if (avant) images.push(avant);
      }
    }
    const texte = [`${r.ids.nom} : ${liste.length} simulation(s)${espace ? "" : " (pas d'espace client ouvert)"} ; ${choisies.length} décrite(s), ${images.length} image(s) jointe(s) (après, puis avant quand elle existe).`, ...lignes].join("\n");
    return { texte, images, donnees: { total: liste.length, simulations: choisies.map((s) => ({ id: s.id, titre: s.titre, source: s.source, statut: s.statut, type: s.typeSurface, zones: s.zones, le: s.le, publieeLe: s.publieeLe, vueLe: s.vueLe, choisie: s.choisie, commentaire: s.commentaire, avant: Boolean(s.avant) })) }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`), lien("Simulateur", `/simulateur?dossier=${r.ids.dossierId}`)] };
  },
});

export const OUTILS_IMAGES = [outilVoirPhotos, outilVoirSimulations];
