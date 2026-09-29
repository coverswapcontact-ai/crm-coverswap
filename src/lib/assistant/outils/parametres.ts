import { z } from "zod/v4";
import { listerAutomatismes, reglerAutomatisme } from "@/lib/automatismes/interrupteurs";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireCompteurs, poserCompteur, type Serie } from "@/lib/dossiers/compteurs";
import { jourParis } from "@/lib/dossiers/dates";
import { CLES_PARAMETRES, DEFINITIONS_PARAMETRES, formaterValeurParametre, GROUPES_PARAMETRES, type CleParametre, type GroupeParametre } from "@/lib/parametres/definitions";
import { enregistrerParametre, estCleParametre, parametresPourEcran, validerValeur } from "@/lib/parametres/service";
import { consommation } from "@/lib/simulateur/consommation";
import { CODES_SMS, GROUPES_SMS, LIBELLES_GROUPE_SMS, verifierTexteSms, type CodeSms } from "@/lib/sms/catalogue";
import { listerCatalogue, modifierModele, poserModelesParDefaut, type ModeleCatalogue } from "@/lib/sms/modeles";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien } from "../definition";
import { pluriel } from "@/lib/commun/format";

/**
 * Les réglages (mission 11) : « voir_parametres » rend tout ce qui se règle
 * dans Paramètres — campagne (début, budget, durée), capacité (réserve de
 * trésorerie, chantiers par mois), délais, RGPD, solde OpenAI relevé et
 * estimé — et les interrupteurs des automatismes (mails de l'espace, SMS
 * d'accusé, séquences, IA du CRM). « modifier_parametres » change UNE valeur
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
  return `Catalogue SMS (Paramètres → SMS ; un texte se change par « modifier_parametres » avec sms_code + sms_texte ; variables entre accolades, le lien de l'espace toujours en fin de message ; rien ne part seul sauf les deux accusés) :\n${groupes.join("\n")}`;
}

export const outilVoirParametres = definirOutil({
  nom: "voir_parametres",
  titre: "Les paramètres, les automatismes et le catalogue SMS",
  description:
    "Rend les paramètres du CRM par groupe (campagne : début, budget, durée ; pilotage : réserve de trésorerie, chantiers par mois ; commercial : délai de relance, zone ; RGPD ; facturation ; simulateur : solde OpenAI relevé et estimé) avec la valeur en vigueur et depuis quand, le catalogue SMS (chaque code avec son libellé et son texte en vigueur), la numérotation (prochain numéro de devis et de facture), et les interrupteurs des automatismes (mails automatiques de l'espace client, SMS d'accusé de réception, séquences de mails, IA appelée par le CRM, rangement Gmail) avec leur état. Jamais de secret (clés, jetons). « groupe » pour n'en lire qu'un (« SMS » : le seul catalogue SMS) ; « automatismes: true » pour les seuls interrupteurs.",
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
      ...(!e.groupe ? [`Numérotation (Paramètres → Numérotation des documents) : ${compteurs.map((c) => `${c.libelle} ${c.annee} : prochain ${c.prochain}${c.valeur !== null ? ` (dernier attribué ${c.valeur})` : ""}, plus haut inscrit ${c.plusHautRegistre}`).join(" ; ")}. Un devis externe inscrit avec un numéro plus grand fait avancer le compteur ; « modifier_parametres » avec cle COMPTEUR_DEVIS ou COMPTEUR_FACTURE et valeur « 2026-043 » le fait repartir.`] : []),
      ...(!e.groupe ? [`Automatismes (${pluriel(automatismes.filter((a) => a.actif).length, "actif")} sur ${automatismes.length}) :\n${automatismes.map((a) => `- ${ligneAuto(a)}`).join("\n")}`] : []),
      "Aucun secret n'est lu ni rendu : les clés et jetons sont des variables d'environnement.",
    ].join("\n\n");
    return { texte, donnees: { parametres: parametres.map((p) => ({ cle: p.cle, libelle: p.libelle, groupe: p.groupe, nature: p.nature, options: p.options, courante: p.courante, historique: p.historique.slice(0, 5) })), compteurs, solde: credit?.solde ?? null, creditEpuise: credit?.creditEpuise ?? null, automatismes: e.groupe ? undefined : automatismes, sms: sms ?? undefined }, liens: [lien("Paramètres", "/parametres")] };
  },
});

/**
 * Le texte SMS à réécrire (mission 14, partie 8) : le texte d'avant (celui de Lucas, sinon celui de départ : `listerCatalogue`
 * le rend même sans ligne en base) et le nouveau, vérifié par la règle unique de l'écran (`verifierTexteSms` : variables du
 * code seulement, le lien à la toute fin) — refusé dès l'aperçu. L'aperçu ne lit que ; la ligne manquante n'est posée
 * (`poser`, sans réécrire un texte existant) qu'à l'exécution confirmée, sous l'acteur de l'assistant.
 */
async function texteSmsAModifier(code: CodeSms, texte: string, poser: boolean): Promise<{ id: string | null; libelle: string; avant: string; apres: string }> {
  const apres = texte.trim();
  const refus = verifierTexteSms(code, apres);
  if (refus) throw new ErreurMetier(`Texte SMS ${code} refusé : ${refus}`, 400);
  let ligne = (await listerCatalogue()).find((m) => m.code === code);
  if (!ligne?.id && poser) {
    await poserModelesParDefaut();
    ligne = (await listerCatalogue()).find((m) => m.code === code);
  }
  if (!ligne) throw new ErreurMetier(`Code SMS inconnu : ${code}.`, 404);
  return { id: ligne.id, libelle: ligne.libelle, avant: ligne.texte, apres };
}

