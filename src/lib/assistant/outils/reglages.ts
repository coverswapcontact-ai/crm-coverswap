import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { modifierTarifSousPartie, tarifsDesPrestations, type LigneTarifPrestation } from "@/lib/prestations/tarifs";
import { libelleReperee, repererSousPartie } from "@/lib/prestations/reperage";
import { UNITES } from "@/lib/dossiers/constants";
import { appliquerModification, CLES_TEXTE, diffLignes, enregistrerConsignes, enregistrerPositionnement, lireConsignes, lirePositionnement, listerVersions, MODES_MODIFICATION, restaurerVersion, titresDesSections, type CleTexte } from "../consignes";
import { definirOutil, format, lien } from "../definition";

/**
 * Les réglages depuis l'assistant (mission 10) : les consignes et le
 * positionnement (section par section, aperçu du diff, versions restaurables)
 * et les tarifs par sous-partie (aperçu, confirmation, tracé ; les devis émis
 * ne bougent pas : un document émis est figé).
 */

const schemaTexte = z.enum(["consignes", "positionnement"]).describe("Quel texte : les consignes (coverswap://consignes) ou le positionnement (coverswap://positionnement).");

async function lireTexte(cle: CleTexte) {
  return cle === "consignes" ? lireConsignes() : lirePositionnement();
}

function texteDiff(avant: string, apres: string): string {
  const d = diffLignes(avant, apres);
  if (d.ajoutees.length === 0 && d.retirees.length === 0) return "Aucune ligne ne change.";
  return [d.retirees.length ? `Lignes retirées (${d.retirees.length}) :\n${d.retirees.map((l) => `− ${l}`).join("\n")}` : "", d.ajoutees.length ? `Lignes ajoutées (${d.ajoutees.length}) :\n${d.ajoutees.map((l) => `+ ${l}`).join("\n")}` : ""].filter(Boolean).join("\n");
}

export const outilModifierConsignes = definirOutil({
  nom: "modifier_consignes",
  titre: "Modifier les consignes ou le positionnement",
  description:
    "Modifie les consignes (ce que tu lis à chaque session) ou le positionnement, section par section : « remplacer_section » (le corps d'une section « ## … »), « completer_section » (ajouter des lignes à la fin d'une section), « ajouter_section » (une nouvelle section, titre + corps), « remplacer_tout » (le texte entier). Sensible : l'aperçu montre les lignes retirées et ajoutées ; Lucas confirme ; chaque enregistrement crée une version restaurable (« restaurer_consignes », ou Paramètres → Assistant Claude). N'écris que ce que Lucas a dit.",
  niveau: "SENSIBLE",
  schema: z.object({
    texte: schemaTexte,
    mode: z.enum(MODES_MODIFICATION),
    section: z.string().max(120).optional().describe("Titre de la section visée (« Principes de Lucas », « Mail ») ; pour « ajouter_section », le titre de la nouvelle."),
    contenu: z.string().min(1).max(20_000).describe("Le corps (lignes « - … ») ou le texte entier selon le mode."),
  }),
  apercu: async (e) => {
    const courant = await lireTexte(e.texte);
    const apres = appliquerModification(courant.texte, e);
    return `Je vais modifier ${e.texte === "consignes" ? "les consignes" : "le positionnement"} (${e.mode.replace(/_/g, " ")}${e.section ? ` « ${e.section} »` : ""}). ${texteDiff(courant.texte, apres)}\nUne version est gardée : l'ancienne se restaure.`;
  },
  executer: async (e, contexte) => {
    const courant = await lireTexte(e.texte);
    const apres = appliquerModification(courant.texte, e);
    if (apres.trim() === courant.texte.trim()) return { texte: "Rien ne change : le texte est déjà celui-là." };
    const version = e.texte === "consignes" ? await enregistrerConsignes(apres, "ASSISTANT:claude", contexte.commande) : await enregistrerPositionnement(apres, "ASSISTANT:claude", contexte.commande);
    return { texte: `${e.texte === "consignes" ? "Consignes" : "Positionnement"} modifié(es), version ${version.numero} enregistrée. ${texteDiff(courant.texte, apres)}\nJe le lis à ma prochaine session (relis la ressource si besoin). Pour revenir en arrière : « restaurer_consignes » (version ${version.numero - 1}).`, donnees: { version, sections: titresDesSections(apres) }, liens: [lien("Paramètres → Assistant Claude", "/parametres#assistant")] };
  },
});

