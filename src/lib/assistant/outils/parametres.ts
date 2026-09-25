import { z } from "zod/v4";
import { listerAutomatismes, reglerAutomatisme } from "@/lib/automatismes/interrupteurs";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourParis } from "@/lib/dossiers/dates";
import { CLES_PARAMETRES, DEFINITIONS_PARAMETRES, formaterValeurParametre, GROUPES_PARAMETRES, type CleParametre, type GroupeParametre } from "@/lib/parametres/definitions";
import { enregistrerParametre, estCleParametre, parametresPourEcran, validerValeur } from "@/lib/parametres/service";
import { consommation } from "@/lib/simulateur/consommation";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien } from "../definition";

/**
 * Les réglages (mission 11) : « voir_parametres » rend tout ce qui se règle
 * dans Paramètres — campagne (début, budget, durée), capacité (réserve de
 * trésorerie, chantiers par mois), délais, RGPD, solde OpenAI relevé et
 * estimé — et les interrupteurs des automatismes (mails de l'espace, SMS
 * d'accusé, séquences, IA du CRM). « modifier_parametres » change UNE valeur
 * ou UN interrupteur, sous confirmation, avec la date d'effet et la source ;
 * l'historique reste. Aucun secret ici : les clés et jetons sont des variables
 * d'environnement, jamais lues ni rendues.
 */

const GROUPES = Object.keys(GROUPES_PARAMETRES) as GroupeParametre[];

export const outilVoirParametres = definirOutil({
  nom: "voir_parametres",
  titre: "Les paramètres et les automatismes",
  description:
    "Rend les paramètres du CRM par groupe (campagne : début, budget, durée ; pilotage : réserve de trésorerie, chantiers par mois ; commercial : délai de relance, zone ; RGPD ; facturation ; simulateur : solde OpenAI relevé et estimé) avec la valeur en vigueur et depuis quand, et les interrupteurs des automatismes (mails automatiques de l'espace client, SMS d'accusé de réception, séquences de mails, IA appelée par le CRM, rangement Gmail) avec leur état. Jamais de secret (clés, jetons). « groupe » pour n'en lire qu'un ; « automatismes: true » pour les seuls interrupteurs.",
  niveau: "LECTURE",
  schema: z.object({
    groupe: z.enum(GROUPES as [GroupeParametre, ...GroupeParametre[]]).optional(),
    automatismes: z.boolean().optional().describe("Vrai : seulement les interrupteurs des automatismes."),
  }),
  executer: async (e, contexte) => {
    const automatismes = await listerAutomatismes();
    const ligneAuto = (a: (typeof automatismes)[number]) => `${a.code} — ${a.libelle} : ${a.actif ? "ACTIF" : "inactif"}`;
    if (e.automatismes) return { texte: `Automatismes (${automatismes.filter((a) => a.actif).length} actif(s) sur ${automatismes.length}) :\n${automatismes.map(ligneAuto).join("\n")}`, donnees: { automatismes }, liens: [lien("Paramètres", "/parametres")] };
    const tous = await parametresPourEcran(contexte.maintenant);
    const parametres = e.groupe ? tous.filter((p) => p.groupe === e.groupe) : tous;
    const credit = await consommation(contexte.maintenant).catch(() => null);
    const parGroupe = GROUPES.filter((g) => parametres.some((p) => p.groupe === g)).map((g) => ({
      groupe: g,
      libelle: GROUPES_PARAMETRES[g],
      parametres: parametres.filter((p) => p.groupe === g).map((p) => `${p.cle} — ${p.libelle} : ${p.courante ? `${formaterValeurParametre(p.cle, p.courante.valeur)} (depuis le ${format.jourCourt(new Date(p.courante.valableDu))}${p.courante.source ? `, source : ${p.courante.source}` : ""})` : "non renseigné"}`),
    }));
    const solde = credit?.solde ? `Solde OpenAI : relevé ${credit.solde.releve.toFixed(2)} $ le ${format.jourCourt(new Date(credit.solde.releveLe))}, ${credit.solde.consommeDepuis.toFixed(2)} $ consommés depuis, estimé ${credit.solde.estime.toFixed(2)} $ (≈ ${credit.solde.simulationsRestantes} simulations)${credit.creditEpuise ? ` — crédit épuisé depuis le ${format.jourCourt(new Date(credit.creditEpuise.le))}` : ""}.` : "Solde OpenAI : aucun relevé (paramètre SIMULATEUR_CREDIT_OPENAI).";
    const texte = [
      ...parGroupe.map((g) => `${g.libelle} :\n${g.parametres.map((l) => `- ${l}`).join("\n")}`),
      ...(!e.groupe || e.groupe === "SIMULATEUR" ? [solde] : []),
      ...(!e.groupe ? [`Automatismes (${automatismes.filter((a) => a.actif).length} actif(s) sur ${automatismes.length}) :\n${automatismes.map((a) => `- ${ligneAuto(a)}`).join("\n")}`] : []),
      "Aucun secret n'est lu ni rendu : les clés et jetons sont des variables d'environnement.",
    ].join("\n\n");
    return { texte, donnees: { parametres: parametres.map((p) => ({ cle: p.cle, libelle: p.libelle, groupe: p.groupe, nature: p.nature, options: p.options, courante: p.courante, historique: p.historique.slice(0, 5) })), solde: credit?.solde ?? null, creditEpuise: credit?.creditEpuise ?? null, automatismes: e.groupe ? undefined : automatismes }, liens: [lien("Paramètres", "/parametres")] };
  },
});

