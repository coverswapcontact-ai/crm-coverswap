import { z } from "zod/v4";
import { definirOutil, lien } from "../definition";

/**
 * « lister_outils » (mission 11) : la liste des outils que CE serveur expose,
 * lue dans le registre dérivé du catalogue. Quand l'application Claude dit
 * « tool not registered » pour un outil de cette liste, c'est sa liste à elle
 * qui est périmée (elle date de l'ajout du connecteur) : reconnecter le
 * connecteur la rafraîchit. Le catalogue est importé à l'appel, pas au
 * chargement : cet outil fait lui-même partie du catalogue.
 */

const FAMILLES = ["LECTURE", "ANALYSE", "MAIL", "ECRITURE"] as const;

export const outilListerOutils = definirOutil({
  nom: "lister_outils",
  titre: "La liste des outils du CRM",
  description:
    "Tous les outils que ce serveur expose : nom, niveau (lecture, écriture réversible, sensible), paramètres, et l'empreinte du registre (la même que /api/health). À utiliser quand un outil semble manquer : s'il figure ici mais que l'application Claude le dit « not registered », la liste de l'application est périmée — dis à Lucas de reconnecter le connecteur (Paramètres → Connecteurs → CRM CoverSwap → reconnecter), puis réessaie. « famille » pour n'en lire qu'une partie.",
  niveau: "LECTURE",
  schema: z.object({ famille: z.enum(FAMILLES).optional().describe("LECTURE, ANALYSE, MAIL ou ECRITURE ; à défaut tout.") }),
  executer: async (e) => {
    const { registreOutils } = await import("../couverture");
    const registre = registreOutils();
    const outils = e.famille ? registre.outils.filter((o) => o.famille === e.famille) : registre.outils;
    const parFamille = FAMILLES.map((f) => ({ famille: f, outils: outils.filter((o) => o.famille === f) })).filter((g) => g.outils.length);
    const texte = [
      `${registre.nombre} outil(s) exposés par ce serveur (empreinte ${registre.empreinte})${e.famille ? ` ; ${outils.length} dans la famille ${e.famille}` : ""}. Un outil de cette liste que l'application dit « not registered » : reconnecter le connecteur.`,
      ...parFamille.map((g) => `${g.famille} (${g.outils.length}) : ${g.outils.map((o) => `${o.nom} [${o.libelleNiveau.toLowerCase()}]${o.parametres.length ? ` (${o.parametres.join(", ")})` : ""}`).join(" ; ")}`),
    ].join("\n");
    return { texte, donnees: { nombre: registre.nombre, empreinte: registre.empreinte, outils }, liens: [lien("Paramètres → Assistant Claude", "/parametres")] };
  },
});

export const OUTILS_CATALOGUE = [outilListerOutils];
