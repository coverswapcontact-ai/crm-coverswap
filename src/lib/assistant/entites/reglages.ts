import { z } from "zod/v4";
import { listerAutomatismes, reglerAutomatisme } from "@/lib/automatismes/interrupteurs";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateCourte } from "@/lib/commun/format";
import { lireCompteurs, poserCompteur, SERIES, type Serie } from "@/lib/dossiers/compteurs";
import { EVENEMENTS_NOTIFIES, LIBELLES_NOTIFICATION, enregistrerModeleNotification, modeleNotification, type EvenementNotifie } from "@/lib/mail/notifications";
import { enregistrerGuideStyle, genererGuideStyle, lireGuideStyle } from "@/lib/mail/redaction";
import { CLES_PARAMETRES, DEFINITIONS_PARAMETRES, formaterValeurParametre, type CleParametre } from "@/lib/parametres/definitions";
import { enregistrerParametre, estCleParametre, parametresPourEcran, validerValeur } from "@/lib/parametres/service";
import { enregistrerVersion, lirePrompt, restaurerVersion as restaurerVersionPrompt } from "@/lib/simulateur/bibliotheque";
import { LONGUEUR_MAX, verifierModele } from "@/lib/simulateur/rendu";
import { typeSurface } from "@/lib/simulateur/types-surface";
import { definitionSms, estCodeSms, verifierTexteSms } from "@/lib/sms/catalogue";
import { listerCatalogue, modifierModele, poserModelesParDefaut } from "@/lib/sms/modeles";
import { lireDateDictee } from "../agenda";
import { CLE_CONSIGNES, CLE_POSITIONNEMENT, CONSIGNES_DEFAUT, POSITIONNEMENT_DEFAUT, appliquerModification, diffLignes, enregistrerConsignes, enregistrerPositionnement, lireConsignes, lirePositionnement, MODES_MODIFICATION, restaurerVersion, type ModeModification } from "../consignes";
import { ACTEUR_ASSISTANT } from "../execution";
import { exigerId, type ContexteEcriture, type DefinitionEntite, type Valeurs } from "./socle";

/**
 * Les réglages (mission 17, partie C) : paramètre daté (un ou en lot), compteur de numérotation, interrupteur
 * d'automatisme, modèle de SMS, modèle de mail de l'espace, guide de style, consignes, positionnement, prompt du
 * simulateur. Tous sensibles (aperçu, puis jeton) ; chacun passe par la fonction de service de son écran.
 */

type Objet = z.ZodObject<z.ZodRawShape>;
const objet = (schema: unknown) => schema as Objet;
const toujours = () => true;
const parAssistant = (contexte: ContexteEcriture) => `assistant Claude (${contexte.utilisateur})`;

/* ── Paramètre daté ─────────────────────────────────────────────────── */

function dateEffet(texte: unknown, maintenant: Date): Date {
  if (typeof texte !== "string" || !texte.trim()) return maintenant;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte.trim())) return new Date(`${texte.trim()}T00:00:00.000Z`);
  const date = lireDateDictee(texte, maintenant, 12);
  if (!date) throw new ErreurMetier(`Date non comprise : « ${texte} ». Donne-la au format AAAA-MM-JJ.`, 400);
  return date;
}

type Saisie = { cle: string; valeur: unknown; valableDu: Date; source: string | null };
const saisie = z.object({ cle: z.string().min(1).max(60), valeur: z.union([z.number(), z.string().max(300)]), valableDu: z.string().max(60).optional(), source: z.string().trim().max(300).nullable().optional() });

