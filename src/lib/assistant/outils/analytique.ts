import { z } from "zod/v4";
import { ecranAnalytique } from "@/lib/analytique/cache";
import { resoudrePeriode } from "@/lib/analytique/periode";
import { resumeEnregistre } from "@/lib/analytique/resume";
import { FAMILLES, LIBELLES_FAMILLE, LIBELLES_ONGLET, LIBELLES_VERDICT, ONGLETS_ANALYTIQUE, PERIODES_ANALYTIQUE, type EcranAnalytique, type EtatSource, type Indicateur, type ResumeDuJour, type SourceDonnees } from "@/lib/analytique/types";
import { definirOutil, format, lien } from "../definition";
import { pluriel } from "@/lib/commun/format";

/**
 * Mission 17 (partie B) — l'outil `analytique` (lecture) : n'importe quel onglet de l'écran /analytique pour une
 * période, en JSON EXACT (les mêmes données que l'écran, `donnees`) et en texte lisible : le résumé du jour (trois
 * phrases par règles, à reformuler), les indicateurs avec leur évolution, l'essentiel de l'onglet, l'état de chaque
 * source et les alertes.
 */

const NOMS_SOURCE: Record<SourceDonnees, string> = { CRM: "CRM", SITE: "site", META: "Meta", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Search Console", FICHE_GOOGLE: "fiche Google" };
const ETATS: Record<EtatSource["etat"], string> = { A_JOUR: "à jour", EN_ECHEC: "en échec", NON_BRANCHEE: "non branchée", EN_ATTENTE_ACCES: "en attente d'accès" };

const nombre = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
/** « 5,1 % » : un ratio 0..1 en pourcentage, une décimale au plus. */
const pct = (ratio: number) => `${(Math.round(ratio * 1000) / 10).toLocaleString("fr-FR")} %`;
export function valeurLisible(i: Pick<Indicateur, "format" | "valeur">): string {
  if (i.valeur === null) return "—";
  if (i.format === "euros") return format.euros(i.valeur);
  if (i.format === "pourcent") return `${(Math.round(i.valeur * 1000) / 10).toLocaleString("fr-FR")} %`;
  if (i.format === "position") return (Math.round(i.valeur * 10) / 10).toLocaleString("fr-FR");
  return nombre(i.valeur);
}

export function ligneIndicateur(i: Indicateur): string {
  const e = i.evolution;
  const avant = e.precedente === null ? "" : ` (période d'avant${e.horsJourEnCours ? ", jours complets" : ""} : ${valeurLisible({ format: i.format, valeur: e.precedente })}${e.variation !== null ? `, ${e.variation > 0 ? "+" : ""}${Math.round(e.variation * 100)} %` : e.sens === "nouveau" ? ", nouveau" : ""}${e.ton === "favorable" ? ", favorable" : e.ton === "defavorable" ? ", défavorable" : ""})`;
  return `- ${i.libelle} : ${valeurLisible(i)}${i.valeur === null ? " (source non branchée)" : avant}${i.detail ? ` — ${i.detail}` : ""} [${NOMS_SOURCE[i.source]}]`;
}

const ligneSource = (e: EtatSource) => `${NOMS_SOURCE[e.source]} ${ETATS[e.etat]}${e.estimation ? " (chiffres estimés)" : ""}${e.derniereReussite && e.source !== "CRM" ? `, dernière synchronisation réussie le ${format.jourCourt(e.derniereReussite)}` : ""}${e.erreur ? `, erreur : ${e.erreur}` : ""}${e.aFaire ? ` — à faire : ${e.aFaire}` : ""}`;

function lignesOnglet(ecran: EcranAnalytique): string[] {
  switch (ecran.onglet) {
    case "ensemble": {
      const t = ecran.tunnel;
      const p = ecran.publicite;
      return [
        `Tunnel : ${t.etapes.map((e) => `${e.libelle} ${e.valeur === null ? "—" : nombre(e.valeur)}${e.tauxPassage !== null ? ` (${Math.round(e.tauxPassage * 100)} %)` : ""}`).join(" → ")}.${t.perteMax ? ` L'étape qui perd le plus : ${t.perteMax.libelle} (${t.perteMax.perdus} perdus).` : ""}`,
        p ? `Publicité Meta : ${p.jourCampagne !== null && p.dureeCampagne !== null ? `jour ${p.jourCampagne} sur ${p.dureeCampagne}, ` : ""}dépense ${p.depense === null ? "inconnue" : `${format.euros(p.depense)}${p.estimation ? " (estimation)" : ""}`}${p.budget !== null ? ` sur ${format.euros(p.budget)}` : ""}, ${pluriel(p.leads, "lead")}, ${p.coutParLead !== null ? `${format.euros(p.coutParLead)} par lead` : "coût par lead —"}${p.publicites.length ? ` ; ${p.publicites.map((x) => `${x.nom} : ${LIBELLES_VERDICT[x.verdict]} (${x.detail})`).join(" · ")}` : ""}.` : "Publicité : aucune campagne.",
        ecran.seo && ecran.seo.clics !== null ? `SEO : ${nombre(ecran.seo.clics)} clics, ${nombre(ecran.seo.impressions ?? 0)} affichages, position ${ecran.seo.position ?? "—"}${ecran.seo.opportunites.length ? ` ; vu jamais cliqué : ${ecran.seo.opportunites.map((o) => `« ${o.requete} » ${o.impressions} affichages`).join(", ")}` : ""}.` : "",
        ecran.qualite.length ? `Qualité par source : ${ecran.qualite.map((q) => `${q.libelle} ${pluriel(q.leads, "lead")}, ${pluriel(q.joints, "joint")}, ${q.devis} devis${q.tauxDevis !== null ? ` (${pct(q.tauxDevis)})` : ""}${q.horsTunnel ? " (hors tunnel)" : ""}`).join(" · ")}.` : "",
        `Argent : ${format.euros(ecran.argent.encaisse)} encaissés, ${format.euros(ecran.argent.devisEnAttente)} de devis en attente, dépense pub ${ecran.argent.depensePub === null ? "inconnue" : format.euros(ecran.argent.depensePub)}${ecran.argent.ratioPub !== null ? `, pub du mois = ${pct(ecran.argent.ratioPub)} de l'encaissé du mois dernier (plafond ${pct(ecran.argent.plafond)})` : ""}.`,
      ];
    }
    case "publicite": {
      const pubs = ecran.lignes.filter((l) => l.niveau === "PUBLICITE");
      return [
        ecran.campagne ? `Campagne : ${ecran.campagne.jour !== null ? `jour ${ecran.campagne.jour} sur ${ecran.campagne.duree}` : "—"}${ecran.campagne.budget !== null ? `, budget ${format.euros(ecran.campagne.budget)}` : ""}${ecran.campagne.regleDuJour ? ` ; règle du jour : ${ecran.campagne.regleDuJour}` : ""}.` : "Aucune campagne renseignée.",
        pubs.length ? `Par publicité :\n${pubs.slice(0, 15).map((l) => `  - ${l.nom} : ${ecran.estimation ? "dépense inconnue (estimation globale seulement)" : format.euros(l.depense)}, ${pluriel(l.leadsCrm, "lead")} CRM${ecran.estimation ? "" : ` (${l.leadsPlateforme} chez Meta)`}, ${l.devis} devis, ${pluriel(l.signes, "signé")}${l.coutParLead !== null ? `, ${format.euros(l.coutParLead)} par lead` : ""}${l.verdict ? ` — ${LIBELLES_VERDICT[l.verdict]}${l.raisonVerdict ? ` : ${l.raisonVerdict}` : ""}` : ""}`).join("\n")}` : "Aucune publicité sur la période.",
      ];
    }
    case "seo":
      return [
        ecran.requetes.length ? `Requêtes : ${ecran.requetes.slice(0, 8).map((r) => `« ${r.cle} » ${r.clics} clics / ${r.impressions} affichages`).join(" · ")}.` : "",
        ecran.opportunites.sansClic.length ? `Vu, jamais cliqué : ${ecran.opportunites.sansClic.slice(0, 5).map((r) => `« ${r.cle} » ${r.impressions}`).join(", ")}.` : "",
        ecran.opportunites.presquePremierePage.length ? `Proches de la première page (positions 8 à 20) : ${ecran.opportunites.presquePremierePage.slice(0, 5).map((r) => `« ${r.cle} » position ${r.position}`).join(", ")}.` : "",
        ecran.doublonWww?.detecte ? `www et sans www indexés tous les deux (${ecran.doublonWww.exemples.join(", ")}).` : "",
        ecran.fiche ? `Fiche Google : ${ecran.fiche.indicateurs.map((i) => `${i.libelle} ${valeurLisible(i)}`).join(", ")}${ecran.fiche.avis.nombre !== null ? `, ${ecran.fiche.avis.nombre} avis (${ecran.fiche.avis.note ?? "—"} sur 5)` : ""}.` : "",
      ];
    case "site":
      return [
        `Entonnoir : ${ecran.entonnoir.etapes.map((e) => `${e.libelle} ${e.valeur ?? "—"}`).join(" → ")}.`,
        ecran.pagesEntree.length ? `Pages d'entrée : ${ecran.pagesEntree.slice(0, 6).map((p) => `${p.page} ${p.visites}`).join(", ")}.` : "",
        ecran.provenances.length ? `Provenances : ${ecran.provenances.slice(0, 8).map((s) => `${s.nom} (${LIBELLES_FAMILLE[s.famille]}) ${s.visites}`).join(", ")}.` : "",
      ];
    case "argent": {
      const dernier = ecran.regle20.at(-1);
      return [
        dernier ? `Règle des 20 % (${dernier.mois}) : ${format.euros(dernier.depensePub)} de pub pour ${format.euros(dernier.encaissePrecedent)} encaissés le mois d'avant${dernier.ratio !== null ? `, soit ${pct(dernier.ratio)}` : ""}${dernier.depasse ? " — plafond dépassé" : ""}.` : "",
        ecran.carnet.length ? `Carnet de commandes : ${ecran.carnet.length} devis en attente, ${format.euros(ecran.carnet.reduce((t, c) => t + c.montant, 0))} (${ecran.carnet.slice(0, 5).map((c) => `${c.client} ${format.euros(c.montant)}${c.relances ? `, ${c.relances} relance${c.relances > 1 ? "s" : ""}` : ""}`).join(" · ")}).` : "Carnet de commandes vide.",
        ecran.fiscal?.seuils.length ? `Seuils de l'année : ${ecran.fiscal.seuils.map((x) => `${x.libelle} ${format.euros(x.atteint)} sur ${x.plafond !== null ? format.euros(x.plafond) : "—"}${x.projection !== null ? ` (projection au 31/12 : ${format.euros(x.projection)})` : ""}`).join(" · ")}.` : "",
        ecran.fiscal?.urssaf?.aDeclarer ? `URSSAF à déclarer (${ecran.fiscal.urssaf.aDeclarer.libelle}${ecran.fiscal.urssaf.aDeclarer.echeance ? `, avant le ${format.jourCourt(ecran.fiscal.urssaf.aDeclarer.echeance)}` : ""}) : ${ecran.fiscal.urssaf.aDeclarer.montant !== null ? format.euros(ecran.fiscal.urssaf.aDeclarer.montant) : "—"} sur ${format.euros(ecran.fiscal.urssaf.aDeclarer.base)} de chiffre d'affaires (${ecran.fiscal.urssaf.aDeclarer.detail.map((d) => `${d.libelle} ${format.euros(d.montant)}`).join(", ")}).` : "",
        ecran.fiscal?.urssaf?.enCours ? `URSSAF de la période en cours (${ecran.fiscal.urssaf.enCours.libelle}) : ${ecran.fiscal.urssaf.enCours.montant !== null ? format.euros(ecran.fiscal.urssaf.enCours.montant) : "—"} à ce jour.` : "",
        ecran.fiscal?.parametresManquants.length ? `Paramètres à renseigner pour les seuils et l'URSSAF : ${ecran.fiscal.parametresManquants.join(", ")}.` : "",
        ecran.depensesParCategorie.length ? `Dépenses de la période : ${ecran.depensesParCategorie.map((d) => `${d.libelle} ${format.euros(d.montant)}`).join(", ")}.` : "",
      ];
    }
  }
}

/** Le texte lisible d'un écran (pur). */
export function texteAnalytique(ecran: EcranAnalytique, resume: ResumeDuJour | null): string {
  const filtre = ecran.onglet === "ensemble" && ecran.filtreSource ? `, source ${LIBELLES_FAMILLE[ecran.filtreSource]}` : "";
  const etats = ecran.sources;
  return [
    `Analytique — ${LIBELLES_ONGLET[ecran.onglet]}, ${ecran.periode.libelle} (${ecran.periode.du} → ${ecran.periode.au}, comparé à ${ecran.periode.precedente.du} → ${ecran.periode.precedente.au})${filtre}. Calculé le ${format.jour(ecran.genereLe)}.`,
    resume ? `Résumé du jour${ecran.onglet === "ensemble" ? "" : " (vue d'ensemble, toutes sources)"} (rédigé par règles, à reformuler sans changer les chiffres) :\n${resume.phrases.map((p) => `- ${p.amorce} ${p.texte}`).join("\n")}` : "",
    `Indicateurs :\n${ecran.indicateurs.map(ligneIndicateur).join("\n")}`,
    ...lignesOnglet(ecran),
    etats.length ? `Sources : ${etats.map(ligneSource).join(" · ")}.` : "",
    ecran.alertes.length ? `Alertes :\n${ecran.alertes.map((a) => `- ${a.gravite === "ATTENTION" ? "[À traiter] " : ""}${a.texte}`).join("\n")}` : "Aucune alerte.",
  ].filter(Boolean).join("\n");
}

export const lienAnalytique = (onglet: string, p: { cle: string; du: string; au: string }, source?: string | null) => `/analytique?onglet=${onglet}${p.cle === "libre" ? `&du=${p.du}&au=${p.au}` : `&p=${p.cle}`}${source ? `&source=${source}` : ""}`;

export const outilAnalytique = definirOutil({
  nom: "analytique",
  titre: "Analytique : un onglet de l'écran, chiffres exacts et résumé du jour",
  description:
    "N'importe quel onglet de l'écran Analytique pour une période, avec le JSON exact de l'écran (mêmes chiffres, mêmes définitions) : « ensemble » (défaut : visites, simulations lancées, leads, devis envoyés, chantiers signés, coût par lead Meta (coût par chantier signé en détail), tunnel et l'étape qui perd le plus, publicité, SEO, fiche Google, qualité par source, argent), « publicite » (par campagne et publicité : dépense réelle ou estimée, leads Meta et CRM, coûts, verdict du protocole), « seo » (Search Console, opportunités, doublon www, fiche Google), « site » (visites, pages, provenances, appareils, simulations → leads), « argent » (encaissé, signé, marge, 12 mois, règle des 20 %, carnet, seuils fiscaux avec projection au 31/12, URSSAF à déclarer, dépenses par catégorie, clients par source). Période : p = 7j, 30j (défaut), 90j, mois, 12m, ou du/au (AAAA-MM-JJ, heure de Paris) ; chaque indicateur est comparé à la période précédente de même longueur. source = une famille (meta, google-ads, seo, fiche-google, ia, reseaux, direct, autre) pour filtrer la vue d'ensemble. Le texte rend le résumé du jour (trois phrases par règles : reformule-le sans changer un chiffre), les indicateurs avec leur évolution et l'état de chaque source (une source non branchée n'a pas de chiffre, jamais un zéro).",
  niveau: "LECTURE",
  schema: z.object({
    onglet: z.enum(ONGLETS_ANALYTIQUE).optional().describe("ensemble (défaut), publicite, seo, site, argent."),
    p: z.enum(PERIODES_ANALYTIQUE.filter((c) => c !== "libre") as ["7j", "30j", "90j", "mois", "12m"]).optional().describe("7j, 30j (défaut), 90j, mois (mois en cours), 12m."),
    du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Premier jour AAAA-MM-JJ (avec « au » : remplace p)."),
    au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Dernier jour inclus AAAA-MM-JJ."),
    source: z.enum(FAMILLES).optional().describe("Filtre de la vue d'ensemble : une famille de source."),
  }),
  executer: async (entree, contexte) => {
    const onglet = entree.onglet ?? "ensemble";
    const periode = resoudrePeriode({ p: entree.p, du: entree.du, au: entree.au }, contexte.maintenant);
    const ecran = await ecranAnalytique(onglet, periode, { source: entree.source ?? null }, contexte.maintenant);
    const resume = ecran.onglet === "ensemble" ? ecran.resume : await resumeEnregistre(contexte.maintenant).catch(() => null);
    return { texte: texteAnalytique(ecran, resume), donnees: ecran, liens: [lien(`Analytique — ${LIBELLES_ONGLET[onglet]}`, lienAnalytique(onglet, periode, onglet === "ensemble" ? entree.source : null))] };
  },
});

export const OUTILS_ANALYTIQUE = [outilAnalytique];
