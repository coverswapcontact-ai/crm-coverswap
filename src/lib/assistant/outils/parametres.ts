import { z } from "zod/v4";
import { listerAutomatismes } from "@/lib/automatismes/interrupteurs";
import { lireCompteurs } from "@/lib/dossiers/compteurs";
import { formaterValeurParametre, GROUPES_PARAMETRES, type GroupeParametre } from "@/lib/parametres/definitions";
import { parametresPourEcran } from "@/lib/parametres/service";
import { consommation } from "@/lib/simulateur/consommation";
import { GROUPES_SMS, LIBELLES_GROUPE_SMS } from "@/lib/sms/catalogue";
import { listerCatalogue, type ModeleCatalogue } from "@/lib/sms/modeles";
import { definirOutil, format, lien } from "../definition";
import { pluriel } from "@/lib/commun/format";

/**
 * Les réglages (mission 11) : « voir_parametres » rend tout ce qui se règle
 * dans Paramètres — campagne (début, budget, durée), capacité (réserve de
 * trésorerie, chantiers par mois), délais, RGPD, solde OpenAI relevé et
 * estimé — et les interrupteurs des automatismes (mails de l'espace, SMS
 * d'accusé, IA du CRM ; mission 18, A4 : plus de séquences de mails). « modifier_parametres » change UNE valeur
 * ou UN interrupteur, sous confirmation, avec la date d'effet et la source ;
 * l'historique reste. Mission 14 (partie 8) : le catalogue SMS (Paramètres →
 * SMS) se lit en bloc (« groupe: SMS ») et se réécrit texte par texte
 * (sms_code + sms_texte, mêmes règles que l'écran). Aucun secret ici : les
 * clés et jetons sont des variables d'environnement, jamais lues ni rendues.
 */

const GROUPES = Object.keys(GROUPES_PARAMETRES) as GroupeParametre[];
/** Le « groupe » du catalogue SMS dans « voir_parametres » : un bloc à part, pas un groupe de paramètres. */
const GROUPE_SMS = "SMS";
const GROUPES_VUE = [...GROUPES, GROUPE_SMS] as string[] as [string, ...string[]];

/** Le bloc « Catalogue SMS » : par groupe, `CODE — libellé : « texte »` (le texte en vigueur, modifié par Lucas ou de départ). */
function blocCatalogueSms(modeles: ModeleCatalogue[]): string {
  const groupes = GROUPES_SMS.filter((g) => modeles.some((m) => m.groupe === g)).map(
    (g) => `${LIBELLES_GROUPE_SMS[g]} :\n${modeles.filter((m) => m.groupe === g).map((m) => `- ${m.code} — ${m.libelle}${m.automatique && !m.actif ? " (coupé)" : ""} : « ${m.texte} »`).join("\n")}`
  );
  return `Catalogue SMS (Paramètres → SMS ; un texte se change par « modifier » MODELE_SMS (code, texte) ; variables entre accolades, le lien de l'espace toujours en fin de message ; rien ne part seul sauf les deux accusés) :\n${groupes.join("\n")}`;
}