export const PARAMETRE: DefinitionEntite = {
  code: "PARAMETRE",
  libelle: "le paramètre",
  designation: "id = la clé du paramètre (« CAMPAGNE_BUDGET », « ZONE_DEPARTEMENTS »), ou champs.saisies pour un lot",
  resoudre: async (r) => {
    const cle = r.id?.trim().toUpperCase();
    if (!cle || cle === "PARAMETRES") return { id: "PARAMETRES", nom: "les paramètres", archive: false, contexte: {} };
    if (!estCleParametre(cle)) throw new ErreurMetier(`Paramètre inconnu : « ${r.id} » (clés : ${CLES_PARAMETRES.join(", ")}).`, 404);
    return { id: cle, nom: `le paramètre ${DEFINITIONS_PARAMETRES[cle as CleParametre].libelle} (${cle})`, archive: false, contexte: {} };
  },
  chemin: () => "/parametres",
  modifier: {
    schema: objet(z.object({ valeur: z.union([z.number(), z.string().max(300)]), valableDu: z.string().max(60), source: z.string().trim().max(300).nullable(), saisies: z.array(saisie).min(1).max(30) }).partial()),
    libelles: Object.fromEntries(CLES_PARAMETRES.map((cle) => [cle, `${DEFINITIONS_PARAMETRES[cle].libelle} (${cle})`])),
    texte: Object.fromEntries(CLES_PARAMETRES.map((cle) => [cle, (v: unknown) => (v === null || v === undefined ? "non renseigné" : formaterValeurParametre(cle, v as never))])),
    sensible: toujours,
    tracePrevue: true,
    lire: async () => Object.fromEntries((await parametresPourEcran()).map((p) => [p.cle, p.courante?.valeur ?? null])),
    preparer: (e, _avant, cible, contexte) => {
      const brutes = Array.isArray(e.saisies) ? (e.saisies as z.output<typeof saisie>[]) : cible.id !== "PARAMETRES" && e.valeur !== undefined ? [{ cle: cible.id, valeur: e.valeur as number | string, valableDu: e.valableDu as string | undefined, source: e.source as string | null | undefined }] : null;
      if (!brutes) throw new ErreurMetier("Donne id (la clé) + champs.valeur, ou champs.saisies : [{ cle, valeur, valable_du, source }].", 400);
      const saisies: Saisie[] = brutes.map((s) => {
        const cle = s.cle.trim().toUpperCase();
        if (!estCleParametre(cle)) throw new ErreurMetier(`Paramètre inconnu : « ${s.cle} ».`, 404);
        return { cle, valeur: validerValeur(cle, s.valeur), valableDu: dateEffet(s.valableDu, contexte.maintenant), source: s.source?.trim() || null };
      });
      return { ...Object.fromEntries(saisies.map((s) => [s.cle, s.valeur])), _saisies: saisies };
    },
    note: (apres) => {
      const saisies = (apres._saisies as Saisie[] | undefined) ?? [];
      const futures = saisies.filter((s) => s.valableDu.getTime() > Date.now() + 86_400_000);
      return `${futures.length ? `Valable à partir du ${futures.map((s) => `${dateCourte(s.valableDu)} (${s.cle})`).join(", ")}. ` : ""}L'ancienne valeur reste dans l'historique.`;
    },
    appliquer: async (_cible, valeurs, contexte) => {
      const saisies = (valeurs._saisies as Saisie[] | undefined) ?? Object.entries(valeurs).map(([cle, valeur]) => ({ cle, valeur, valableDu: contexte.maintenant, source: "Annulation par l'assistant (valeur d'avant)" }));
      for (const s of saisies) {
        if (s.valeur === null || s.valeur === undefined) throw new ErreurMetier(`${s.cle} n'avait pas de valeur avant : un paramètre ne se vide pas, pose la bonne valeur.`, 409);
        await enregistrerParametre({ cle: s.cle, valeur: s.valeur, valableDu: s.valableDu, source: s.source ?? parAssistant(contexte) });
      }
    },
  },
};

/* ── Compteur de numérotation ───────────────────────────────────────── */

export const COMPTEUR: DefinitionEntite = {
  code: "COMPTEUR",
  libelle: "la numérotation",
  designation: "id = DEVIS ou FACTURE",
  resoudre: async (r) => {
    const serie = exigerId(r, "la série", "« etat_crm » NUMEROTATION (DEVIS ou FACTURE)").toUpperCase().replace(/^COMPTEUR_/, "");
    if (!(SERIES as readonly string[]).includes(serie)) throw new ErreurMetier(`Série inconnue : « ${r.id} » (DEVIS ou FACTURE).`, 404);
    return { id: serie, nom: `la numérotation des ${serie === "DEVIS" ? "devis" : "factures et avoirs"}`, archive: false, contexte: {} };
  },
  chemin: () => "/parametres",
  modifier: {
    schema: objet(z.object({ prochain: z.union([z.string().trim().min(1, "Prochain numéro manquant.").max(20, "Numéro trop long."), z.number().int().min(1)]) })),
    libelles: { prochain: "le prochain numéro" },
    texte: { prochain: (v) => String(v ?? "—") },
    sensible: toujours,
    note: async (_apres, _avant, cible) => {
      const c = (await lireCompteurs()).find((x) => x.serie === cible.id);
      return c ? `Refusé si ce numéro ne dépasse pas le plus haut inscrit au registre (${c.plusHautRegistre}).` : null;
    },
    lire: async (cible) => ({ prochain: (await lireCompteurs()).find((c) => c.serie === cible.id)?.prochain ?? null }),
    appliquer: async (cible, valeurs) => {
      await poserCompteur({ serie: cible.id as Serie, prochain: valeurs.prochain as string | number });
    },
  },
};

