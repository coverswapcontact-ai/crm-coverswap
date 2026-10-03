import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { pluriel } from "@/lib/commun/format";
import { annulerModification, calculerChangements, CHAMPS_SENSIBLES, derniereModification, devisImpacte, lireValeurs, modifierDossierAssistant, schemaModificationAssistant, type Changement as ChangementDossier, type ChampModifiable, type DevisImpacte, type EntreeModificationAssistant } from "@/lib/dossiers/modification-assistant";
import { restaurerDossier, archiverDossier } from "@/lib/dossiers/archivage";
import { libelleReperee, repererSousPartie } from "@/lib/prestations/reperage";
import { appliquerActionLeads } from "@/lib/prospects/menage";
import { MOTIFS_ARCHIVAGE } from "@/lib/prospects/menage-constantes";
import { changementsDe, champsPermis, clesEnCamel, EntiteAmbigue, ENTITES_ARCHIVABLES, ENTITES_CREABLES, ENTITES_MODIFIABLES, ENTITES_RESTAURABLES, entite as definitionDe, estSensible, jourDicte, phraseChangement, REGISTRE_ENTITES, resultatAmbigu, validerChamps, type Changement, type ContexteEcriture, type DefinitionEntite, type DefinitionModification, type Entite, type Resolu, type Valeurs } from "../entites";
import { ambiguite } from "../entites/socle";
import { definirOutil, format, lien, type ContexteOutil, type LienOutil, type ResultatOutil } from "../definition";
import { derniereModificationTracee, lireModification, marquerAnnulee, tracerModification, type ModificationTracee } from "../modifications";
import { CibleAmbigue, resoudreCible, schemaCible, texteAmbigu, type Cible } from "./lecture";

/**
 * Les outils génériques de l'assistant (mission 17, partie C ; docs/MCP-COUVERTURE.md § 4.3 à 4.5) : « modifier »,
 * « creer », « archiver », « restaurer » et « annuler_modification », pour toutes les entités du registre
 * (`assistant/entites.ts`). Aucune logique métier ici, aucune écriture brute : chaque cas appelle la fonction de
 * service de l'écran, avec le schéma de sa route (étapes, relances, main, historique respectés). Sensibilité par cas :
 * le client, l'argent, un paramètre ou l'irréversible donnent un aperçu précis (« le montant estimé passe de 5 000 € à
 * 6 200 € »), puis n'agissent qu'avec le jeton. Chaque « modifier » laisse sa trace avant → après, que
 * « annuler_modification » défait par le même chemin.
 *
 * « archiver », « restaurer » et « annuler_modification » reprennent les noms (et le comportement) des outils de
 * `menage.ts` et `actions.ts`, qu'ils remplacent : l'intégration du catalogue retire les anciens.
 */

const contexteDe = (c: ContexteOutil): ContexteEcriture => ({ commande: c.commande, maintenant: c.maintenant, utilisateur: c.utilisateur });
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cheminDe = (d: DefinitionEntite, c: Resolu): LienOutil[] => (d.chemin ? [lien(majuscule(d.libelle), d.chemin(c))] : []);

async function avecAmbiguite<T>(f: () => Promise<T>): Promise<T | ResultatOutil> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof EntiteAmbigue) return resultatAmbigu(e);
    throw e;
  }
}
const estResultat = (v: unknown): v is ResultatOutil => Boolean(v && typeof v === "object" && "texte" in v && !("genre" in v));

/* ── modifier ────────────────────────────────────────────────────────── */

/** Le cœur du dossier : les champs de `modifierDossierAssistant` (tracés dans ModificationDossier), en snake_case. */
const CHAMPS_COEUR = new Set([...Object.keys(schemaModificationAssistant.shape), "teinte"]);
const DATES_COEUR = ["date_souhaitee", "date_chantier", "date_fin_chantier", "prochaine_action_date"] as const;
const ARTICLES_COEUR: Record<ChampModifiable, string> = {
  objet: "l'objet du dossier",
  montant_estime: "le montant estimé (budget annoncé)",
  date_souhaitee: "la date souhaitée",
  date_chantier: "la date de pose",
  date_fin_chantier: "la fin du chantier",
  adresse: "l'adresse du chantier",
  email: "l'e-mail",
  telephone: "le téléphone",
  prochaine_action: "la prochaine action",
  prochaine_action_date: "la date de la prochaine action",
  familles: "les familles et sous-parties",
  teintes: "les teintes",
  dimensions: "les dimensions",
  notes_projet: "le mot du projet",
};
const phraseCoeur = (c: ChangementDossier) => phraseChangement({ libelle: ARTICLES_COEUR[c.champ] ?? c.libelle, texteAvant: c.texteAvant, texteApres: c.texteApres });

const schemaModifier = z.object({
  entite: z.enum(ENTITES_MODIFIABLES).describe("L'entité à modifier (voir la description)."),
  id: z.string().min(1).max(120).optional().describe("Son identifiant, ou sa clé (code, série, type, clé de paramètre, sous-partie en mots)."),
  cible: schemaCible.optional().describe("Lead, dossier ou client : à défaut d'id, l'identifiant ou le nom dit par Lucas."),
  champs: z.record(z.string().max(60), z.unknown()).describe("Les champs à changer, en snake_case ; seuls ceux donnés changent ; null efface un champ effaçable."),
});
type EntreeModifier = z.output<typeof schemaModifier>;

