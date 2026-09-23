import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourParis } from "@/lib/dossiers/dates";
import { annulerModification, calculerChangements, CHAMPS_SENSIBLES, derniereModification, devisImpacte, lireValeurs, listerModifications, modifierDossierAssistant, schemaModificationAssistant, type Changement, type EntreeModificationAssistant } from "@/lib/dossiers/modification-assistant";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";

/**
 * Les actions qui manquaient à l'assistant (mission 10) : modifier un dossier
 * champ par champ, avec la valeur d'avant tracée et annulable. Les autres
 * outils du lot (espace, simulation, consignes, tarifs, lien) vivent dans
 * leurs fichiers ; celui-ci porte le dossier.
 */

const DATES = ["date_souhaitee", "date_chantier", "date_fin_chantier", "prochaine_action_date"] as const;
const dateDictee = z.string().max(60).nullable().optional().describe("AAAA-MM-JJ, ou comme dicté (« 12 octobre », « lundi prochain ») ; null efface.");

/** « 12 octobre » → 2026-10-12 ; une date déjà au format AAAA-MM-JJ passe telle quelle. */
function jourDicte(texte: string | null | undefined, maintenant: Date, champ: string): string | null | undefined {
  if (texte === undefined) return undefined;
  if (texte === null || !texte.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte.trim())) return texte.trim();
  const date = lireDateDictee(texte, maintenant, 12);
  if (!date) throw new ErreurMetier(`Date non comprise pour « ${champ} » : « ${texte} ». Donne-la au format AAAA-MM-JJ.`, 400);
  return jourParis(date);
}

const schemaOutilModifier = schemaCible.extend(schemaModificationAssistant.shape).extend({ date_souhaitee: dateDictee, date_chantier: dateDictee, date_fin_chantier: dateDictee, prochaine_action_date: dateDictee });
type EntreeOutilModifier = z.output<typeof schemaOutilModifier>;

function entreeLib(e: EntreeOutilModifier, maintenant: Date): EntreeModificationAssistant {
  const { dossierId: _d, clientId: _c, leadId: _l, nom: _n, ...reste } = e;
  void _d;
  void _c;
  void _l;
  void _n;
  const entree = { ...reste } as EntreeModificationAssistant;
  for (const champ of DATES) (entree as Record<string, unknown>)[champ] = jourDicte(e[champ], maintenant, champ);
  return entree;
}

const ligneChangement = (c: Changement) => `${c.libelle} : ${c.texteAvant} → ${c.texteApres}`;

export const outilModifierDossier = definirOutil({
  nom: "modifier_dossier",
  titre: "Modifier un dossier (champ par champ, annulable)",
  description:
    "Modifie un dossier d'après la phrase de Lucas : objet, budget annoncé (montant_estime), dates (date_souhaitee, date_chantier = la pose, date_fin_chantier), adresse du chantier, e-mail, téléphone, prochaine action et sa date, familles et sous-parties (familles = toute la sélection ; ajouter_sous_parties / retirer_sous_parties = un ajustement, ex. « ilot », « SDB.plan-vasque »), teintes par sous-partie (teintes = { \"CUISINE.ilot\": \"chêne\" }), dimensions par famille ({ CUISINE: { valeur: 5 } }), mot du projet (notes_projet). Seuls les champs donnés changent. Chaque changement est tracé avec sa valeur d'avant ; « annuler_modification » le défait. Sensible (aperçu puis confirmation) dès que ça touche un montant, une date de chantier ou l'adresse. Un devis émis que la modification rend faux est signalé, jamais modifié. Ne déduis rien : cite ce que Lucas a dit dans « commande ».",
  niveau: "REVERSIBLE",
  schema: schemaOutilModifier,
  sensible: (e) => CHAMPS_SENSIBLES.some((c) => e[c] !== undefined),
  apercu: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.dossierId) return `${r.ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (« ouvrir_dossier »).`;
    const lecture = await lireValeurs(r.ids.dossierId);
    const changements = calculerChangements(entreeLib(e, contexte.maintenant), lecture);
    if (changements.length === 0) return `Rien à changer sur le dossier de ${r.ids.nom} : les valeurs données sont déjà celles du dossier.`;
    const devis = await devisImpacte(r.ids.dossierId, changements);
    return `Je vais modifier le dossier de ${r.ids.nom} : ${changements.map(ligneChangement).join(" ; ")}.${devis ? ` ${devis.message}` : ""}`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (outil « ouvrir_dossier »).`, 409);
    const resultat = await modifierDossierAssistant(r.ids.dossierId, entreeLib(e, contexte.maintenant), { commande: contexte.commande });
    if (!resultat.modification) return { texte: `Rien à changer sur le dossier de ${r.ids.nom} : les valeurs données sont déjà celles du dossier.`, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
    const texte = [`Dossier de ${r.ids.nom} modifié : ${resultat.changements.map(ligneChangement).join(" ; ")}.`, resultat.devis ? resultat.devis.message : "", `Pour défaire : « annuler_modification » avec modification_id = ${resultat.modification.id}.`].filter(Boolean).join("\n");
    return { texte, donnees: { modification: resultat.modification, devis: resultat.devis }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
  },
});

export const outilAnnulerModification = definirOutil({
  nom: "annuler_modification",
  titre: "Annuler une modification de dossier",
  description: "Remet chaque champ d'une modification faite par « modifier_dossier » à sa valeur d'avant, par le même chemin. Sans modification_id : la dernière modification non annulée du dossier visé. La trace reste (marquée annulée).",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ modification_id: z.string().max(40).optional().describe("Rendu par « modifier_dossier » ; à défaut, la dernière du dossier.") }),
  executer: async (e, contexte) => {
    let modificationId = e.modification_id ?? null;
    let nom: string | null = null;
    if (!modificationId) {
      const r = await cibler(e, "DOSSIER");
      if (r.ambigu) return r.ambigu;
      if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
      nom = r.ids.nom;
      const derniere = await derniereModification(r.ids.dossierId);
      if (!derniere) {
        const passees = await listerModifications(r.ids.dossierId, 3);
        return { texte: passees.length ? `Aucune modification à annuler chez ${r.ids.nom} : les ${passees.length} dernière(s) sont déjà annulées.` : `Aucune modification enregistrée par l'assistant sur le dossier de ${r.ids.nom}.` };
      }
      modificationId = derniere.id;
    }
    const resultat = await annulerModification(modificationId, { commande: contexte.commande });
    const texte = [`Modification annulée chez ${nom ?? resultat.clientNom} : ${resultat.changements.map(ligneChangement).join(" ; ")}.`, resultat.devis ? resultat.devis.message : "", `(modification ${resultat.modification.id}, faite le ${format.jourCourt(resultat.modification.le)}${resultat.modification.commande ? ` sur « ${resultat.modification.commande} »` : ""})`].filter(Boolean).join("\n");
    return { texte, donnees: { modification: resultat.modification, devis: resultat.devis }, liens: [lien("Dossier", `/dossiers?dossier=${resultat.modification.dossierId}`)] };
  },
});

export const OUTILS_ACTIONS = [outilModifierDossier, outilAnnulerModification];