export const outilVersionsConsignes = definirOutil({
  nom: "versions_consignes",
  titre: "Les versions des consignes ou du positionnement",
  description: "L'historique des versions d'un texte (numéro, date, qui, la phrase de Lucas) et ses sections actuelles. Pour revenir à une version : « restaurer_consignes ».",
  niveau: "LECTURE",
  schema: z.object({ texte: schemaTexte, limite: z.number().int().min(1).max(50).optional() }),
  executer: async (e) => {
    const [courant, versions] = await Promise.all([lireTexte(e.texte), listerVersions(CLES_TEXTE[e.texte], e.limite ?? 15)]);
    const lignes = versions.map((v) => `v${v.numero} — ${format.jourCourt(v.le)} ${new Date(v.le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} — ${v.par ?? "?"}${v.commande ? ` — « ${v.commande} »` : ""} — ${v.caracteres} caractères${v.courante ? " (courante)" : ""}`);
    return { texte: `${e.texte === "consignes" ? "Consignes" : "Positionnement"} : ${courant.source === "LUCAS" ? `texte de Lucas${courant.majLe ? `, modifié le ${format.jourCourt(courant.majLe)}` : ""}` : "texte par défaut"}. Sections : ${titresDesSections(courant.texte).join(" · ") || "aucune"}.\n${versions.length ? `Versions :\n${lignes.join("\n")}` : "Aucune version enregistrée (le texte par défaut, ou un texte d'avant la mission 10)."}`, donnees: { source: courant.source, sections: titresDesSections(courant.texte), versions } };
  },
});

export const outilRestaurerConsignes = definirOutil({
  nom: "restaurer_consignes",
  titre: "Restaurer une version des consignes ou du positionnement",
  description: "Remet un texte à une version passée (numéro rendu par « versions_consignes »). Réversible : la restauration crée elle-même une version, rien n'est perdu.",
  niveau: "REVERSIBLE",
  schema: z.object({ texte: schemaTexte, numero: z.number().int().min(1) }),
  executer: async (e, contexte) => {
    const version = await restaurerVersion(CLES_TEXTE[e.texte], e.numero, "ASSISTANT:claude", contexte.commande);
    return { texte: `${e.texte === "consignes" ? "Consignes" : "Positionnement"} : version ${e.numero} restaurée (enregistrée comme version ${version.numero}).`, donnees: { version }, liens: [lien("Paramètres → Assistant Claude", "/parametres#assistant")] };
  },
});

const ligneTarif = (l: LigneTarifPrestation) => `${l.familleLibelle} › ${l.libelle} (${l.cle}) : ${l.prixUnitaire !== null ? `${format.euros(l.prixUnitaire)} / ${l.unite}` : l.designation ? "prix à saisir au devis" : "aucun tarif"}${l.designation ? ` — tarif « ${l.designation} »${l.explicite ? "" : " (par mots-clés)"}` : ""}`;

async function ligneDe(sousPartie: string): Promise<LigneTarifPrestation> {
  const r = repererSousPartie(sousPartie);
  if ("candidats" in r) throw new ErreurMetier(`« ${sousPartie} » existe dans plusieurs familles : précise laquelle (${r.candidats.map(libelleReperee).join(" ; ")}).`, 400);
  if ("aucune" in r) throw new ErreurMetier(`« ${sousPartie} » n'est pas une sous-partie connue. Possibles : ${r.proposees.map((p) => `${p.famille.libelle} › ${p.sousPartie.libelle}`).join(", ")}.`, 400);
  const lignes = await tarifsDesPrestations();
  const ligne = lignes.find((l) => l.cle === r.trouvee.cle);
  if (!ligne) throw new ErreurMetier("Sous-partie sans ligne de tarif.", 500);
  return ligne;
}