type PlanGenerique = { genre: "GENERIQUE"; definition: DefinitionEntite; modification: DefinitionModification; cible: Resolu; avant: Valeurs; apres: Valeurs; changements: Changement[]; sensible: boolean; note: string | null };
type PlanCoeur = { entree: EntreeModificationAssistant; changements: ChangementDossier[]; devis: DevisImpacte | null };
type PlanModifier = { cible: Resolu; definition: DefinitionEntite; generique: PlanGenerique | null; coeur: PlanCoeur | null; sensible: boolean };

async function planGenerique(definition: DefinitionEntite, cible: Resolu, champs: Valeurs, contexte: ContexteEcriture): Promise<PlanGenerique> {
  const modification = definition.modifier!;
  let entree = clesEnCamel(champs) as Valeurs;
  if (modification.pretraiter) entree = modification.pretraiter(entree, contexte);
  const valide = validerChamps(modification.schema, entree, definition.code);
  const avant = await modification.lire(cible);
  const apres = modification.preparer ? await modification.preparer(valide, avant, cible, contexte) : valide;
  const changements = changementsDe(modification, apres, avant);
  const note = modification.note ? await modification.note(apres, avant, cible) : null;
  return { genre: "GENERIQUE", definition, modification, cible, avant, apres, changements, sensible: estSensible(modification, apres, avant, cible), note };
}

async function planCoeur(dossierId: string, champs: Valeurs, contexte: ContexteEcriture): Promise<PlanCoeur> {
  const brut: Valeurs = { ...champs };
  for (const champ of DATES_COEUR) if (champ in brut) brut[champ] = jourDicte(brut[champ], contexte.maintenant, champ);
  const lecture = await lireValeurs(dossierId);
  // « teinte » { meuble, teinte } (l'ex-« changer_teinte ») : le meuble est reconnu dans les familles du dossier, jamais choisi à la place de Lucas.
  if (brut.teinte !== undefined) {
    const t = z.object({ meuble: z.string().min(1).max(80), teinte: z.string().trim().max(80).nullable() }).safeParse(brut.teinte);
    if (!t.success) throw new ErreurMetier("teinte attendue : { meuble, teinte } (teinte: null la retire).", 400);
    const r = repererSousPartie(t.data.meuble, { selection: lecture.valeurs.familles });
    if ("candidats" in r) throw ambiguite(r.candidats.map((c) => ({ id: c.cle, nom: libelleReperee(c) })), `meubles « ${t.data.meuble} »`);
    if ("aucune" in r) throw new ErreurMetier(`Aucun meuble « ${t.data.meuble} » dans le projet.${r.proposees.length ? ` Sous-parties proches : ${r.proposees.map(libelleReperee).join(" ; ")} — l'ajouter d'abord (ajouter_sous_parties).` : ""}`, 404);
    brut.teintes = { ...((brut.teintes as Record<string, string | null> | undefined) ?? {}), [r.trouvee.cle]: t.data.teinte };
    delete brut.teinte;
  }
  const v = schemaModificationAssistant.safeParse(brut);
  if (!v.success) throw new ErreurMetier(`Champs invalides pour DOSSIER : ${v.error.issues.map((i) => `${i.path.join(".") || "champs"} : ${i.message}`).join(" ; ")}.`, 400);
  const changements = calculerChangements(v.data, lecture);
  return { entree: v.data, changements, devis: await devisImpacte(dossierId, changements) };
}

async function planifierModifier(e: EntreeModifier, contexte: ContexteEcriture): Promise<PlanModifier> {
  const definition = definitionDe(e.entite);
  if (Object.keys(e.champs).length === 0) throw new ErreurMetier(`Aucun champ à modifier. Champs permis pour ${e.entite} : ${champsDe(e.entite).join(", ")}.`, 400);
  const cible = await definition.resoudre!({ id: e.id, cible: e.cible as Cible | undefined });
  if (e.entite !== "DOSSIER") {
    const generique = await planGenerique(definition, cible, e.champs, contexte);
    return { cible, definition, generique, coeur: null, sensible: generique.sensible };
  }
  const coeurChamps = Object.fromEntries(Object.entries(e.champs).filter(([k]) => CHAMPS_COEUR.has(k)));
  const suiteChamps = Object.fromEntries(Object.entries(e.champs).filter(([k]) => !CHAMPS_COEUR.has(k)));
  const coeur = Object.keys(coeurChamps).length ? await planCoeur(cible.id, coeurChamps, contexte) : null;
  const generique = Object.keys(suiteChamps).length ? await planGenerique(definition, cible, suiteChamps, contexte) : null;
  const sensibleCoeur = coeur ? CHAMPS_SENSIBLES.some((c) => (coeur.entree as Record<string, unknown>)[c] !== undefined) : false;
  return { cible, definition, generique, coeur, sensible: sensibleCoeur || Boolean(generique?.sensible) };
}

function texteApercu(plan: PlanModifier): string {
  const lignes = [...(plan.coeur?.changements.map(phraseCoeur) ?? []), ...(plan.generique?.changements.map(phraseChangement) ?? [])];
  const effet = plan.generique && Object.keys(plan.generique.apres).some((k) => k.startsWith("_"));
  if (lignes.length === 0 && !effet) return `Rien à changer sur ${plan.cible.nom} : les valeurs données sont déjà les siennes.`;
  return [`Je vais modifier ${plan.cible.nom}${lignes.length ? ` : ${lignes.join(" ; ")}` : ""}.`, plan.coeur?.devis?.message ?? "", plan.generique?.note ?? "", plan.cible.archive ? `(${plan.definition.libelle} est archivé${plan.definition.libelle.startsWith("la") ? "e" : ""}.)` : ""].filter(Boolean).join("\n");
}