/* ── Interrupteur d'automatisme ─────────────────────────────────────── */

export const AUTOMATISME: DefinitionEntite = {
  code: "AUTOMATISME",
  libelle: "l'automatisme",
  designation: "id = le code (NOTIF_…, SMS_ACCUSE_…, SEQUENCE_…, IA_CRM, MAIL_RANGEMENT_GMAIL)",
  resoudre: async (r) => {
    const code = exigerId(r, "l'automatisme", "« etat_crm » PARAMETRES").toUpperCase();
    const tous = await listerAutomatismes();
    const a = tous.find((x) => x.code === code);
    if (!a) throw new ErreurMetier(`Automatisme inconnu : « ${r.id} » (codes : ${tous.map((x) => x.code).join(", ")}).`, 404);
    return { id: code, nom: `« ${a.libelle} » (${code})`, archive: false, contexte: { description: a.description } };
  },
  chemin: () => "/parametres",
  modifier: {
    schema: objet(z.object({ actif: z.boolean() })),
    libelles: { actif: "l'état" },
    texte: { actif: (v) => (v ? "actif" : "inactif") },
    sensible: toujours,
    note: (_a, _b, cible) => String(cible.contexte.description ?? ""),
    lire: async (cible) => ({ actif: (await listerAutomatismes()).find((a) => a.code === cible.id)?.actif ?? null }),
    appliquer: async (cible, valeurs, contexte) => {
      await reglerAutomatisme(cible.id, Boolean(valeurs.actif), parAssistant(contexte));
    },
  },
};

/* ── Modèle de SMS ──────────────────────────────────────────────────── */

export const MODELE_SMS: DefinitionEntite = {
  code: "MODELE_SMS",
  libelle: "le modèle de SMS",
  designation: "id = le code du catalogue SMS (« LIEN_ESPACE », « RELANCE_DEVIS_1 »…)",
  resoudre: async (r) => {
    const code = exigerId(r, "le modèle de SMS", "« etat_crm » SMS").toUpperCase();
    if (!estCodeSms(code)) throw new ErreurMetier(`Code SMS inconnu : « ${r.id} ».`, 404);
    return { id: code, nom: `le SMS ${code} (${definitionSms(code)!.libelle})`, archive: false, contexte: {} };
  },
  chemin: () => "/parametres#sms",
  modifier: {
    // Le schéma de la route PATCH /api/sms/modeles/[id], plus « defaut » (le bouton « Revenir au texte de départ »).
    schema: objet(z.object({ libelle: z.string().trim().min(2).max(120), texte: z.string().trim().min(1, "Le texte du message est vide.").max(600, "Message type trop long (600 caractères au plus)."), actif: z.boolean(), defaut: z.literal(true) }).partial()),
    libelles: { libelle: "le libellé", texte: "le texte", actif: "l'envoi automatique" },
    texte: { actif: (v) => (v ? "actif" : "coupé") },
    sensible: toujours,
    note: () => "Il vaudra pour les prochains SMS ; ceux déjà copiés ne changent pas.",
    lire: async (cible) => {
      const m = (await listerCatalogue()).find((x) => x.code === cible.id)!;
      return { libelle: m.libelle, texte: m.texte, actif: m.actif };
    },
    preparer: (e, _avant, cible) => {
      const { defaut, ...reste } = e;
      const apres: Valeurs = defaut ? { ...reste, texte: definitionSms(cible.id)!.defaut } : reste;
      if (typeof apres.texte === "string") {
        const refus = verifierTexteSms(cible.id, apres.texte);
        if (refus) throw new ErreurMetier(`Texte SMS ${cible.id} refusé : ${refus}`, 400);
      }
      return apres;
    },
    appliquer: async (cible, valeurs) => {
      let ligne = (await listerCatalogue()).find((m) => m.code === cible.id);
      if (!ligne?.id) {
        await poserModelesParDefaut();
        ligne = (await listerCatalogue()).find((m) => m.code === cible.id);
      }
      if (!ligne?.id) throw new ErreurMetier(`Code SMS ${cible.id} absent de Paramètres → SMS.`, 409);
      await modifierModele(ligne.id, valeurs);
    },
  },
};

/* ── Modèle de mail de l'espace client ──────────────────────────────── */