export const outilTarifs = definirOutil({
  nom: "tarifs",
  titre: "Les tarifs par sous-partie",
  description: "Le tarif de chaque sous-partie du fichier des prestations (prix unitaire, unité, tarif attribué ou trouvé par mots-clés, ou aucun) : ce que le devis prérempli utilise. Une sous-partie en paramètre pour n'en lire qu'une.",
  niveau: "LECTURE",
  schema: z.object({ sous_partie: z.string().max(60).optional() }),
  executer: async (e) => {
    if (e.sous_partie) {
      const l = await ligneDe(e.sous_partie);
      return { texte: ligneTarif(l), donnees: l, liens: [lien("Dossiers → Tarifs", "/dossiers")] };
    }
    const lignes = await tarifsDesPrestations();
    return { texte: lignes.map(ligneTarif).join("\n"), donnees: lignes, liens: [lien("Dossiers → Tarifs", "/dossiers")] };
  },
});

export const outilModifierTarifs = definirOutil({
  nom: "modifier_tarifs",
  titre: "Modifier le tarif d'une sous-partie",
  description:
    "Change le prix unitaire (et au besoin l'unité : ml, jour, forfait ; la désignation) du tarif d'une sous-partie (« ilot », « SDB.plan-vasque »). Si la sous-partie n'a pas de tarif attribué, un tarif est créé et lui est attribué. Sensible : aperçu (ancien prix, nouveau, autres sous-parties qui partagent ce tarif), puis confirmation. Les devis déjà émis ne changent jamais.",
  niveau: "SENSIBLE",
  schema: z.object({
    sous_partie: z.string().min(1).max(60),
    prix_unitaire: z.number().min(0).max(1_000_000),
    unite: z.enum(UNITES).optional(),
    designation: z.string().trim().min(1).max(200).optional().describe("Nouvelle désignation du tarif (rare : quand on crée un tarif)."),
  }),
  apercu: async (e) => {
    const l = await ligneDe(e.sous_partie);
    const partagees = l.presetId ? (await tarifsDesPrestations()).filter((x) => x.presetId === l.presetId && x.cle !== l.cle) : [];
    const cible = l.presetId ? `le tarif « ${l.designation} »${l.explicite ? "" : " (trouvé par mots-clés, il sera attribué à cette sous-partie)"}` : `un nouveau tarif « ${e.designation ?? `Revêtement adhésif — ${l.libelle.toLowerCase()}`} » attribué à cette sous-partie`;
    return `Je vais modifier ${cible} pour ${l.familleLibelle} › ${l.libelle} : ${l.prixUnitaire !== null ? `${format.euros(l.prixUnitaire)} / ${l.unite}` : "prix à saisir"} → ${format.euros(e.prix_unitaire)} / ${e.unite ?? l.unite ?? "ml"}.${partagees.length ? ` Ce tarif sert aussi à : ${partagees.map((p) => `${p.familleLibelle} › ${p.libelle}`).join(", ")} — leur prix changera aussi.` : ""} Les devis déjà émis ne changent pas.`;
  },
  executer: async (e) => {
    const r = await modifierTarifSousPartie(e.sous_partie, { prixUnitaire: e.prix_unitaire, unite: e.unite, designation: e.designation });
    return { texte: `Tarif ${r.cree ? "créé et attribué" : "modifié"} pour ${r.apres.familleLibelle} › ${r.apres.libelle} : ${r.avant.prixUnitaire !== null ? `${format.euros(r.avant.prixUnitaire)} / ${r.avant.unite}` : "prix à saisir"} → ${format.euros(r.apres.prixUnitaire ?? 0)} / ${r.apres.unite} (tarif « ${r.apres.designation} »).${r.partagees.length ? ` Aussi appliqué à : ${r.partagees.join(", ")}.` : ""} Les devis déjà émis ne changent pas ; les prochains devis préremplis utilisent ce prix.`, donnees: r, liens: [lien("Dossiers → Tarifs", "/dossiers")] };
  },
});

export const OUTILS_REGLAGES_LECTURE = [outilVersionsConsignes, outilTarifs];
export const OUTILS_REGLAGES_ECRITURE = [outilModifierConsignes, outilRestaurerConsignes, outilModifierTarifs];
