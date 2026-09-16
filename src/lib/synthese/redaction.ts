// Version rédigée d'une synthèse et guide de lecture : texte déterministe
// (mêmes données, même texte), sans modèle de langue. Aucune dépendance serveur.

import { formatMontant } from "@/lib/dossiers/montants";
import type { Alerte, References, Synthese } from "./types";

const pct = (valeur: number | null) => (valeur === null ? "—" : `${String(valeur).replace(".", ",")} %`);
/** Écart signé : « +12 % », « −8 % ». */
const ecart = (valeur: number | null) => (valeur === null ? "—" : `${valeur > 0 ? "+" : valeur < 0 ? "−" : ""}${String(Math.abs(valeur)).replace(".", ",")} %`);

/** Qui a formulé les propositions, en clair. */
export function libelleAuteur(auteur: string): string {
  const [type, nom = ""] = auteur.split(":");
  if (type === "AGENT") return nom === "mail" ? "Agent mail" : `Agent ${nom}`;
  if (type === "MIGRATION") return "Reprise des données existantes";
  if (type === "SYSTEME") {
    const libelles: Record<string, string> = { doublons: "Recherche de doublons", relances: "Relances de devis", clients: "Rattachement des clients" };
    return libelles[nom] ?? `Système (${nom})`;
  }
  return auteur;
}
const jours = (valeur: number | null) => (valeur === null ? "—" : `${String(valeur).replace(".", ",")} j`);
const pluriel = (nombre: number, singulier: string, plurielForme = `${singulier}s`) => `${nombre} ${nombre > 1 ? plurielForme : singulier}`;
const nomClient = (references: References, id: string | null) => (id ? (references.clients[id] ?? "Client inconnu") : "Sans client");

