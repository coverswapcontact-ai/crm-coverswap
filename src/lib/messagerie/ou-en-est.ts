/**
 * Mission 25 — « Où on en est » par les règles (cahier, § « Où on en est ») : trois lignes, 240 caractères au plus,
 * uniquement des faits du dossier, des notes et des messages du client, dates toujours absolues, jamais vide. C'est
 * la version sans IA ; l'IA peut réécrire les deux premières lignes (contrôlées), jamais la troisième. Pur.
 */
import { definitionMessage, estCodeMessage, type CodeMessage } from "./catalogue";
import { dateAbsolue, jourCourt, jourEnLettres, momentParis } from "./horaires";
import type { Plan } from "./planificateur";
import { LONGUEUR_MAX_OU_EN_EST, type EtatSuivi, type MessageConnu, type OuEnEst } from "./types";
import { LIBELLES_ZONE } from "./zone";

const MOTIFS: Record<string, string> = {
  PRIX: "trop cher",
  CONCURRENT: "a choisi un concurrent",
  SANS_REPONSE: "plus de réponse",
  PROJET_ABANDONNE: "projet abandonné",
  HORS_ZONE: "hors zone",
  DELAI: "reporté",
  AUTRE: "autre motif",
};

const euros = (montant: number) => `${Math.round(montant).toLocaleString("fr-FR").replace(/\s/g, " ")} €`;
const extrait = (texte: string, n: number) => {
  const t = texte.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const libelleCode = (code: string) => (estCodeMessage(code) ? `${code} (${definitionMessage(code as CodeMessage).libelle.toLowerCase()})` : code === "REPONSE" ? "la réponse proposée" : "ton message");

/** 📍 Situation : où en est le dossier, depuis quand, ce que le client a fait. */
export function ligneSituation(etat: EtatSuivi, maintenant: Date): string {
  const dossier = etat.dossier;
  let phrase: string;
  if (!dossier) {
    const lead = etat.lead;
    if (!lead) phrase = "Contact sans dossier.";
    else if (lead.statut === "PERDU") phrase = `Sans suite depuis le ${jourCourt(lead.perteLe ?? lead.creeLe)}${lead.motifPerte ? ` (${MOTIFS[lead.motifPerte] ?? "autre motif"})` : ""}.`;
    else {
      const source = lead.source === "META_ADS" ? " (Meta)" : lead.source.startsWith("SITE") ? " (site)" : "";
      const sansReponse = etat.tentativesSansReponse;
      if (!lead.dernierAppelLe && !etat.envois.length) phrase = `Lead du ${jourCourt(lead.creeLe)}${source}, pas encore appelé.`;
      else if (lead.rappelLe && lead.rappelLe.getTime() > maintenant.getTime()) phrase = `Lead du ${jourCourt(lead.creeLe)}${source}, à rappeler ${dateAbsolue(lead.rappelLe)}.`;
      else if (sansReponse > 0) phrase = `Lead du ${jourCourt(lead.creeLe)}${source}, ${sansReponse} appel${sansReponse > 1 ? "s" : ""} sans réponse${lead.dernierAppelLe ? ` (dernier le ${jourCourt(lead.dernierAppelLe)})` : ""}.`;
      else if (lead.dernierAppelLe) phrase = `Lead du ${jourCourt(lead.creeLe)}${source}, joint le ${jourCourt(lead.dernierAppelLe)}.`;
      else phrase = `Lead du ${jourCourt(lead.creeLe)}${source}, message envoyé, pas encore appelé.`;
    }
  } else {
    const devis = [...etat.devis].sort((a, b) => b.enLigneLe.getTime() - a.enLigneLe.getTime())[0];
    const sims = etat.simulations.filter((s) => s.source !== "SITE").sort((a, b) => b.publieeLe.getTime() - a.publieeLe.getTime());
    const vue = sims.find((s) => s.vueLe)?.vueLe ?? null;
    switch (dossier.etape) {
      case "PERDU":
        phrase = `Perdu le ${jourCourt(dossier.perteLe ?? maintenant)}${dossier.motifPerte ? ` (${MOTIFS[dossier.motifPerte] ?? "autre motif"})` : ""}.`;
        break;
      case "EN_PAUSE":
        phrase = "Dossier en pause.";
        break;
      case "SIGNE":
        phrase = etat.acompte
          ? `Acompte reçu le ${jourCourt(etat.acompte.le)}, ${dossier.dateChantier ? `chantier le ${jourEnLettres(momentParis(dossier.dateChantier).jour)}` : "date du chantier à fixer"}.`
          : `Accord donné${etat.accord ? ` le ${jourCourt(etat.accord.le)}` : ""}, acompte attendu.`;
        break;
      case "PLANIFIE":
        phrase = dossier.dateChantier ? `Chantier prévu le ${jourEnLettres(momentParis(dossier.dateChantier).jour)}.` : "Chantier à planifier.";
        break;
      case "CHANTIER":
        phrase = `Chantier en cours${dossier.dateChantier ? ` depuis le ${jourCourt(dossier.dateChantier)}` : ""}.`;
        break;
      case "FACTURE":
        phrase = `Chantier terminé${etat.chantierFiniLe ? ` le ${jourCourt(etat.chantierFiniLe)}` : ""}, facture à encaisser.`;
        break;
      case "ENCAISSE":
        phrase = `Chantier terminé${etat.chantierFiniLe ? ` le ${jourCourt(etat.chantierFiniLe)}` : ""} et payé${etat.avisLe ? ", avis donné" : ""}.`;
        break;
      case "DEVIS_ENVOYE":
      case "RELANCE":
        phrase = devis
          ? `Devis ${euros(devis.totalHt)} HT en ligne le ${jourCourt(devis.enLigneLe)}, ${devis.consultations ? `ouvert ${devis.consultations} fois` : "pas encore ouvert"}, sans réponse.`
          : "Devis envoyé, sans réponse.";
        break;
      default: {
        if (sims.length) phrase = `Simulation publiée le ${jourCourt(sims[0].publieeLe)}, ${vue ? `vue le ${jourCourt(vue)}` : "pas encore vue"}${etat.dernierGesteClientLe && vue && etat.dernierGesteClientLe > vue ? ", retour reçu" : ", sans retour"}.`;
        else if (etat.simulationFaiteSurLeSite) phrase = `Dossier du ${jourCourt(dossier.ouvertLe)}, simulation faite sur le site.`;
        else if (etat.photos.nombre) phrase = `Photos reçues le ${jourCourt(etat.photos.derniereLe ?? maintenant)}, simulation à préparer.`;
        else if (etat.espace?.lienCommunique) phrase = `Dossier du ${jourCourt(dossier.ouvertLe)}, lien de l'espace envoyé, pas encore de photos.`;
        else if (!etat.appels.length && !etat.envois.length) phrase = `Dossier du ${jourCourt(dossier.ouvertLe)}, pas encore appelé.`;
        else phrase = `Dossier du ${jourCourt(dossier.ouvertLe)}, pas encore de photos.`;
      }
    }
  }
  const dernier = [...etat.messagesClient].sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  if (dernier && maintenant.getTime() - dernier.le.getTime() < 7 * 86_400_000) phrase += ` A écrit le ${jourCourt(dernier.le)} : « ${extrait(dernier.texte, 40)} ».`;
  return phrase;
}

/** 👤 Client : ce qu'il veut, ce qui le freine, qui décide (faits seulement). */
export function ligneClient(etat: EtatSuivi): string {
  const f = etat.faits;
  const parties: string[] = [];
  const teintes = f.teintesFavorites.length ? f.teintesFavorites : f.teintesEvoquees;
  if (teintes.length) parties.push(`veut du ${teintes.slice(0, 2).join(" ou du ")}`);
  if (f.budget === "SENSIBLE") parties.push("trouve ça cher");
  for (const objection of f.objections.slice(0, 1)) if (!/cher|prix|budget/i.test(objection)) parties.push(objection.charAt(0).toLowerCase() + objection.slice(1));
  if (f.decideur) parties.push(`décide avec ${f.decideur}`);
  if (f.delai) parties.push(`délai : ${f.delai}`);
  if (f.canalPrefere === "SMS_DABORD") parties.push("préfère les SMS");
  if (!parties.length) {
    const lieu = etat.ville && !/non renseign/i.test(etat.ville) ? `, à ${etat.ville}` : "";
    const zone = etat.zone !== "INCONNUE" ? ` (${LIBELLES_ZONE[etat.zone]})` : "";
    return `Projet : ${etat.piece.connue ? etat.piece.nom : "à préciser"}${lieu}${zone}.`;
  }
  const phrase = parties.join(", ");
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/** ➡️ Suite : la prochaine action, qui l'a en main, quand (dates absolues). */
export function ligneSuite(etat: EtatSuivi, plan: Pick<Plan, "aVenir" | "proposition" | "aAppeler">, maintenant: Date): { texte: string; le: Date | null; qui: "TOI" | "CLIENT" | null } {
  const ouverts = etat.messages.filter((m) => ["A_ENVOYER", "A_VALIDER", "PREVU"].includes(m.statut)).sort((a, b) => a.prevuLe.getTime() - b.prevuLe.getTime());
  const aEnvoyer = ouverts.find((m) => m.statut === "A_ENVOYER");
  const aValider = ouverts.find((m) => m.statut === "A_VALIDER");
  const prevu = ouverts.find((m) => m.statut === "PREVU");
  if (etat.stop) return { texte: "Plus aucun SMS (STOP).", le: null, qui: null };
  if (plan.proposition) return { texte: `Toi : décider, ${plan.proposition.genre === "PERDU" ? "passer en Perdu" : "classer sans suite"} ?`, le: null, qui: "TOI" };
  if (aEnvoyer) return { texte: `Toi : envoyer ${libelleCode(aEnvoyer.code)}${aEnvoyer.nonConfirmeLe ? ", pas confirmé hier" : ""}.`, le: aEnvoyer.prevuLe, qui: "TOI" };
  if (etat.attendReponse) {
    const dernier = [...etat.messagesClient].sort((a, b) => b.le.getTime() - a.le.getTime())[0];
    return { texte: `Toi : répondre à son message${dernier ? ` du ${jourCourt(dernier.le)}` : ""}.`, le: dernier?.le ?? null, qui: "TOI" };
  }
  if (aValider) return { texte: `Toi : valider ${libelleCode(aValider.code)}.`, le: aValider.prevuLe, qui: "TOI" };
  if (plan.aAppeler) return { texte: `Toi : l'appeler (${plan.aAppeler}).`, le: null, qui: "TOI" };
  if (etat.rappel && etat.rappel.le.getTime() > maintenant.getTime()) {
    return { texte: `Toi : rappeler ${dateAbsolue(etat.rappel.le, { heure: hasHeure(etat.rappel.le) })}${etat.rappel.motif ? ` (${etat.rappel.motif})` : ""}.`, le: etat.rappel.le, qui: "TOI" };
  }
  if (prevu) return { texte: `Toi : ${libelleCode(prevu.code)} ${dateAbsolue(prevu.prevuLe)}${modeValidation(prevu) ? ", à valider" : ""}.`, le: prevu.prevuLe, qui: "TOI" };
  if (plan.aVenir) return { texte: `Client : on attend ; ${libelleCode(plan.aVenir.code)} ${dateAbsolue(plan.aVenir.voulu, { heure: false })}.`, le: plan.aVenir.voulu, qui: "CLIENT" };
  const d = etat.dossier;
  if (d?.prochaineAction) return { texte: `${d.main === "CLIENT" ? "Client" : "Toi"} : ${d.prochaineAction.charAt(0).toLowerCase()}${d.prochaineAction.slice(1)}${d.prochaineActionDate ? ` (${dateAbsolue(d.prochaineActionDate, { heure: false })})` : ""}.`, le: d.prochaineActionDate, qui: d.main === "CLIENT" ? "CLIENT" : "TOI" };
  if (!d && etat.lead && etat.lead.statut !== "PERDU" && !etat.lead.dernierAppelLe) return { texte: "Toi : l'appeler.", le: null, qui: "TOI" };
  return { texte: "Rien de prévu.", le: null, qui: null };
}

/** Une date posée au jour seul est rangée à midi UTC (`dateDepuisJour`) : elle n'a pas d'heure à dire. */
export function hasHeure(date: Date): boolean {
  return !(date.getUTCHours() === 12 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0);
}
const modeValidation = (m: MessageConnu) => estCodeMessage(m.code) && definitionMessage(m.code as CodeMessage).mode === "VALIDATION";

/** Raccourcit les lignes pour tenir dans 240 caractères (la suite d'abord gardée entière, puis la situation). */
export function tenirEn240(lignes: { situation: string; client: string; suite: string }): { situation: string; client: string; suite: string } {
  let { situation, client } = lignes;
  const suite = lignes.suite.length > 100 ? `${lignes.suite.slice(0, 99)}…` : lignes.suite;
  const total = () => situation.length + client.length + suite.length;
  if (total() > LONGUEUR_MAX_OU_EN_EST) client = client.length > 60 ? `${client.slice(0, 59).trimEnd()}…` : client;
  if (total() > LONGUEUR_MAX_OU_EN_EST) situation = `${situation.slice(0, Math.max(40, LONGUEUR_MAX_OU_EN_EST - client.length - suite.length - 1)).trimEnd()}…`;
  return { situation, client, suite };
}

export function ouEnEstParRegles(etat: EtatSuivi, plan: Pick<Plan, "aVenir" | "proposition" | "aAppeler">, maintenant: Date): { ouEnEst: OuEnEst; prochaineAction: { texte: string; le: Date | null } } {
  const suite = ligneSuite(etat, plan, maintenant);
  const lignes = tenirEn240({ situation: ligneSituation(etat, maintenant), client: ligneClient(etat), suite: suite.texte });
  return {
    ouEnEst: { ...lignes, le: maintenant.toISOString(), par: "REGLES" },
    prochaineAction: { texte: suite.texte.replace(/^(Toi|Client) : /, ""), le: suite.le },
  };
}
