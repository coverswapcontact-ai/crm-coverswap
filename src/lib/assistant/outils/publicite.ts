import { z } from "zod/v4";
import { santeMeta } from "@/lib/meta/sante";
import { definirOutil, format, lien } from "../definition";
import { etatCampagne } from "./lecture";

/**
 * « voir_publicite » (mission 11) : l'état de la chaîne Meta, dit honnêtement.
 * Le voyant ne repose pas sur la vérification de l'abonnement de la page
 * (elle peut échouer alors que les leads entrent) : il dit ce qui s'est
 * réellement passé — des leads reçus, quand, combien — puis ce qui manque.
 */

export const outilVoirPublicite = definirOutil({
  nom: "voir_publicite",
  titre: "L'état de la publicité Meta (réception des leads, campagne)",
  description:
    "Le voyant honnête de la réception des leads Meta : REÇOIT (des leads sont entrés récemment, avec le dernier et les volumes sur 24 h et 7 jours), PRÊT MAIS SILENCIEUX (configuration complète, aucun lead sur 7 jours), ou NE REÇOIT PAS (ce qui manque). Puis : leads en échec (reçus mais pas dans le CRM), notifications (le téléphone sonne-t-il ?), jeton Meta, conversions renvoyées, résultats par campagne et publicité, campagne en cours (jour, budget, dépense estimée) et les alertes. « interroger_meta: true » vérifie aussi l'abonnement de la page et le jeton auprès de Meta (un appel réseau).",
  niveau: "LECTURE",
  schema: z.object({ interroger_meta: z.boolean().optional().describe("Vrai : vérifier l'abonnement de la page et le jeton auprès de Meta (appel réseau)."), jours: z.number().int().min(1).max(90).optional().describe("Fenêtre des résultats (21 par défaut).") }),
  executer: async (e, contexte) => {
    const [sante, campagne] = await Promise.all([santeMeta({ interrogerMeta: e.interroger_meta ?? false, jours: e.jours }), etatCampagne(contexte.maintenant)]);
    const w = sante.webhook;
    const voyant = w.recoit === "OUI" ? `REÇOIT : ${w.surVingtQuatreHeures} lead(s) sur 24 h, ${w.surSeptJours} sur 7 jours, dernier ${w.dernierLeadLe ? `le ${format.jourCourt(new Date(w.dernierLeadLe))}` : "—"}${w.dernierLeadNom ? ` (${w.dernierLeadNom})` : ""}${w.abonnement && !w.abonnement.abonne ? " — la vérification de l'abonnement dit « non abonnée », mais les leads entrent : c'est la vérification qui se trompe, pas le webhook" : ""}.` : w.recoit === "PRET" ? `PRÊT MAIS SILENCIEUX : configuration complète, aucun lead reçu sur 7 jours (dernier ${w.dernierLeadLe ? `le ${format.jourCourt(new Date(w.dernierLeadLe))}` : "jamais"}). ${campagne.enCours ? "La campagne tourne : à surveiller." : "Aucune campagne en cours : normal."}` : `NE REÇOIT PAS : ${w.recoitDetail}`;
    const lignes = [
      `Chaîne Meta — ${sante.chaine.libelle}`,
      `Réception des leads Meta — ${voyant}`,
      `Total reçus depuis le début : ${w.total}. ${sante.echecs.nombre ? `${sante.echecs.nombre} lead(s) reçus mais pas dans le CRM (à rejouer depuis Publicité).` : "Aucun lead en échec."}${sante.enAttente ? ` ${sante.enAttente} en cours de traitement.` : ""}`,
      `Notifications : ${sante.notifications.canaux.length ? sante.notifications.canaux.join(", ") : "aucun canal"}${sante.notifications.push ? " — le téléphone sonne" : " — AUCUNE notification poussée : le téléphone ne sonne pas"}${sante.notifications.leadsSansPush.length ? ` ; ${sante.notifications.leadsSansPush.length} lead(s) récents sans notification poussée` : ""}.`,
      `Jeton Meta : ${sante.jeton.message}`,
      `Conversions renvoyées à Meta : ${sante.conversions.envoyees7j} sur 7 jours${sante.conversions.enEchec ? `, ${sante.conversions.enEchec} en échec` : ""}${sante.conversions.derniereLe ? `, dernière le ${format.jourCourt(new Date(sante.conversions.derniereLe))}` : ""}.`,
      campagne.debut ? `Campagne : commencée le ${format.jourCourt(campagne.debut)}, ${campagne.enCours ? `jour ${campagne.jour} sur ${campagne.duree}` : "pas en cours"}, budget ${campagne.budget !== null ? format.euros(campagne.budget) : "non renseigné"}${campagne.depenseEstimee !== null ? `, dépense estimée ${format.euros(campagne.depenseEstimee)} (prorata)` : ""}, ${campagne.leads} lead(s) Meta${campagne.coutParLead !== null ? `, ≈ ${format.euros(campagne.coutParLead)} par lead` : ""}.` : "Campagne : aucune renseignée (« modifier_parametres » : CAMPAGNE_DEBUT, CAMPAGNE_BUDGET, CAMPAGNE_DUREE_JOURS).",
      sante.resultats.parPublicite?.length ? `Par publicité (${sante.resultats.jours ?? e.jours ?? 21} jours) : ${sante.resultats.parPublicite.map((p) => `${p.nom} ${p.leads} lead(s)${p.devis !== undefined ? `, ${p.devis} devis` : ""}${p.signes !== undefined ? `, ${p.signes} signé(s)` : ""}`).join(" · ")}.` : "",
      sante.alertes.length ? `Alertes :\n${sante.alertes.map((a) => `- ${a}`).join("\n")}` : "Aucune alerte.",
    ].filter(Boolean);
    return { texte: lignes.join("\n"), donnees: { chaine: sante.chaine, voyant: w.recoit, detail: w.recoitDetail, webhook: w, echecs: sante.echecs, notifications: sante.notifications, jeton: sante.jeton, conversions: sante.conversions, resultats: sante.resultats, campagne, alertes: sante.alertes }, liens: [lien("Publicité", "/publicite"), lien("Paramètres", "/parametres")] };
  },
});

export const OUTILS_PUBLICITE = [outilVoirPublicite];