/** Ce qui a vraiment changé : l'état relu après écriture (effets de bord compris), et les changements prévus que la lecture ne montre pas. */
function changementsTraces(plan: PlanGenerique, apresLu: Valeurs | null): Changement[] {
  if (plan.modification.tracePrevue || !apresLu) return plan.changements;
  const lus = changementsDe(plan.modification, apresLu, plan.avant);
  const vus = new Set(Object.keys(apresLu));
  return [...lus, ...plan.changements.filter((c) => !vus.has(c.cle))];
}

async function executerModifier(e: EntreeModifier, contexteOutil: ContexteOutil): Promise<ResultatOutil> {
  const contexte = contexteDe(contexteOutil);
  const plan = await planifierModifier(e, contexte);
  const lignes: string[] = [];
  const ids: string[] = [];
  const donnees: Valeurs = { entite: e.entite, id: plan.cible.id };
  if (plan.coeur && plan.coeur.changements.length) {
    const r = await modifierDossierAssistant(plan.cible.id, plan.coeur.entree, { commande: contexte.commande });
    if (r.modification) {
      lignes.push(...r.changements.map(phraseCoeur));
      if (r.devis) lignes.push(r.devis.message);
      ids.push(r.modification.id);
      donnees.modificationDossier = r.modification;
    }
  }
  if (plan.generique) {
    const g = plan.generique;
    const effet = Object.keys(g.apres).some((k) => k.startsWith("_"));
    if (g.changements.length || effet) {
      const avertissements = (await g.modification.appliquer(plan.cible, g.apres, contexte)) ?? [];
      const apresLu = await g.modification.lire(plan.cible).catch(() => null);
      const traces = changementsTraces(g, apresLu);
      if (traces.length) {
        const m = await tracerModification({ entite: e.entite, enregistrementId: plan.cible.id, nom: plan.cible.nom, changements: traces, commande: contexte.commande });
        ids.push(m.id);
        lignes.push(...traces.map(phraseChangement));
        donnees.modification = m;
      }
      lignes.push(...avertissements);
    }
  }
  if (ids.length === 0) return { texte: `Rien à changer sur ${plan.cible.nom} : les valeurs données sont déjà les siennes.`, donnees, liens: cheminDe(plan.definition, plan.cible) };
  const irreversibles = plan.generique ? Object.keys(plan.generique.modification.irreversibles ?? {}).filter((c) => plan.generique!.changements.some((x) => x.cle === c)) : [];
  return {
    texte: [`Modifié sur ${plan.cible.nom} : ${lignes.map((l) => l.replace(/\.$/, "")).join(" ; ")}.`, `Pour défaire : « annuler_modification » avec modification_id = ${ids.join(" puis ")}.${irreversibles.length ? ` (${irreversibles.map((c) => plan.generique!.modification.irreversibles![c]).join(" ")})` : ""}`].join("\n"),
    donnees: { ...donnees, modifications: ids },
    liens: cheminDe(plan.definition, plan.cible),
  };
}

/** Les champs permis d'une entité, en snake_case (le cœur du dossier compris). */
function champsDe(code: Entite): string[] {
  const d = REGISTRE_ENTITES[code];
  const suite = d.modifier ? champsPermis(d.modifier.schema) : [];
  return code === "DOSSIER" ? [...CHAMPS_COEUR, ...suite] : suite;
}

const descriptionModifier = () =>
  `Change des champs d'UNE entité du CRM par la même fonction que l'écran (mêmes règles : étapes, relances, main, historique). Seuls les champs donnés changent ; null efface un champ effaçable ; les dates se donnent en AAAA-MM-JJ ou comme dictées. Chaque modification est tracée avant → après ; « annuler_modification » la défait. Sensible par cas (le client, l'argent, un paramètre) : aperçu précis (« le montant estimé passe de 5 000 € à 6 200 € »), puis confirmation par jeton. Plusieurs candidats → demande lequel. Pas ici : l'étape d'un dossier (« changer_etape »), un appel avec son issue (« noter_appel »), un geste sur l'espace client (« geste_espace »). Entités (désignation : champs) :\n${ENTITES_MODIFIABLES.map((code) => `- ${code} (${REGISTRE_ENTITES[code].designation}) : ${champsDe(code).join(", ")}`).join("\n")}\nRaccourcis : DOSSIER teinte {meuble, teinte} (une teinte par meuble), points_masques / points_reaffiches, passage {evenement_id, survenu_le} ; LEAD rappel_le null = sans date, statut PERDU exige motif_perte ; DEPENSE dossier_id rattache une dépense EXISTANTE à un chantier ; COORDONNEE principale: true ; MODELE_SMS defaut: true (texte de départ) ; CONSIGNES / POSITIONNEMENT mode + section + contenu, ou defaut: true ; GUIDE_STYLE tirer_des_mails: true (coût d'IA) ; PARAMETRE id = la clé + valeur, ou saisies [{cle, valeur, valable_du, source}] (lot).`;

