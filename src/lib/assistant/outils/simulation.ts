import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { preparerDepuisLAssistant } from "@/lib/simulateur/preparation-assistant";
import { definirOutil, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";

/**
 * « Prépare une simu » (mission 10) : le paquet ChatGPT — prompt verrouillé,
 * planche des teintes étiquetées, photo avant cadrée — pour une photo et des
 * teintes, et le lien vers la page du CRM prête à copier. Aucune génération
 * par l'API (payante), rien de publié : réversible, sans confirmation.
 */

export const outilPreparerSimulation = definirOutil({
  nom: "preparer_simulation",
  titre: "Préparer une simulation pour ChatGPT (sans générer)",
  description:
    "Prépare le paquet ChatGPT d'une simulation : la photo avant du client (la plus récente à défaut de « photo_id », voir « voir_photos »), le type de surface (déduit du projet à défaut), une teinte par zone dite en mots (« îlot » : « chêne clair », « colonnes » : « café latte ») ou par référence Cover Styl'. Si plusieurs teintes du catalogue correspondent, l'outil rend les candidats : demande à Lucas laquelle, ne choisis pas. Rend le lien de la page du CRM (prompt à copier, planche, photo) : Lucas la colle dans ChatGPT, dépose le rendu ensuite. Rien n'est généré par l'API, rien n'est publié au client.",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({
    photo_id: z.string().max(80).optional().describe("Identifiant d'une photo avant (rendu par « voir_photos »)."),
    type_surface: z.string().max(40).optional().describe("cuisine, meubles-hauts, meubles-bas, plan-de-travail, credence, plan-vasque, dressing, meuble-tv, bar, mobilier-pro ; à défaut, déduit du projet."),
    teintes: z.array(z.object({ zone: z.string().min(1).max(40).describe("« îlot », « colonnes », « meubles hauts », « plan de travail », « crédence »…"), teinte: z.string().min(1).max(80).describe("Mots du catalogue (« chêne clair », « marbre blanc », « café latte ») ou référence Cover Styl'.") })).min(1).max(4),
  }),
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier : ouvre-le d'abord (« ouvrir_dossier »).`, 409);
    const resultat = await preparerDepuisLAssistant({ dossierId: r.ids.dossierId, photoId: e.photo_id ?? null, typeSurface: e.type_surface ?? null, zones: e.teintes });
    if (!resultat.ok) {
      const lignes = resultat.blocages.map((b) => `- ${b.zone} / « ${b.teinte} » : ${b.probleme}${b.candidats ? ` — ${b.candidats.map((c) => `${c.nom} (${c.ref}, ${c.resume})`).join(" ; ")}` : ""}`);
      return { texte: `Rien n'a été préparé pour ${r.ids.nom} (type ${resultat.type.libelle}) : il manque une précision.\n${lignes.join("\n")}`, donnees: { blocages: resultat.blocages, type: resultat.type.id } };
    }
    const p = resultat.resultat;
    const chemin = `/simulateur?dossier=${r.ids.dossierId}&preparation=${p.preparation.id}`;
    return {
      texte: `Paquet ChatGPT prêt pour ${r.ids.nom} (${p.type.libelle}) : ${p.teintes.map((t) => `${t.libelle} → ${t.nom} (${t.ref})`).join(", ")} ; photo ${p.photoId} ; prompt version ${p.preparation.promptVersion ?? "?"}${p.preparation.format ? `, format ${p.preparation.format}` : ""}. Rien n'est généré ni publié : Lucas ouvre la page, copie le prompt, joint la planche et la photo dans ChatGPT, puis dépose le rendu.`,
      donnees: { preparationId: p.preparation.id, dossierId: r.ids.dossierId, type: p.type.id, photoId: p.photoId, teintes: p.teintes, zones: p.preparation.zones, planche: p.preparation.planche, photo: p.preparation.photo },
      liens: [lien("Page prête à copier", chemin), lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)],
    };
  },
});

export const OUTILS_SIMULATION = [outilPreparerSimulation];
