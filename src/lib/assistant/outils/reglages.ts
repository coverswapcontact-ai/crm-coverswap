import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { tarifsDesPrestations, type LigneTarifPrestation } from "@/lib/prestations/tarifs";
import { libelleReperee, repererSousPartie } from "@/lib/prestations/reperage";
import { CLES_TEXTE, lireConsignes, lirePositionnement, listerVersions, titresDesSections, type CleTexte } from "../consignes";
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

export const outilVersionsConsignes = definirOutil({
  nom: "versions_consignes",
  titre: "Les versions des consignes ou du positionnement",
  description: "L'historique des versions d'un texte (numéro, date, qui, la phrase de Lucas) et ses sections actuelles. Pour revenir à une version : « restaurer » CONSIGNES ou POSITIONNEMENT (numero).",
  niveau: "LECTURE",
  schema: z.object({ texte: schemaTexte, limite: z.number().int().min(1).max(50).optional() }),
  executer: async (e) => {
    const [courant, versions] = await Promise.all([lireTexte(e.texte), listerVersions(CLES_TEXTE[e.texte], e.limite ?? 15)]);
    const lignes = versions.map((v) => `v${v.numero} — ${format.jourCourt(v.le)} ${new Date(v.le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} — ${v.par ?? "?"}${v.commande ? ` — « ${v.commande} »` : ""} — ${v.caracteres} caractères${v.courante ? " (courante)" : ""}`);
    return { texte: `${e.texte === "consignes" ? "Consignes" : "Positionnement"} : ${courant.source === "LUCAS" ? `texte de Lucas${courant.majLe ? `, modifié le ${format.jourCourt(courant.majLe)}` : ""}` : "texte par défaut"}. Sections : ${titresDesSections(courant.texte).join(" · ") || "aucune"}.\n${versions.length ? `Versions :\n${lignes.join("\n")}` : "Aucune version enregistrée (le texte par défaut, ou un texte d'avant la mission 10)."}`, donnees: { source: courant.source, sections: titresDesSections(courant.texte), versions } };
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