export const MODELE_MAIL: DefinitionEntite = {
  code: "MODELE_MAIL",
  libelle: "le modèle de mail",
  designation: `id = l'événement (${EVENEMENTS_NOTIFIES.join(", ")})`,
  resoudre: async (r) => {
    const evenement = exigerId(r, "le modèle de mail", "« etat_crm » MAIL").toUpperCase().replace(/^NOTIF_/, "");
    if (!(EVENEMENTS_NOTIFIES as readonly string[]).includes(evenement)) throw new ErreurMetier(`Événement inconnu : « ${r.id} » (${EVENEMENTS_NOTIFIES.join(", ")}).`, 404);
    return { id: evenement, nom: `le mail « ${LIBELLES_NOTIFICATION[evenement as EvenementNotifie]} »`, archive: false, contexte: {} };
  },
  chemin: () => "/parametres#mail",
  modifier: {
    // Le schéma de la route PATCH /api/mail/reglages (modele), chaque champ facultatif : le modèle entier est relu puis réécrit.
    schema: objet(z.object({ objet: z.string().trim().min(3).max(150), phrase: z.string().trim().min(10).max(600), bouton: z.string().trim().min(2).max(40), actif: z.boolean() }).partial()),
    libelles: { objet: "l'objet", phrase: "la phrase", bouton: "le bouton", actif: "l'envoi" },
    texte: { actif: (v) => (v ? "actif" : "coupé") },
    sensible: toujours,
    note: () => "Ce texte part aux clients à chaque événement.",
    lire: async (cible) => ({ ...(await modeleNotification(cible.id as EvenementNotifie)) }),
    appliquer: async (cible, valeurs) => {
      const courant = await modeleNotification(cible.id as EvenementNotifie);
      await enregistrerModeleNotification(cible.id as EvenementNotifie, { ...courant, ...(valeurs as Partial<typeof courant>) }, ACTEUR_ASSISTANT);
    },
  },
};

/* ── Guide de style ─────────────────────────────────────────────────── */

export const GUIDE_STYLE: DefinitionEntite = {
  code: "GUIDE_STYLE",
  libelle: "le guide de style",
  designation: "aucun id",
  resoudre: async () => ({ id: "GUIDE_STYLE", nom: "le guide de style des mails", archive: false, contexte: {} }),
  chemin: () => "/parametres#mail",
  modifier: {
    schema: objet(z.object({ texte: z.string().trim().min(20, "Le guide de style est trop court.").max(4000), tirerDesMails: z.literal(true) }).partial()),
    libelles: { texte: "le guide" },
    sensible: toujours,
    lire: async () => ({ texte: (await lireGuideStyle()).texte }),
    preparer: (e) => (e.tirerDesMails ? { _tirer: true } : e),
    note: (apres) => (apres._tirer ? "Le guide sera tiré de tes 30 derniers mails envoyés, par l'IA (un appel payant, adresses et numéros retirés)." : null),
    appliquer: async (_cible, valeurs) => {
      if (valeurs._tirer) await genererGuideStyle(ACTEUR_ASSISTANT);
      else await enregistrerGuideStyle(valeurs.texte as string, ACTEUR_ASSISTANT);
    },
  },
};

/* ── Consignes et positionnement ────────────────────────────────────── */

function texteDiff(avant: string, apres: string): string {
  const d = diffLignes(avant, apres);
  if (d.ajoutees.length === 0 && d.retirees.length === 0) return "Aucune ligne ne change.";
  return [d.retirees.length ? `Lignes retirées (${d.retirees.length}) :\n${d.retirees.map((l) => `− ${l}`).join("\n")}` : "", d.ajoutees.length ? `Lignes ajoutées (${d.ajoutees.length}) :\n${d.ajoutees.map((l) => `+ ${l}`).join("\n")}` : ""].filter(Boolean).join("\n");
}