export const outilModifier = definirOutil({
  nom: "modifier",
  titre: "Modifier une entité (champ par champ, tracé, annulable)",
  description: descriptionModifier(),
  niveau: "REVERSIBLE",
  schema: schemaModifier,
  sensible: async (e) => {
    try {
      return (await planifierModifier(e, { commande: null, maintenant: new Date(), utilisateur: "" })).sensible;
    } catch {
      return false;
    }
  },
  apercu: async (e, contexte) => {
    const r = await avecAmbiguite(() => planifierModifier(e, contexteDe(contexte)));
    return estResultat(r) ? r.texte : texteApercu(r);
  },
  executer: async (e, contexte) => {
    const r = await avecAmbiguite(() => executerModifier(e, contexte));
    return r;
  },
});

/* ── creer ───────────────────────────────────────────────────────────── */

const schemaCreer = z.object({
  entite: z.enum(ENTITES_CREABLES).describe("L'entité à créer (voir la description)."),
  champs: z.record(z.string().max(60), z.unknown()).describe("Les champs, en snake_case (voir la description)."),
  cible: schemaCible.optional().describe("Le parent : dossier, lead ou client concerné (note, note d'appel, coordonnée, consentement, dépense, tâche, dossier depuis un lead ou une fiche client)."),
});
type EntreeCreer = z.output<typeof schemaCreer>;
type PlanCreer = { definition: DefinitionEntite; valeurs: Valeurs; cible: Resolu | null };

async function resoudreParent(cible: Cible, type: "CLIENT" | "LEAD" | "DOSSIER" | undefined): Promise<Resolu> {
  try {
    const ids = await resoudreCible(cible, type);
    const id = (type === "CLIENT" ? ids.clientId : type === "LEAD" ? ids.leadId : type === "DOSSIER" ? ids.dossierId : ids.dossierId ?? ids.leadId ?? ids.clientId) ?? null;
    if (!id) throw new ErreurMetier(`${ids.nom} n'a pas de ${type === "CLIENT" ? "fiche client" : type === "LEAD" ? "lead" : "dossier"}.`, 409);
    return { id, nom: ids.nom, archive: false, contexte: { dossierId: ids.dossierId, leadId: ids.leadId, clientId: ids.clientId } };
  } catch (e) {
    if (e instanceof CibleAmbigue) throw new EntiteAmbigue(e.candidats.map((c) => ({ id: c.id, nom: c.nom, detail: c.etat })), texteAmbigu(e));
    if (e instanceof Error && !(e instanceof ErreurMetier) && !(e instanceof EntiteAmbigue)) throw new ErreurMetier(e.message, 404);
    throw e;
  }
}

async function planifierCreer(e: EntreeCreer, contexte: ContexteEcriture): Promise<PlanCreer> {
  const definition = definitionDe(e.entite);
  const creation = definition.creer!;
  let entree = (creation.cles === "snake" ? { ...e.champs } : clesEnCamel(e.champs)) as Valeurs;
  if (creation.pretraiter) entree = creation.pretraiter(entree, contexte);
  const forme = (creation.schema as unknown as { shape?: Record<string, unknown> }).shape;
  if (forme) {
    const inconnus = Object.keys(entree).filter((k) => !(k in forme));
    if (inconnus.length) throw new ErreurMetier(`Champ${inconnus.length > 1 ? "s" : ""} inconnu${inconnus.length > 1 ? "s" : ""} pour ${e.entite} : ${inconnus.join(", ")}. Champs permis : ${champsCreation(e.entite).join(", ")}.`, 400);
  }
  const r = creation.schema.safeParse(entree);
  if (!r.success) throw new ErreurMetier(`Champs invalides pour ${e.entite} : ${r.error.issues.map((i) => `${i.path.map(String).join(".") || "champs"} : ${i.message}`).join(" ; ")}.`, 400);
  const aUneCible = Boolean(e.cible && (e.cible.dossierId || e.cible.leadId || e.cible.clientId || e.cible.nom?.trim()));
  if (!aUneCible && creation.cible === "EXIGEE") throw new ErreurMetier(`${e.entite} se pose sur un contact : donne « cible » (dossierId, leadId, clientId ou nom).`, 400);
  if (aUneCible && !creation.cible) throw new ErreurMetier(`${e.entite} ne prend pas de cible.`, 400);
  const cible = aUneCible ? await resoudreParent(e.cible as Cible, creation.typeCible) : null;
  return { definition, valeurs: r.data, cible };
}

function champsCreation(code: Entite): string[] {
  const creation = REGISTRE_ENTITES[code].creer;
  const forme = (creation?.schema as unknown as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (!forme) return [];
  return Object.keys(forme).map((k) => (creation?.cles === "snake" ? k : k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)));
}