export function redigerSynthese(synthese: Synthese, references: References, alertes: Alerte[] = []): string {
  const { commercial: c, finances: f, clients: k, agent, qualite } = synthese;
  const lignes: string[] = [];
  const titre = (texte: string) => lignes.push("", texte.toUpperCase(), "");

  lignes.push(`Synthèse ${synthese.periode.libelle}`);
  lignes.push(`Calculée le ${new Date(synthese.calculeLe).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.`);

  if (alertes.length > 0) {
    titre("À surveiller");
    for (const alerte of alertes) lignes.push(`- ${alerte.titre} : ${alerte.detail}`);
  }

  titre("Commercial");
  lignes.push(
    `${pluriel(c.cohorte.ouverts, "dossier ouvert", "dossiers ouverts")} dans la période${
      c.cohorte.parSource.length ? ` (${c.cohorte.parSource.map((ligne) => `${ligne.libelle.toLowerCase()} : ${ligne.ouverts}`).join(", ")})` : ""
    }. À ce jour, ${c.cohorte.devisEnvoyes} ont reçu un devis, ${c.cohorte.signes} sont signés, ${c.cohorte.encaisses} encaissés, ${c.cohorte.perdus} perdus et ${c.cohorte.enCours} encore en cours. Taux de signature des devis : ${pct(c.cohorte.tauxSignatureDevis)}.`
  );
  lignes.push(
    `Dans la période : ${pluriel(c.activite.devisEmis, "devis émis", "devis émis")} (${formatMontant(c.activite.montantDevis)}), ${pluriel(c.activite.signatures, "signature")} (${formatMontant(c.activite.montantSigne)}), ${pluriel(c.activite.facturesEmises, "facture émise", "factures émises")} (${formatMontant(c.activite.montantFacture)})${
      c.activite.avoirs ? `, ${pluriel(c.activite.avoirs, "avoir")} (${formatMontant(c.activite.montantAvoirs)})` : ""
    }, ${pluriel(c.activite.pertes, "perte")}.`
  );
  const delaisConnus = c.delais.filter((delai) => delai.nombre > 0);
  if (delaisConnus.length) lignes.push(`Délais médians : ${delaisConnus.map((delai) => `${delai.libelle.toLowerCase()} ${jours(delai.medianeJours)} (${delai.nombre})`).join(" ; ")}.`);
  if (c.ecartPrixMoyenPct !== null) {
    lignes.push(`Entre le premier devis et le devis signé, le prix a varié de ${ecart(c.ecartPrixMoyenPct)} en moyenne.`);
  }
  if (c.activite.pertes > 0) {
    lignes.push(
      `Pertes : ${c.pertes.parMotif.map((motif) => `${motif.libelle.toLowerCase()} ${motif.valeur}`).join(", ")} ; perdues surtout à l'étape ${c.pertes.parEtape[0]?.libelle.toLowerCase() ?? "inconnue"} ; ${formatMontant(c.pertes.montantPropose)} proposés.${
        c.pertes.concurrents.length
          ? ` Remportées par : ${c.pertes.concurrents.map((concurrent) => `${concurrent.nom} (${concurrent.nombre}${concurrent.ecartMoyenPct !== null ? `, prix ${ecart(concurrent.ecartMoyenPct)} par rapport au nôtre` : ""})`).join(", ")}.`
          : ""
      }`
    );
  }

  titre("Finances");
  if (f.encaisse === null) {
    lignes.push("Encaissements non calculés : un paramètre manque (règle de date des chèques).");
  } else {
    lignes.push(`Encaissé : ${formatMontant(f.encaisse)}. Dépenses : ${formatMontant(f.depenses)}. Marge brute : ${f.margeBrute === null ? "—" : formatMontant(f.margeBrute)}.`);
    if (f.parFamilleSource.length) lignes.push(`Par origine des clients : ${f.parFamilleSource.map((ligne) => `${ligne.libelle.toLowerCase()} ${formatMontant(ligne.valeur)}`).join(", ")}.`);
    if (f.parCategorieClient.length) lignes.push(`Par type de client : ${f.parCategorieClient.map((ligne) => `${ligne.libelle.toLowerCase()} ${formatMontant(ligne.valeur)}`).join(", ")}.`);
  }
  if (f.depensesParCategorie.length) lignes.push(`Dépenses par catégorie : ${f.depensesParCategorie.map((ligne) => `${ligne.libelle.toLowerCase()} ${formatMontant(ligne.valeur)}`).join(", ")}.`);
  lignes.push(
    `Panier moyen : ${f.panierMoyenSigne === null ? "—" : formatMontant(f.panierMoyenSigne)} signé, ${f.panierMoyenFacture === null ? "—" : formatMontant(f.panierMoyenFacture)} facturé. Reste à encaisser : ${formatMontant(f.encours.total)} sur ${pluriel(f.encours.factures, "facture")}, dont ${formatMontant(f.encours.plus30Jours)} en retard de plus de 30 jours.`
  );
  const faibles = f.margesDossiers.filter((marge) => marge.margePct !== null).slice(0, 3);
  if (faibles.length) {
    lignes.push(`Marges les plus faibles : ${faibles.map((marge) => `${nomClient(references, marge.clientId)} ${pct(marge.margePct)} (${formatMontant(marge.marge)})`).join(", ")}.`);
  }

  titre("Clients");
  lignes.push(
    `${pluriel(k.nouveaux, "nouveau client", "nouveaux clients")}${k.parFamilleSource.length ? ` : ${k.parFamilleSource.map((ligne) => `${ligne.libelle.toLowerCase()} ${ligne.valeur}`).join(", ")}` : ""}. ${pluriel(k.recommandations, "recommandation")} dans la période.`
  );
  const r = k.relationnelContrePayant;
  lignes.push(
    `Relations contre publicité payante : ${r.nouveauxRelationnel} contre ${r.nouveauxPayant} nouveaux clients${
      r.caRelationnel !== null && r.caPayant !== null ? ` ; ${formatMontant(r.caRelationnel)} contre ${formatMontant(r.caPayant)} encaissés` : ""
    }.`
  );
  if (k.recommandeurs.length) lignes.push(`Recommandé par : ${k.recommandeurs.map((ligne) => `${nomClient(references, ligne.clientId)} (${ligne.nombre})`).join(", ")}.`);
  lignes.push(
    `Clients revenus (plusieurs dossiers) parmi ceux qui ont payé : ${k.recurrents.clients}${k.recurrents.partCa !== null ? `, ${pct(k.recurrents.partCa)} de l'encaissé` : ""}. Anciens clients sans nouvelle depuis plus d'un an : ${k.inactifs.nombre}.`
  );

  titre("Agent et propositions");
  if (agent.parAuteur.length === 0) {
    lignes.push("Aucune proposition dans la période.");
  } else {
    for (const auteur of agent.parAuteur) {
      lignes.push(
        `${libelleAuteur(auteur.auteur)} : ${auteur.proposees} proposées, ${auteur.validees} validées (dont ${auteur.modifiees} corrigées avant validation), ${auteur.rejetees} rejetées, ${auteur.expirees} expirées, ${auteur.enAttente} en attente. Acceptation ${pct(auteur.tauxAcceptation)} ; décision en ${auteur.delaiDecisionMedianHeures === null ? "—" : `${String(auteur.delaiDecisionMedianHeures).replace(".", ",")} h`} (médiane).`
      );
    }
    if (agent.motifsRejet.length) lignes.push(`Motifs de rejet : ${agent.motifsRejet.map((motif) => `${motif.libelle} ${motif.valeur}`).join(", ")}.`);
  }
  if (agent.mails && agent.mails.recus > 0) {
    const m = agent.mails;
    lignes.push(
      `Mails reçus : ${m.recus} ; rangés seuls chez un client : ${m.rangesSeuls} (dont ${m.rangementsCorriges} rangés ailleurs ensuite) ; publicités archivées seules : ${m.bruitArchiveSeul} (${m.bruitAnnule} remises dans la boîte) ; encore à trier : ${m.restantATrier}. Lectures par l'IA : ${m.lecturesIa}, pour ${String(m.coutIa.toFixed(2)).replace(".", ",")} €.`
    );
  }

  titre("Qualité des données");
  if (qualite.length === 0) lignes.push("Rien à signaler.");
  for (const point of qualite) lignes.push(`- ${point.libelle} : ${point.valeur}`);

  return lignes.join("\n").trim();
}