export const outilModifierParametres = definirOutil({
  nom: "modifier_parametres",
  titre: "Modifier un paramètre ou un automatisme",
  description:
    "Change UNE valeur de paramètre (cle + valeur : nombre, montant, date AAAA-MM-JJ pour CAMPAGNE_DEBUT, ou un choix parmi les options) avec sa date d'effet (aujourd'hui par défaut) et sa source (« dit par Lucas le … »), l'ancienne valeur restant dans l'historique ; ou règle UN interrupteur d'automatisme (automatisme + actif : NOTIF_…, SMS_ACCUSE_RECEPTION, SEQUENCE_…, IA_CRM, MAIL_RANGEMENT_GMAIL — codes rendus par « voir_parametres »). Sensible : aperçu (valeur d'avant → d'après) puis confirmation. Jamais un secret.",
  niveau: "SENSIBLE",
  schema: z
    .object({
      cle: z.string().max(60).optional().describe("Clé du paramètre (voir « voir_parametres »)."),
      valeur: z.union([z.number(), z.string().max(300)]).optional(),
      valable_du: z.string().max(60).optional().describe("Date d'effet, AAAA-MM-JJ ou dictée ; aujourd'hui par défaut."),
      source: z.string().max(300).optional().describe("D'où vient la valeur (« relevé OpenAI du 25/09 », « dit par Lucas »)."),
      automatisme: z.string().max(60).optional().describe("Code de l'interrupteur à régler."),
      actif: z.boolean().optional(),
    })
    .refine((e) => (e.cle !== undefined && e.valeur !== undefined) !== (e.automatisme !== undefined && e.actif !== undefined), { message: "Donne soit cle + valeur, soit automatisme + actif." }),
  apercu: async (e, contexte) => {
    if (e.automatisme !== undefined) {
      const a = (await listerAutomatismes()).find((x) => x.code === e.automatisme);
      if (!a) throw new ErreurMetier(`Automatisme inconnu : « ${e.automatisme} » (codes : ${(await listerAutomatismes()).map((x) => x.code).join(", ")}).`, 404);
      return `Je vais ${e.actif ? "activer" : "désactiver"} « ${a.libelle} » (${a.code}) : ${a.actif ? "actif" : "inactif"} → ${e.actif ? "actif" : "inactif"}. ${a.description}`;
    }
    const cle = e.cle!.toUpperCase();
    if (!estCleParametre(cle)) throw new ErreurMetier(`Paramètre inconnu : « ${e.cle} » (clés : ${CLES_PARAMETRES.join(", ")}).`, 404);
    const definition = DEFINITIONS_PARAMETRES[cle as CleParametre];
    const valeur = validerValeur(cle as CleParametre, e.valeur);
    const courante = (await parametresPourEcran(contexte.maintenant)).find((p) => p.cle === cle)?.courante ?? null;
    const du = dateEffet(e.valable_du, contexte.maintenant);
    return `Je vais poser ${definition.libelle} (${cle}) : ${courante ? formaterValeurParametre(cle as CleParametre, courante.valeur) : "non renseigné"} → ${formaterValeurParametre(cle as CleParametre, valeur)}, valable du ${format.jourCourt(du)}${e.source ? `, source « ${e.source} »` : ""}. L'ancienne valeur reste dans l'historique.`;
  },
  executer: async (e, contexte) => {
    if (e.automatisme !== undefined) {
      const r = await reglerAutomatisme(e.automatisme, Boolean(e.actif), `assistant Claude (${contexte.utilisateur})`);
      return { texte: `« ${r.apres.libelle} » : ${r.avant.actif ? "actif" : "inactif"} → ${r.apres.actif ? "actif" : "inactif"}.`, donnees: r, liens: [lien("Paramètres", "/parametres")] };
    }
    const cle = e.cle!.toUpperCase();
    if (!estCleParametre(cle)) throw new ErreurMetier(`Paramètre inconnu : « ${e.cle} ».`, 404);
    const du = dateEffet(e.valable_du, contexte.maintenant);
    await enregistrerParametre({ cle, valeur: e.valeur, valableDu: du, source: e.source ?? `assistant Claude (${contexte.utilisateur})` });
    const apres = (await parametresPourEcran(contexte.maintenant)).find((p) => p.cle === cle);
    return { texte: `${DEFINITIONS_PARAMETRES[cle as CleParametre].libelle} : ${formaterValeurParametre(cle as CleParametre, validerValeur(cle as CleParametre, e.valeur))} à partir du ${format.jourCourt(du)}${apres?.courante && apres.courante.valableDu !== jourParis(du) ? ` (valeur en vigueur aujourd'hui : ${formaterValeurParametre(cle as CleParametre, apres.courante.valeur)})` : ""}. L'historique est gardé.`, donnees: { cle, valeur: e.valeur, valableDu: jourParis(du), parametre: apres }, liens: [lien("Paramètres", "/parametres")] };
  },
});

function dateEffet(texte: string | undefined, maintenant: Date): Date {
  if (!texte?.trim()) return maintenant;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte.trim())) return new Date(`${texte.trim()}T00:00:00.000Z`);
  const date = lireDateDictee(texte, maintenant, 12);
  if (!date) throw new ErreurMetier(`Date non comprise : « ${texte} ». Donne-la au format AAAA-MM-JJ.`, 400);
  return date;
}

export const OUTILS_PARAMETRES_LECTURE = [outilVoirParametres];
export const OUTILS_PARAMETRES_ECRITURE = [outilModifierParametres];