export const outilCreer = definirOutil({
  nom: "creer",
  titre: "Créer une entité",
  description: `Crée UNE entité par la même fonction que l'écran (même schéma, mêmes contrôles : anti-doublon d'un lead ou d'un client, justificatif, registre). Sensible par cas (dossier créé à « Signé » ou au-delà, reprise, tarif, règle d'expéditeur) : aperçu, puis confirmation. Plusieurs contacts pour la cible → demande lequel. Entités (champs, en snake_case) :\n${ENTITES_CREABLES.map((code) => `- ${code}${REGISTRE_ENTITES[code].creer?.cible ? ` [cible ${REGISTRE_ENTITES[code].creer?.cible === "EXIGEE" ? "exigée" : "facultative"}]` : ""} : ${champsCreation(code).join(", ")}`).join("\n")}\nDEPENSE crée une NOUVELLE dépense (pour rattacher une dépense existante : « modifier » DEPENSE dossier_id). DOSSIER avec cible = un lead et aucun champ : l'ouverture qui reprend tout (ex-« ouvrir_dossier »), pour un lead qualifié au téléphone — une simulation, des photos ou une demande de devis venues du site ouvrent déjà le dossier toutes seules. LEAD avec message_id : le lead d'un mail entrant. DEPENSE justificatif : { url | base64 + nom | piece_mail | fichier_id | lien_depot } (forcer : enregistrer malgré un justificatif déjà vu). Photos et PDF : « ajouter_fichier » ensuite.`,
  niveau: "REVERSIBLE",
  schema: schemaCreer,
  sensible: async (e) => {
    try {
      const plan = await planifierCreer(e, { commande: null, maintenant: new Date(), utilisateur: "" });
      return Boolean(plan.definition.creer!.sensible?.(plan.valeurs));
    } catch {
      return false;
    }
  },
  apercu: async (e, contexte) => {
    const r = await avecAmbiguite(() => planifierCreer(e, contexteDe(contexte)));
    return estResultat(r) ? r.texte : r.definition.creer!.apercu(r.valeurs, r.cible, contexteDe(contexte));
  },
  executer: async (e, contexte) => {
    const r = await avecAmbiguite(() => planifierCreer(e, contexteDe(contexte)));
    if (estResultat(r)) return r;
    return r.definition.creer!.executer(r.valeurs, r.cible, contexteDe(contexte));
  },
});

/* ── archiver / restaurer (ex-menage.ts, étendus à toutes les entités) ── */

const element = z.object({ entite: z.enum(ENTITES_ARCHIVABLES), id: z.string().min(1).max(120) });
const schemaArchiver = z.object({
  elements: z.array(element).max(200).optional().describe("Les éléments : [{ entite, id }]."),
  leads: z.array(z.string().max(40)).max(200).optional().describe("Raccourci : identifiants de leads."),
  dossiers: z.array(z.string().max(40)).max(50).optional().describe("Raccourci : identifiants de dossiers."),
  motif: z.string().min(2).max(300).describe("Pourquoi (« doublon », « test », « hors cible », ou une phrase)."),
});
type EntreeArchiver = z.output<typeof schemaArchiver>;

function motifLead(motif: string): (typeof MOTIFS_ARCHIVAGE)[number] {
  const m = motif.toLowerCase();
  if (/doublon/.test(m)) return "DOUBLON";
  if (/test|essai/.test(m)) return "TEST";
  if (/hors|zone|cible|trop loin/.test(m)) return "HORS_CIBLE";
  return "AUTRE";
}

type Vise = { entite: Entite; cible: Resolu; raccourci: boolean; numero?: number };

/** Tous les éléments, résolus avant d'agir : un identifiant inconnu arrête tout, rien n'est fait. */
async function resoudreElements(entree: { elements?: { entite: Entite; id?: string; numero?: number }[]; leads?: string[]; dossiers?: string[] }): Promise<Vise[]> {
  const liste = [
    ...[...new Set(entree.leads ?? [])].map((id) => ({ entite: "LEAD" as Entite, id, raccourci: true, numero: undefined })),
    ...[...new Set(entree.dossiers ?? [])].map((id) => ({ entite: "DOSSIER" as Entite, id, raccourci: true, numero: undefined })),
    ...(entree.elements ?? []).map((e) => ({ ...e, raccourci: false })),
  ];
  if (liste.length === 0) throw new ErreurMetier("Rien à faire : donne des éléments [{ entite, id }] (ou leads, dossiers).", 400);
  const vises: Vise[] = [];
  const inconnus: string[] = [];
  for (const e of liste) {
    try {
      vises.push({ entite: e.entite, cible: await definitionDe(e.entite).resoudre!({ id: e.id }), raccourci: e.raccourci, numero: e.numero });
    } catch (erreur) {
      if (erreur instanceof ErreurMetier && erreur.status === 404) inconnus.push(`${e.entite} ${e.id ?? ""}`.trim());
      else throw erreur;
    }
  }
  if (inconnus.length) throw new ErreurMetier(`${pluriel(inconnus.length, "identifiant inconnu", "identifiants inconnus")} (${inconnus.join(", ")}) : rien n'a été fait.`, 404);
  return vises;
}

/** Retirer ou remettre un tarif (les prix du générateur) ou une règle d'expéditeur (un réglage de la boîte) : sensible, comme les créer ou les modifier. */
const ARCHIVAGE_SENSIBLE: readonly Entite[] = ["TARIF", "REGLE_EXPEDITEUR"];
const archivageSensible = (e: { elements?: { entite: Entite }[] }) => (e.elements ?? []).some((x) => ARCHIVAGE_SENSIBLE.includes(x.entite));

const nomsDe = (vises: Vise[]) => vises.map((v) => `${v.cible.nom}${v.numero ? ` (version ${v.numero})` : ""}`).join(", ");