function texteAssistant(code: "CONSIGNES" | "POSITIONNEMENT"): DefinitionEntite {
  const consignes = code === "CONSIGNES";
  const cle = consignes ? CLE_CONSIGNES : CLE_POSITIONNEMENT;
  const lire = consignes ? lireConsignes : lirePositionnement;
  const enregistrer = consignes ? enregistrerConsignes : enregistrerPositionnement;
  const nom = consignes ? "les consignes de Claude" : "le positionnement";
  return {
    code,
    libelle: nom,
    designation: "aucun id",
    resoudre: async () => ({ id: cle, nom, archive: false, contexte: {} }),
    chemin: () => "/parametres#assistant",
    modifier: {
      schema: objet(z.object({ mode: z.enum(MODES_MODIFICATION), section: z.string().max(120).nullable(), contenu: z.string().min(1).max(20_000), defaut: z.literal(true) }).partial()),
      libelles: { texte: "le texte" },
      texte: { texte: (v) => `${typeof v === "string" ? v.length.toLocaleString("fr-FR") : 0} caractères` },
      sensible: toujours,
      lire: async () => ({ texte: (await lire()).texte }),
      preparer: (e, avant) => {
        if (e.defaut) return { texte: consignes ? CONSIGNES_DEFAUT : POSITIONNEMENT_DEFAUT };
        if (!e.mode || typeof e.contenu !== "string") throw new ErreurMetier("Donne mode (remplacer_section, completer_section, ajouter_section, remplacer_tout) et contenu, ou defaut: true.", 400);
        return { texte: appliquerModification(avant.texte as string, { mode: e.mode as ModeModification, section: (e.section as string | null | undefined) ?? null, contenu: e.contenu }) };
      },
      note: (apres, avant) => `${texteDiff(avant.texte as string, apres.texte as string)}\nUne version est gardée : l'ancienne se restaure.`,
      appliquer: async (_cible, valeurs, contexte) => {
        await enregistrer(valeurs.texte as string, ACTEUR_ASSISTANT, contexte.commande);
      },
    },
    restaurerVersion: async (_cible, numero, contexte) => {
      const v = await restaurerVersion(cle, numero, ACTEUR_ASSISTANT, contexte.commande);
      return `${consignes ? "Consignes" : "Positionnement"} : version ${numero} restaurée (enregistrée comme version ${v.numero}).`;
    },
  };
}

export const CONSIGNES = texteAssistant("CONSIGNES");
export const POSITIONNEMENT = texteAssistant("POSITIONNEMENT");

/* ── Prompt du simulateur ───────────────────────────────────────────── */

export const PROMPT_SIMULATION: DefinitionEntite = {
  code: "PROMPT_SIMULATION",
  libelle: "le prompt",
  designation: "id = le type de surface (« cuisine », « plan-vasque », « dressing »…)",
  resoudre: async (r) => {
    const id = exigerId(r, "le prompt", "« etat_crm » PROMPTS (le type de surface)").toLowerCase();
    const type = typeSurface(id);
    if (!type) throw new ErreurMetier(`Type de surface inconnu : « ${r.id} ».`, 404);
    return { id, nom: `le prompt « ${type.libelle} » du simulateur`, archive: false, contexte: {} };
  },
  chemin: () => "/simulateur/prompts",
  modifier: {
    schema: objet(z.object({ texte: z.string().max(LONGUEUR_MAX, `Prompt trop long (${LONGUEUR_MAX.toLocaleString("fr-FR")} caractères au plus).`), note: z.string().max(300).nullable() }).partial()),
    libelles: { texte: "le texte du prompt" },
    texte: { texte: (v) => `${typeof v === "string" ? v.length.toLocaleString("fr-FR") : 0} caractères` },
    sensible: toujours,
    lire: async (cible) => ({ texte: (await lirePrompt(cible.id)).texte }),
    // Le bouton « Vérifier » de l'écran : une erreur refuse dès l'aperçu, les avertissements y sont lus.
    preparer: (e, _avant, cible) => {
      const { note, ...reste } = e;
      if (typeof reste.texte === "string") {
        const texte = reste.texte.replace(/\r\n/g, "\n").trim();
        const { erreurs } = verifierModele(texte, typeSurface(cible.id)!);
        if (erreurs.length) throw new ErreurMetier(`Prompt refusé : ${erreurs.join(" ; ")}`, 400);
        reste.texte = texte;
      }
      return { ...reste, ...(note ? { _note: note } : {}) };
    },
    note: (apres, avant, cible) => {
      if (typeof apres.texte !== "string") return null;
      const { avertissements } = verifierModele(apres.texte, typeSurface(cible.id)!);
      return `${avertissements.length ? `Avertissements : ${avertissements.join(" ; ")}\n` : ""}${texteDiff(avant.texte as string, apres.texte)}\nUne nouvelle version est mise en service ; l'ancienne se restaure.`;
    },
    appliquer: async (cible, valeurs, contexte) => {
      await enregistrerVersion(cible.id, { texte: valeurs.texte as string, note: (valeurs._note as string | undefined) ?? contexte.commande ?? "Modifié par l'assistant" });
    },
  },
  restaurerVersion: async (cible, numero) => {
    const p = await restaurerVersionPrompt(cible.id, numero);
    return `Prompt « ${p.libelle} » : version ${numero} restaurée (en service sous le numéro ${p.versionCourante}).`;
  },
};

export const ENTITES_REGLAGES = [PARAMETRE, COMPTEUR, AUTOMATISME, MODELE_SMS, MODELE_MAIL, GUIDE_STYLE, CONSIGNES, POSITIONNEMENT, PROMPT_SIMULATION];