export const outilModifierParametres = definirOutil({
  nom: "modifier_parametres",
  titre: "Modifier un paramètre, un automatisme ou un texte SMS",
  description:
    "Change UNE valeur de paramètre (cle + valeur : nombre, montant, date AAAA-MM-JJ pour CAMPAGNE_DEBUT, ou un choix parmi les options) avec sa date d'effet (aujourd'hui par défaut) et sa source (« dit par Lucas le … »), l'ancienne valeur restant dans l'historique ; ou fait repartir la numérotation (cle COMPTEUR_DEVIS ou COMPTEUR_FACTURE, valeur = le prochain numéro, « 2026-043 » ; jamais derrière un numéro inscrit) ; ou règle UN interrupteur d'automatisme (automatisme + actif : NOTIF_…, SMS_ACCUSE_RECEPTION, SEQUENCE_…, IA_CRM, MAIL_RANGEMENT_GMAIL — codes rendus par « voir_parametres ») ; ou réécrit UN texte du catalogue SMS (sms_code + sms_texte : mêmes variables que le message, le lien de l'espace à la toute fin ; codes et textes rendus par « voir_parametres » avec groupe SMS). Sensible : aperçu (valeur d'avant → d'après) puis confirmation. Jamais un secret.",
  niveau: "SENSIBLE",
  schema: z
    .object({
      cle: z.string().max(60).optional().describe("Clé du paramètre (voir « voir_parametres »)."),
      valeur: z.union([z.number(), z.string().max(300)]).optional(),
      valable_du: z.string().max(60).optional().describe("Date d'effet, AAAA-MM-JJ ou dictée ; aujourd'hui par défaut."),
      source: z.string().max(300).optional().describe("D'où vient la valeur (« relevé OpenAI du 25/09 », « dit par Lucas »)."),
      automatisme: z.string().max(60).optional().describe("Code de l'interrupteur à régler."),
      actif: z.boolean().optional(),
      sms_code: z.enum(CODES_SMS).optional().describe("Catalogue SMS : le code du message à réécrire (voir « voir_parametres » avec groupe SMS)."),
      sms_texte: z.string().trim().min(1).max(600).optional().describe("Le nouveau texte du SMS : les variables du message seulement ({prenom}, {quand}, {lien}…), le lien toujours à la toute fin."),
    })
    .refine((e) => [e.cle !== undefined && e.valeur !== undefined, e.automatisme !== undefined && e.actif !== undefined, e.sms_code !== undefined && e.sms_texte !== undefined].filter(Boolean).length === 1, {
      message: "Donne soit cle + valeur, soit automatisme + actif, soit sms_code + sms_texte.",
    }),
  apercu: async (e, contexte) => {
    if (e.sms_code !== undefined) {
      const m = await texteSmsAModifier(e.sms_code, e.sms_texte!, false);
      return `Je vais remplacer le texte SMS ${e.sms_code} (${m.libelle}) : « ${m.avant} » → « ${m.apres} ». Il vaudra pour les prochains SMS proposés ; les SMS déjà copiés ne changent pas.`;
    }
    const serie = serieDeCompteur(e.cle);
    if (serie) {
      const courant = (await lireCompteurs(contexte.maintenant)).find((c) => c.serie === serie)!;
      return `Je vais faire repartir la numérotation des ${courant.libelle.toLowerCase()} : prochain numéro ${courant.prochain} → ${String(e.valeur)}. Refusé si ce numéro ne dépasse pas le plus haut inscrit au registre (${courant.plusHautRegistre}).`;
    }
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
    if (e.sms_code !== undefined) {
      const m = await texteSmsAModifier(e.sms_code, e.sms_texte!, true);
      if (!m.id) throw new ErreurMetier(`Code SMS ${e.sms_code} absent de Paramètres → SMS : rien n'a été fait.`, 409);
      const apres = await modifierModele(m.id, { texte: m.apres });
      return { texte: `Texte SMS ${e.sms_code} (${m.libelle}) remplacé : « ${apres.texte} » (avant : « ${m.avant} »). Il vaut pour les prochains SMS proposés.`, donnees: { code: e.sms_code, avant: m.avant, apres: apres.texte }, liens: [lien("Paramètres → SMS", "/parametres")] };
    }
    const serie = serieDeCompteur(e.cle);
    if (serie) {
      const c = await poserCompteur({ serie, prochain: typeof e.valeur === "number" ? e.valeur : String(e.valeur) });
      return { texte: `Numérotation des ${c.libelle.toLowerCase()} ${c.annee} : prochain numéro ${c.prochain} (dernier attribué ${c.valeur ?? "—"}, plus haut inscrit ${c.plusHautRegistre}).`, donnees: c, liens: [lien("Paramètres → Numérotation", "/parametres")] };
    }
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

/** « COMPTEUR_DEVIS » / « COMPTEUR_FACTURE » : la numérotation, pas un paramètre daté. */
function serieDeCompteur(cle: string | undefined): Serie | null {
  const c = cle?.trim().toUpperCase();
  return c === "COMPTEUR_DEVIS" ? "DEVIS" : c === "COMPTEUR_FACTURE" ? "FACTURE" : null;
}

function dateEffet(texte: string | undefined, maintenant: Date): Date {
  if (!texte?.trim()) return maintenant;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte.trim())) return new Date(`${texte.trim()}T00:00:00.000Z`);
  const date = lireDateDictee(texte, maintenant, 12);
  if (!date) throw new ErreurMetier(`Date non comprise : « ${texte} ». Donne-la au format AAAA-MM-JJ.`, 400);
  return date;
}

export const OUTILS_PARAMETRES_LECTURE = [outilVoirParametres];
export const OUTILS_PARAMETRES_ECRITURE = [outilModifierParametres];