export const outilArchiver = definirOutil({
  nom: "archiver",
  titre: "Archiver (leads, dossiers, fiches, coordonnées, dépenses, tarifs, règles, simulations)",
  description: `Archive (retire) des éléments avec un motif : rien ne se supprime, « restaurer » les remet. elements: [{ entite, id }] pour ${ENTITES_ARCHIVABLES.join(", ")} ; raccourcis leads / dossiers (identifiants). Un seul lead : motif libre, gardé tel quel ; plusieurs : ramené à un code (doublon, test, hors cible, autre). Un dossier qui porte un document émis, un paiement ou un accord ne s'archive pas (le passer en « Perdu »). Au-delà de trois éléments, ou pour un tarif ou une règle d'expéditeur : aperçu, puis confirmation. Pour « tous sauf X » : liste d'abord (lis toutes les pages), retire X, puis donne les identifiants restants ; dis à Lucas ce que tes listes ne couvraient pas.`,
  niveau: "REVERSIBLE",
  schema: schemaArchiver,
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0) + (e.elements?.length ?? 0),
  sensible: archivageSensible,
  apercu: async (e) => {
    const r = await avecAmbiguite(() => resoudreElements(e));
    return estResultat(r) ? r.texte : `Je vais archiver ${pluriel(r.length, "élément")} : ${nomsDe(r)} — motif « ${e.motif} ». Réversible (« restaurer »).`;
  },
  executer: async (e, contexteOutil) => {
    const r = await avecAmbiguite(() => resoudreElements(e));
    if (estResultat(r)) return r;
    return archiverVises(r, e, contexteDe(contexteOutil));
  },
});

async function archiverVises(vises: Vise[], e: EntreeArchiver, contexte: ContexteEcriture): Promise<ResultatOutil> {
  const faits: string[] = [];
  const refus: string[] = [];
  const avertissements: string[] = [];
  const leads = vises.filter((v) => v.entite === "LEAD");
  if (leads.length === 1 && !leads[0].raccourci) {
    // Un seul lead désigné : le geste de sa fiche (« Archiver le contact »), motif libre.
    if (leads[0].cible.archive) refus.push(`${leads[0].cible.nom} : déjà archivé`);
    else {
      await definitionDe("LEAD").archiver!(leads[0].cible, e.motif, contexte);
      faits.push(`lead ${leads[0].cible.nom}`);
    }
  } else if (leads.length) {
    const { ids } = await appliquerActionLeads({ action: "ARCHIVER", ids: leads.map((l) => l.cible.id), motif: motifLead(e.motif) });
    faits.push(pluriel(ids.length, "lead"));
    if (ids.length < leads.length) refus.push(`${pluriel(leads.length - ids.length, "lead")} déjà archivé${leads.length - ids.length > 1 ? "s" : ""}`);
  }
  for (const v of vises.filter((x) => x.entite !== "LEAD")) {
    if (v.cible.archive) {
      refus.push(`${v.cible.nom} : déjà archivé`);
      continue;
    }
    try {
      const a = v.entite === "DOSSIER" ? await archiverDossier(v.cible.id, e.motif).then(() => []) : await definitionDe(v.entite).archiver!(v.cible, e.motif, contexte);
      if (Array.isArray(a)) avertissements.push(...a);
      faits.push(v.cible.nom);
    } catch (erreur) {
      if (!(erreur instanceof ErreurMetier)) throw erreur;
      refus.push(`${v.cible.nom} : ${erreur.message}`);
    }
  }
  if (faits.length === 0) throw new ErreurMetier(`Rien n'a été archivé. ${refus.join(" ; ")}`, 409);
  return {
    texte: [`Archivé (motif : ${e.motif}) : ${faits.join(", ")}. Rien n'est supprimé : « restaurer » les remet.`, refus.length ? `Pas archivé : ${refus.join(" ; ")}.` : "", avertissements.join(" ")].filter(Boolean).join("\n"),
    donnees: { archives: vises.map((v) => ({ entite: v.entite, id: v.cible.id })), refus },
    liens: [lien("Leads", "/leads")],
  };
}

const elementRestaurer = z.object({ entite: z.enum(ENTITES_RESTAURABLES), id: z.string().min(1).max(120).optional(), numero: z.number().int().min(1).optional().describe("CONSIGNES, POSITIONNEMENT, PROMPT_SIMULATION : la version à remettre.") });