export const outilVoirParametres = definirOutil({
  nom: "voir_parametres",
  titre: "Les paramètres, les automatismes et le catalogue SMS",
  description:
    "Rend les paramètres du CRM par groupe (campagne : début, budget, durée ; pilotage : réserve de trésorerie, chantiers par mois ; commercial : délais de relance (devis, photos, avis), zone ; RGPD ; facturation ; simulateur : solde OpenAI relevé et estimé) avec la valeur en vigueur et depuis quand, le catalogue SMS (chaque code avec son libellé et son texte en vigueur), la numérotation (prochain numéro de devis et de facture), et les interrupteurs des automatismes (mails automatiques de l'espace client, SMS d'accusé de réception, IA appelée par le CRM, rangement Gmail) avec leur état. Jamais de secret (clés, jetons). « groupe » pour n'en lire qu'un (« SMS » : le seul catalogue SMS) ; « automatismes: true » pour les seuls interrupteurs.",
  niveau: "LECTURE",
  schema: z.object({
    groupe: z.enum(GROUPES_VUE).optional().describe("Un groupe de paramètres, ou « SMS » pour le seul catalogue SMS."),
    automatismes: z.boolean().optional().describe("Vrai : seulement les interrupteurs des automatismes."),
  }),
  executer: async (e, contexte) => {
    const automatismes = await listerAutomatismes();
    const ligneAuto = (a: (typeof automatismes)[number]) => `${a.code} — ${a.libelle} : ${a.actif ? "ACTIF" : "inactif"}`;
    if (e.automatismes) return { texte: `Automatismes (${pluriel(automatismes.filter((a) => a.actif).length, "actif")} sur ${automatismes.length}) :\n${automatismes.map(ligneAuto).join("\n")}`, donnees: { automatismes }, liens: [lien("Paramètres", "/parametres")] };
    // Mission 14 (partie 8) : le catalogue SMS, en bloc avec tout, ou seul avec « groupe: SMS ».
    const sms = !e.groupe || e.groupe === GROUPE_SMS ? await listerCatalogue() : null;
    if (e.groupe === GROUPE_SMS) return { texte: blocCatalogueSms(sms!), donnees: { sms }, liens: [lien("Paramètres → SMS", "/parametres")] };
    const tous = await parametresPourEcran(contexte.maintenant);
    const parametres = e.groupe ? tous.filter((p) => p.groupe === e.groupe) : tous;
    const credit = await consommation(contexte.maintenant).catch(() => null);
    const compteurs = await lireCompteurs(contexte.maintenant);
    const parGroupe = GROUPES.filter((g) => parametres.some((p) => p.groupe === g)).map((g) => ({
      groupe: g,
      libelle: GROUPES_PARAMETRES[g],
      parametres: parametres.filter((p) => p.groupe === g).map((p) => `${p.cle} — ${p.libelle} : ${p.courante ? `${formaterValeurParametre(p.cle, p.courante.valeur)} (depuis le ${format.jourCourt(new Date(p.courante.valableDu))}${p.courante.source ? `, source : ${p.courante.source}` : ""})` : "non renseigné"}`),
    }));
    const solde = credit?.solde ? `Solde OpenAI : relevé ${credit.solde.releve.toFixed(2)} $ le ${format.jourCourt(new Date(credit.solde.releveLe))}, ${credit.solde.consommeDepuis.toFixed(2)} $ consommés depuis, estimé ${credit.solde.estime.toFixed(2)} $ (≈ ${credit.solde.simulationsRestantes} simulations)${credit.creditEpuise ? ` — crédit épuisé depuis le ${format.jourCourt(new Date(credit.creditEpuise.le))}` : ""}.` : "Solde OpenAI : aucun relevé (paramètre SIMULATEUR_CREDIT_OPENAI).";
    const texte = [
      ...parGroupe.map((g) => `${g.libelle} :\n${g.parametres.map((l) => `- ${l}`).join("\n")}`),
      ...(!e.groupe || e.groupe === "SIMULATEUR" ? [solde] : []),
      ...(sms ? [blocCatalogueSms(sms)] : []),
      ...(!e.groupe ? [`Numérotation (Paramètres → Numérotation des documents) : ${compteurs.map((c) => `${c.libelle} ${c.annee} : prochain ${c.prochain}${c.valeur !== null ? ` (dernier attribué ${c.valeur})` : ""}, plus haut inscrit ${c.plusHautRegistre}`).join(" ; ")}. Un devis externe inscrit avec un numéro plus grand fait avancer le compteur ; « modifier » COMPTEUR (id DEVIS ou FACTURE, champs { prochain: « 2026-043 » }) le fait repartir.`] : []),
      ...(!e.groupe ? [`Automatismes (${pluriel(automatismes.filter((a) => a.actif).length, "actif")} sur ${automatismes.length}) :\n${automatismes.map((a) => `- ${ligneAuto(a)}`).join("\n")}`] : []),
      "Aucun secret n'est lu ni rendu : les clés et jetons sont des variables d'environnement.",
    ].join("\n\n");
    return { texte, donnees: { parametres: parametres.map((p) => ({ cle: p.cle, libelle: p.libelle, groupe: p.groupe, nature: p.nature, options: p.options, courante: p.courante, historique: p.historique.slice(0, 5) })), compteurs, solde: credit?.solde ?? null, creditEpuise: credit?.creditEpuise ?? null, automatismes: e.groupe ? undefined : automatismes, sms: sms ?? undefined }, liens: [lien("Paramètres", "/parametres")] };
  },
});