/** Ce que veut dire chaque indicateur, et ce qu'il ne dit pas. */
export const GUIDE_LECTURE: { titre: string; texte: string }[] = [
  {
    titre: "Cohorte ou activité",
    texte:
      "La cohorte suit les dossiers ouverts dans la période jusqu'à aujourd'hui : ses chiffres bougent tant que ces dossiers avancent. L'activité compte ce qui s'est passé dans la période (devis émis, signatures, factures, pertes), quel que soit l'âge du dossier.",
  },
  {
    titre: "Taux de signature",
    texte: "Dossiers de la cohorte signés, rapportés à ceux qui ont reçu un devis. Sur une période récente, il est sous-estimé : des devis attendent encore leur réponse.",
  },
  {
    titre: "Délais",
    texte: "Médianes (la moitié des dossiers va plus vite, l'autre plus lentement), pour les étapes atteintes dans la période. Le nombre entre parenthèses dit sur combien de dossiers : en dessous de cinq, c'est une indication, pas une tendance.",
  },
  {
    titre: "Encaissé et marge brute",
    texte: "Encaissé : le livre des recettes de la période (contre-passations comprises). Marge brute : encaissé moins dépenses payées dans la période ; elle ne rapproche pas une dépense du chantier qu'elle sert (c'est le rôle des marges par dossier).",
  },
  {
    titre: "Reste à encaisser",
    texte: "Calculé au moment du calcul de la synthèse : pour un instantané figé, c'est la situation au jour du gel, pas à la fin du mois.",
  },
  {
    titre: "Relations contre publicité",
    texte: "Origine renseignée sur la fiche client (recommandation, bouche-à-oreille, sous-traitance contre publicité Meta). Une origine « inconnue » ne compte ni d'un côté ni de l'autre : la qualité des données dit combien il y en a.",
  },
  {
    titre: "Agent et propositions",
    texte: "Acceptation : propositions validées sur validées et rejetées. Une proposition corrigée avant validation compte comme validée, mais le nombre de corrections dit si le brouillon était juste.",
  },
  {
    titre: "Mode anonymisé",
    texte: "Les noms de clients sont remplacés par des pseudonymes stables (« Client 3K7Q ») ; montants, dates et répartitions restent exacts. Les concurrents (entreprises) restent nommés.",
  },
  {
    titre: "Instantanés mensuels",
    texte: "Chaque mois écoulé est figé une fois, sans nom de personne, et ne se recalcule jamais. Un écart entre l'instantané et le recalcul d'aujourd'hui signale une saisie en retard ou une correction : à vérifier avant une déclaration.",
  },
];