export const outilRestaurer = definirOutil({
  nom: "restaurer",
  titre: "Restaurer des éléments archivés, ou une version d'un texte",
  description: `Remet des éléments archivés, retirés ou mis à la corbeille (inverse d'« archiver » et de « supprimer », tant que l'effacement n'a pas eu lieu) : elements: [{ entite, id }] pour ${ENTITES_RESTAURABLES.filter((c) => REGISTRE_ENTITES[c].restaurer).join(", ")} ; raccourcis leads / dossiers. Remet aussi une VERSION d'un texte : { entite: CONSIGNES | POSITIONNEMENT, numero } ou { entite: PROMPT_SIMULATION, id: le type, numero } — la restauration crée elle-même une version, rien n'est perdu. Les archivés se retrouvent par « lister » (vue ARCHIVES) ou « chercher » (archives: true). Au-delà de trois éléments, ou pour un tarif ou une règle d'expéditeur : aperçu, puis confirmation.`,
  niveau: "REVERSIBLE",
  schema: z.object({ elements: z.array(elementRestaurer).max(200).optional(), leads: z.array(z.string().max(40)).max(200).optional(), dossiers: z.array(z.string().max(40)).max(50).optional() }),
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0) + (e.elements?.length ?? 0),
  sensible: archivageSensible,
  apercu: async (e) => {
    const r = await avecAmbiguite(() => resoudreElements(e));
    return estResultat(r) ? r.texte : `Je vais restaurer ${pluriel(r.length, "élément")} : ${nomsDe(r)}.`;
  },
  executer: async (e, contexteOutil) => {
    const r = await avecAmbiguite(() => resoudreElements(e));
    if (estResultat(r)) return r;
    const contexte = contexteDe(contexteOutil);
    const faits: string[] = [];
    const refus: string[] = [];
    const leads = r.filter((v) => v.entite === "LEAD");
    if (leads.length) {
      const { ids } = await appliquerActionLeads({ action: "RESTAURER", ids: leads.map((l) => l.cible.id) });
      if (ids.length) faits.push(pluriel(ids.length, "lead restauré", "leads restaurés"));
      if (ids.length < leads.length) refus.push(`${pluriel(leads.length - ids.length, "lead")} déjà en place`);
    }
    for (const v of r.filter((x) => x.entite !== "LEAD")) {
      const d = definitionDe(v.entite);
      try {
        if (v.numero !== undefined) {
          if (!d.restaurerVersion) throw new ErreurMetier(`${v.entite} n'a pas de versions.`, 400);
          faits.push((await d.restaurerVersion(v.cible, v.numero, contexte)).replace(/\.$/, ""));
          continue;
        }
        if (!d.restaurer) throw new ErreurMetier(`${v.entite} se restaure par version : donne « numero ».`, 400);
        if (v.entite === "DOSSIER") await restaurerDossier(v.cible.id);
        else await d.restaurer(v.cible, contexte);
        faits.push(v.cible.nom);
      } catch (erreur) {
        if (!(erreur instanceof ErreurMetier)) throw erreur;
        refus.push(`${v.cible.nom} : ${erreur.message}`);
      }
    }
    if (faits.length === 0) throw new ErreurMetier(`Rien n'a été restauré. ${refus.join(" ; ")}`, 409);
    return { texte: [`Restauré : ${faits.join(", ")}.`, refus.length ? `Pas restauré : ${refus.join(" ; ")}.` : ""].filter(Boolean).join("\n"), donnees: { restaures: r.map((v) => ({ entite: v.entite, id: v.cible.id, numero: v.numero ?? null })), refus }, liens: [lien("Leads", "/leads")] };
  },
});

/* ── annuler_modification (ex-actions.ts, étendu à toutes les entités tracées) ── */

const schemaAnnuler = schemaCible.extend({
  modification_id: z.string().max(40).optional().describe("Rendu par « modifier » ; à défaut, la dernière modification de l'entité visée (ou la toute dernière)."),
  entite: z.enum(ENTITES_MODIFIABLES).optional().describe("L'entité dont défaire la dernière modification (DOSSIER par défaut quand un contact est désigné)."),
  id: z.string().max(120).optional().describe("Son identifiant ou sa clé (comme pour « modifier »)."),
});
type EntreeAnnuler = z.output<typeof schemaAnnuler>;

type ModificationDossierVue = NonNullable<Awaited<ReturnType<typeof derniereModification>>>;
type Visee = { genre: "DOSSIER"; modification: ModificationDossierVue } | { genre: "GENERIQUE"; modification: ModificationTracee };

async function dossierParId(id: string): Promise<ModificationDossierVue | null> {
  const m = await prisma.modificationDossier.findUnique({ where: { id } });
  if (!m) return null;
  let changements: ChangementDossier[] = [];
  try {
    changements = JSON.parse(m.champs) as ChangementDossier[];
  } catch {
    changements = [];
  }
  return { id: m.id, dossierId: m.dossierId, le: m.createdAt.toISOString(), par: m.par, commande: m.commande, changements, annuleeLe: m.annuleeLe?.toISOString() ?? null, annuleePar: m.annuleePar };
}

const plusRecente = (a: Visee | null, b: Visee | null): Visee | null => (!a ? b : !b ? a : a.modification.le >= b.modification.le ? a : b);

async function trouverVisee(e: EntreeAnnuler): Promise<Visee | ResultatOutil> {
  if (e.modification_id) {
    const g = await lireModification(e.modification_id);
    if (g) return { genre: "GENERIQUE", modification: g };
    const d = await dossierParId(e.modification_id);
    if (d) return { genre: "DOSSIER", modification: d };
    throw new ErreurMetier("Modification introuvable.", 404);
  }
  const cible: Cible = { dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom };
  const designe = Boolean(e.entite || e.id || cible.dossierId || cible.clientId || cible.leadId || cible.nom?.trim());
  if (!designe) {
    const g = await derniereModificationTracee();
    const dl = await prisma.modificationDossier.findFirst({ where: { annuleeLe: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const visee = plusRecente(g ? { genre: "GENERIQUE", modification: g } : null, dl ? { genre: "DOSSIER", modification: (await dossierParId(dl.id))! } : null);
    if (!visee) return { texte: "Aucune modification de l'assistant à annuler." };
    return visee;
  }
  const code = e.entite ?? "DOSSIER";
  const r = await avecAmbiguite(() => definitionDe(code).resoudre!({ id: e.id, cible }));
  if (estResultat(r)) return r;
  const g = await derniereModificationTracee({ entite: code, enregistrementId: r.id });
  const d = code === "DOSSIER" ? await derniereModification(r.id) : null;
  const visee = plusRecente(g ? { genre: "GENERIQUE", modification: g } : null, d ? { genre: "DOSSIER", modification: d } : null);
  if (!visee) return { texte: `Aucune modification de l'assistant à annuler sur ${r.nom}.` };
  return visee;
}

/** Les valeurs d'avant redeviennent celles d'après : pour l'aperçu et la sensibilité de l'annulation. */
const retours = (changements: Changement[]): Changement[] => changements.map((c) => ({ ...c, avant: c.apres, apres: c.avant, texteAvant: c.texteApres, texteApres: c.texteAvant }));

async function sensibiliteVisee(v: Visee): Promise<boolean> {
  if (v.genre === "DOSSIER") return v.modification.changements.some((c) => CHAMPS_SENSIBLES.includes(c.champ));
  const d = definitionDe(v.modification.entite);
  if (!d.modifier) return false;
  const apres = Object.fromEntries(v.modification.changements.map((c) => [c.cle, c.avant]));
  const avant = Object.fromEntries(v.modification.changements.map((c) => [c.cle, c.apres]));
  const cible = await d.resoudre!({ id: v.modification.enregistrementId }).catch(() => ({ id: v.modification.enregistrementId, nom: v.modification.nom ?? "", archive: false, contexte: {} }) as Resolu);
  return estSensible(d.modifier, apres, avant, cible);
}

export const outilAnnulerModification = definirOutil({
  nom: "annuler_modification",
  titre: "Annuler une modification (toutes les entités)",
  description:
    "Remet chaque champ d'une modification faite par « modifier » (ou l'ancien « modifier_dossier », « changer_teinte ») à sa valeur d'avant, par la même fonction de service. modification_id = celle rendue par « modifier » ; sinon la dernière non annulée de l'entité désignée (entite + id, ou un contact : dossierId, leadId, clientId, nom — DOSSIER par défaut) ; sans rien, la toute dernière. La trace reste, marquée annulée. Défaire ce qui touchait l'argent, un paramètre ou le client est sensible : aperçu, puis confirmation.",
  niveau: "REVERSIBLE",
  schema: schemaAnnuler,
  // Sans modification_id, « la dernière » peut changer entre l'aperçu et la confirmation : le jeton vaut pour celle de l'aperçu.
  portee: async (e) => {
    const v = await trouverVisee(e);
    return "genre" in v ? v.modification.id : null;
  },
  sensible: async (e) => {
    try {
      const v = await trouverVisee(e);
      return "genre" in v ? sensibiliteVisee(v) : false;
    } catch {
      return false;
    }
  },
  apercu: async (e) => {
    const v = await trouverVisee(e);
    if (!("genre" in v)) return v.texte;
    const lignes = v.genre === "DOSSIER" ? v.modification.changements.map((c) => phraseCoeur({ ...c, texteAvant: c.texteApres, texteApres: c.texteAvant })) : retours(v.modification.changements).map(phraseChangement);
    const partielle = v.genre === "GENERIQUE" ? definitionDe(v.modification.entite).modifier?.annulationPartielle?.(v.modification.changements) : null;
    return `Je vais annuler la modification ${v.modification.id} (${format.jourCourt(v.modification.le)}${v.modification.commande ? `, « ${v.modification.commande} »` : ""}) : ${lignes.join(" ; ")}.${partielle ? `\n${partielle}` : ""}`;
  },
  executer: async (e, contexteOutil) => {
    const v = await trouverVisee(e);
    if (!("genre" in v)) return v;
    const contexte = contexteDe(contexteOutil);
    if (v.modification.annuleeLe) throw new ErreurMetier(`Cette modification a déjà été annulée le ${format.jourCourt(v.modification.annuleeLe)}.`, 409);
    if (v.genre === "DOSSIER") {
      const r = await annulerModification(v.modification.id, { commande: contexte.commande });
      return { texte: [`Modification annulée chez ${r.clientNom} : ${r.changements.map(phraseCoeur).join(" ; ")}.`, r.devis?.message ?? "", `(modification ${r.modification.id}, faite le ${format.jourCourt(r.modification.le)}${r.modification.commande ? ` sur « ${r.modification.commande} »` : ""})`].filter(Boolean).join("\n"), donnees: { modification: r.modification, devis: r.devis }, liens: [lien("Dossier", `/dossiers?dossier=${r.modification.dossierId}`)] };
    }
    const m = v.modification;
    const d = definitionDe(m.entite);
    if (!d.modifier) throw new ErreurMetier(`${m.entite} ne se modifie plus par l'assistant : rien n'a été fait.`, 409);
    const bloques = m.changements.filter((c) => d.modifier!.irreversibles?.[c.cle]);
    if (bloques.length) throw new ErreurMetier(bloques.map((c) => d.modifier!.irreversibles![c.cle]).join(" "), 409);
    const cible = await d.resoudre!({ id: m.enregistrementId });
    const valeurs = Object.fromEntries(m.changements.map((c) => [c.cle, c.avant]));
    const avertissements = (await d.modifier.appliquer(cible, valeurs, contexte)) ?? [];
    const annulee = await marquerAnnulee(m.id);
    return {
      texte: [`Modification annulée sur ${cible.nom} : ${retours(m.changements).map(phraseChangement).join(" ; ")}.`, avertissements.join(" "), d.modifier.annulationPartielle?.(m.changements) ?? "", `(modification ${m.id}, faite le ${format.jourCourt(m.le)}${m.commande ? ` sur « ${m.commande} »` : ""})`].filter(Boolean).join("\n"),
      donnees: { modification: annulee },
      liens: cheminDe(d, cible),
    };
  },
});

export const OUTILS_GENERIQUES = [outilCreer, outilModifier, outilAnnulerModification, outilArchiver, outilRestaurer];
