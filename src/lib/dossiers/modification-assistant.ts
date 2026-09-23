import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { devaliderProjet } from "@/lib/espace/validations";
import { lireProjet, projetComplet, projetDepuisEntree, resumerProjet, type ProjetClient } from "@/lib/espace/projet";
import { resoudreContexte } from "@/lib/journal/acteur";
import { enregistrerPrestations } from "@/lib/prestations/dossier";
import { famille, IDS_FAMILLE, libelleTaille, lireSelection, lireTeintes, memeSelection, normaliserSelection, resumerSelection, sousPartieDeCle, type SelectionPrestations, type TaillesProjet } from "@/lib/prestations/prestations";
import { libelleReperee, repererFamille, repererSousPartie } from "@/lib/prestations/reperage";
import { estJourValide } from "./dates";
import { modifierDossier, type EntreeModification } from "./dossiers";
import { recalculerMain } from "./main";

/**
 * Modifier un dossier à la voix (mission 10) : UN outil, plusieurs champs —
 * objet, budget annoncé, dates (souhaitée, pose, fin), adresse, coordonnées,
 * prochaine action, familles et sous-parties, teintes par sous-partie,
 * dimensions et mot du projet (l'espace). Chaque changement passe par le code
 * existant du CRM (`modifierDossier`, `enregistrerPrestations`, le projet de
 * l'espace) — mêmes règles, mêmes événements — et laisse une trace lisible
 * `ModificationDossier` avec la valeur d'avant : « annuler_modification » la
 * remet par le même chemin. Un devis émis que la modification rend faux est
 * signalé, jamais touché (un document émis est figé).
 */

export const CHAMPS_MODIFIABLES = ["objet", "montant_estime", "date_souhaitee", "date_chantier", "date_fin_chantier", "adresse", "email", "telephone", "prochaine_action", "prochaine_action_date", "familles", "teintes", "dimensions", "notes_projet"] as const;
export type ChampModifiable = (typeof CHAMPS_MODIFIABLES)[number];

export const LIBELLES_CHAMP: Record<ChampModifiable, string> = {
  objet: "objet du dossier",
  montant_estime: "budget annoncé",
  date_souhaitee: "date souhaitée par le client",
  date_chantier: "date de pose",
  date_fin_chantier: "fin du chantier",
  adresse: "adresse du chantier",
  email: "e-mail",
  telephone: "téléphone",
  prochaine_action: "prochaine action",
  prochaine_action_date: "date de la prochaine action",
  familles: "familles et sous-parties",
  teintes: "teintes par sous-partie",
  dimensions: "dimensions",
  notes_projet: "mot du projet",
};

/** Ce qui engage de l'argent ou une date de chantier, ou change où l'on va : aperçu et confirmation. */
export const CHAMPS_SENSIBLES: readonly ChampModifiable[] = ["montant_estime", "date_chantier", "date_fin_chantier", "adresse"];
/** Un devis émis ne correspond plus si l'un de ces champs change. */
const CHAMPS_DEVIS: readonly ChampModifiable[] = ["objet", "montant_estime", "familles", "teintes", "dimensions"];

export type Adresse = { adresse: string; code_postal: string; ville: string };
export type ValeursDossier = {
  objet: string;
  montant_estime: number | null;
  date_souhaitee: string | null;
  date_chantier: string | null;
  date_fin_chantier: string | null;
  adresse: Adresse;
  email: string | null;
  telephone: string;
  prochaine_action: string | null;
  prochaine_action_date: string | null;
  familles: SelectionPrestations;
  teintes: Record<string, string>;
  dimensions: TaillesProjet;
  notes_projet: string;
};

export type Changement = { champ: ChampModifiable; libelle: string; avant: unknown; apres: unknown; texteAvant: string; texteApres: string };
export type DevisImpacte = { id: string; numero: string; statut: string; message: string };
export type ModificationVue = { id: string; dossierId: string; le: string; par: string; commande: string | null; changements: Changement[]; annuleeLe: string | null; annuleePar: string | null };

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.").refine(estJourValide, "Date invalide.");
const texte = (max: number) => z.string().trim().max(max);

/** Ce que l'assistant envoie : chaque champ est facultatif ; seuls ceux donnés changent. */
export const schemaModificationAssistant = z.object({
  objet: texte(160).min(1).optional(),
  montant_estime: z.number().min(0).max(10_000_000).nullable().optional(),
  date_souhaitee: jour.nullable().optional(),
  date_chantier: jour.nullable().optional(),
  date_fin_chantier: jour.nullable().optional(),
  adresse: z.object({ adresse: texte(200).optional(), code_postal: texte(10).optional(), ville: texte(80).optional() }).optional(),
  email: z.email().max(160).nullable().optional(),
  telephone: texte(30).min(6).optional(),
  prochaine_action: texte(140).nullable().optional(),
  prochaine_action_date: jour.nullable().optional(),
  /** Toute la sélection, famille par famille (ids ou libellés) : remplace l'existante. */
  familles: z.record(z.string().max(40), z.array(z.string().max(60)).max(12)).optional(),
  /** Sous-parties à cocher ou décocher (« ilot », « SDB.plan-vasque », « plan vasque »), sans toucher au reste. */
  ajouter_sous_parties: z.array(z.string().min(1).max(60)).max(12).optional(),
  retirer_sous_parties: z.array(z.string().min(1).max(60)).max(12).optional(),
  /** Teinte par sous-partie, en mots (« chêne », « café latte ») ; null retire la teinte. */
  teintes: z.record(z.string().min(1).max(60), z.string().trim().max(80).nullable()).optional(),
  /** Taille par famille : { CUISINE: { valeur: 5 } }, { MEUBLES: { valeur: 6 } }, repère (« en-l », « en-u », « ilot ») possible. */
  dimensions: z.record(z.string().max(40), z.object({ valeur: z.number().min(0).max(100).nullable().optional(), repere: z.string().max(40).nullable().optional() })).optional(),
  notes_projet: texte(1000).nullable().optional(),
});
export type EntreeModificationAssistant = z.output<typeof schemaModificationAssistant>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const euros = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const jourLong = (j: string | null) => (j ? new Date(`${j}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : "—");
const libelleCle = (cle: string) => {
  const t = sousPartieDeCle(cle);
  return t ? `${t.famille.libelle} › ${t.sousPartie.libelle}` : cle;
};

/** Une valeur en mots, pour l'aperçu, l'événement et l'annulation. */
export function texteValeur(champ: ChampModifiable, valeur: unknown): string {
  switch (champ) {
    case "montant_estime":
      return typeof valeur === "number" ? euros(valeur) : "—";
    case "date_souhaitee":
    case "date_chantier":
    case "date_fin_chantier":
    case "prochaine_action_date":
      return jourLong(typeof valeur === "string" ? valeur : null);
    case "adresse": {
      const a = (valeur ?? {}) as Partial<Adresse>;
      return [a.adresse, [a.code_postal, a.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—";
    }
    case "familles":
      return resumerSelection((valeur ?? {}) as SelectionPrestations) || "aucune";
    case "teintes": {
      const t = (valeur ?? {}) as Record<string, string>;
      const lignes = Object.entries(t).map(([cle, v]) => `${libelleCle(cle)} : ${v}`);
      return lignes.length ? lignes.join(" · ") : "aucune";
    }
    case "dimensions": {
      const d = (valeur ?? {}) as TaillesProjet;
      const lignes = IDS_FAMILLE.filter((id) => d[id]).map((id) => `${famille(id).libelle} ${libelleTaille(id, d[id]) ?? "?"}`);
      return lignes.length ? lignes.join(" · ") : "aucune";
    }
    default:
      return typeof valeur === "string" && valeur.trim() ? valeur : "—";
  }
}

type Lecture = { valeurs: ValeursDossier; espace: { id: string; souhaits: string | null; projetValideLe: Date | null } | null; typeProjet: string | null; clientNom: string; projet: ProjetClient | null };

export async function lireValeurs(dossierId: string): Promise<Lecture> {
  const d = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { id: true, archiveLe: true, clientNom: true, objet: true, montantEstime: true, dateSouhaitee: true, dateChantier: true, dateFinChantier: true, clientAdresse: true, clientCp: true, clientVille: true, clientEmail: true, clientTelephone: true, prochaineAction: true, prochaineActionDate: true, prestations: true, teintes: true, lead: { select: { typeProjet: true } }, espaces: { where: { archiveLe: null }, take: 1, select: { id: true, souhaits: true, projetValideLe: true } } },
  });
  if (!d || d.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const selection = lireSelection(d.prestations);
  const espace = d.espaces[0] ?? null;
  const projet = lireProjet(espace?.souhaits, selection, d.lead?.typeProjet);
  return {
    valeurs: {
      objet: d.objet,
      montant_estime: d.montantEstime,
      date_souhaitee: iso(d.dateSouhaitee),
      date_chantier: iso(d.dateChantier),
      date_fin_chantier: iso(d.dateFinChantier),
      adresse: { adresse: d.clientAdresse, code_postal: d.clientCp, ville: d.clientVille },
      email: d.clientEmail,
      telephone: d.clientTelephone,
      prochaine_action: d.prochaineAction,
      prochaine_action_date: iso(d.prochaineActionDate),
      familles: selection,
      teintes: lireTeintes(d.teintes),
      dimensions: projet?.tailles ?? {},
      notes_projet: projet?.precisions ?? "",
    },
    espace,
    typeProjet: d.lead?.typeProjet ?? null,
    clientNom: d.clientNom,
    projet,
  };
}

const memeValeur = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** L'entrée de l'assistant → les valeurs d'après, champ par champ (celles qui changent seulement). */
export function calculerChangements(entree: EntreeModificationAssistant, lecture: Lecture): Changement[] {
  const avant = lecture.valeurs;
  const apres: Partial<ValeursDossier> = {};
  if (entree.objet !== undefined) apres.objet = entree.objet;
  if (entree.montant_estime !== undefined) apres.montant_estime = entree.montant_estime === null ? null : Math.round(entree.montant_estime * 100) / 100;
  if (entree.date_souhaitee !== undefined) apres.date_souhaitee = entree.date_souhaitee;
  if (entree.date_chantier !== undefined) apres.date_chantier = entree.date_chantier;
  if (entree.date_fin_chantier !== undefined) apres.date_fin_chantier = entree.date_fin_chantier;
  if (entree.adresse) apres.adresse = { adresse: entree.adresse.adresse ?? avant.adresse.adresse, code_postal: entree.adresse.code_postal ?? avant.adresse.code_postal, ville: entree.adresse.ville ?? avant.adresse.ville };
  if (entree.email !== undefined) apres.email = entree.email ? entree.email.toLowerCase() : null;
  if (entree.telephone !== undefined) apres.telephone = entree.telephone;
  if (entree.prochaine_action !== undefined) apres.prochaine_action = entree.prochaine_action || null;
  if (entree.prochaine_action_date !== undefined) apres.prochaine_action_date = entree.prochaine_action_date;

  // Familles : toute la sélection, ou des sous-parties à cocher / décocher.
  let selection: SelectionPrestations | null = null;
  if (entree.familles) {
    const brut: Record<string, string[]> = {};
    for (const [nomFamille, parties] of Object.entries(entree.familles)) {
      const f = repererFamille(nomFamille);
      if (!f) throw new ErreurMetier(`Famille inconnue : « ${nomFamille} » (attendu : Cuisine, Salle de bain, Mobilier, Professionnel).`, 400);
      brut[f.id] = parties.map((p) => {
        const r = repererSousPartie(p, { famille: f.id });
        if ("trouvee" in r) return r.trouvee.sousPartie.id;
        throw new ErreurMetier(`« ${p} » n'est pas une sous-partie de ${f.libelle}. Sous-parties possibles : ${f.sousParties.map((sp) => sp.libelle).join(", ")}.`, 400);
      });
    }
    selection = normaliserSelection(brut);
  }
  if (entree.ajouter_sous_parties?.length || entree.retirer_sous_parties?.length) {
    const courante: Record<string, string[]> = Object.fromEntries(Object.entries(selection ?? avant.familles).map(([k, v]) => [k, [...(v ?? [])]]));
    for (const [refs, ajout] of [[entree.ajouter_sous_parties ?? [], true], [entree.retirer_sous_parties ?? [], false]] as const) {
      for (const ref of refs) {
        const r = repererSousPartie(ref, { selection: courante });
        if ("candidats" in r) throw new ErreurMetier(`« ${ref} » existe dans plusieurs familles : précise laquelle (${r.candidats.map(libelleReperee).join(" ; ")}).`, 400);
        if ("aucune" in r) throw new ErreurMetier(`« ${ref} » n'est pas une sous-partie connue. Possibles : ${r.proposees.map((p) => `${p.famille.libelle} › ${p.sousPartie.libelle}`).join(", ")}.`, 400);
        const { famille: f, sousPartie } = r.trouvee;
        const liste = courante[f.id] ?? [];
        if (ajout) courante[f.id] = liste.includes(sousPartie.id) ? liste : [...liste, sousPartie.id];
        else if (liste.includes(sousPartie.id)) courante[f.id] = liste.filter((x) => x !== sousPartie.id);
      }
    }
    selection = normaliserSelection(courante);
  }
  if (selection && !memeSelection(selection, avant.familles)) apres.familles = selection;
  const selectionApres = apres.familles ?? avant.familles;

  if (entree.teintes) {
    const t = { ...avant.teintes };
    for (const [ref, valeur] of Object.entries(entree.teintes)) {
      const r = repererSousPartie(ref, { selection: selectionApres });
      if ("candidats" in r) throw new ErreurMetier(`« ${ref} » existe dans plusieurs familles : précise laquelle (${r.candidats.map(libelleReperee).join(" ; ")}).`, 400);
      if ("aucune" in r) throw new ErreurMetier(`« ${ref} » n'est pas une sous-partie connue. Possibles : ${r.proposees.map((p) => `${p.famille.libelle} › ${p.sousPartie.libelle}`).join(", ")}.`, 400);
      if (valeur === null || !valeur.trim()) delete t[r.trouvee.cle];
      else t[r.trouvee.cle] = valeur.trim();
    }
    apres.teintes = t;
  }
  if (entree.dimensions) {
    const d: TaillesProjet = { ...avant.dimensions };
    for (const [nomFamille, taille] of Object.entries(entree.dimensions)) {
      const f = repererFamille(nomFamille);
      if (!f) throw new ErreurMetier(`Famille inconnue pour la dimension : « ${nomFamille} ».`, 400);
      if (!(f.id in selectionApres)) throw new ErreurMetier(`${f.libelle} n'est pas cochée sur ce dossier : ajoute d'abord la famille (paramètre « ajouter_sous_parties » ou « familles »).`, 409);
      const repere = taille.repere ? (f.taille.reperes.find((r) => r.id === taille.repere || r.libelle.toLowerCase() === taille.repere!.toLowerCase())?.id ?? null) : null;
      if (taille.repere && !repere) throw new ErreurMetier(`Repère inconnu pour ${f.libelle} : ${f.taille.reperes.map((r) => `« ${r.id} » (${r.libelle})`).join(", ")}.`, 400);
      const valeur = taille.valeur ?? null;
      if (!valeur && !repere) delete d[f.id];
      else d[f.id] = { repere, valeur };
    }
    apres.dimensions = d;
  }
  if (entree.notes_projet !== undefined) apres.notes_projet = entree.notes_projet ?? "";

  return (Object.keys(apres) as ChampModifiable[])
    .filter((champ) => !memeValeur(apres[champ], avant[champ]))
    .map((champ) => ({ champ, libelle: LIBELLES_CHAMP[champ], avant: avant[champ] ?? null, apres: apres[champ] ?? null, texteAvant: texteValeur(champ, avant[champ]), texteApres: texteValeur(champ, apres[champ]) }));
}

/** Le devis en vigueur (émis, envoyé ou signé) que ces changements rendent faux, s'il y en a un. */
export async function devisImpacte(dossierId: string, changements: Changement[]): Promise<DevisImpacte | null> {
  if (!changements.some((c) => CHAMPS_DEVIS.includes(c.champ))) return null;
  const devis = await prisma.document.findFirst({ where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: [{ dateEmission: "desc" }, { createdAt: "desc" }], select: { id: true, numero: true, statut: true } });
  if (!devis) return null;
  const message = devis.statut === "ACCEPTE" ? `Le devis ${devis.numero} est SIGNÉ et ne correspond plus : à voir avec le client (avenant ou nouveau devis).` : `Le devis ${devis.numero} ne correspond plus : à régénérer.`;
  return { id: devis.id, numero: devis.numero!, statut: devis.statut, message };
}

/** Applique des valeurs par le code du CRM (jamais un accès direct à ce que le CRM sait modifier). */
async function appliquerValeurs(dossierId: string, valeurs: Partial<ValeursDossier>, lecture: Lecture, motif: string): Promise<void> {
  const entree: EntreeModification = {};
  if (valeurs.objet !== undefined) entree.objet = valeurs.objet;
  if (valeurs.montant_estime !== undefined) entree.montantEstime = valeurs.montant_estime;
  if (valeurs.adresse) Object.assign(entree, { clientAdresse: valeurs.adresse.adresse, clientCp: valeurs.adresse.code_postal, clientVille: valeurs.adresse.ville });
  if (valeurs.email !== undefined) entree.clientEmail = valeurs.email;
  if (valeurs.telephone !== undefined) entree.clientTelephone = valeurs.telephone;
  if (valeurs.prochaine_action !== undefined) entree.prochaineAction = valeurs.prochaine_action;
  if (valeurs.prochaine_action_date !== undefined) entree.prochaineActionDate = valeurs.prochaine_action_date;
  if (valeurs.date_chantier !== undefined) entree.dateChantier = valeurs.date_chantier;
  if (Object.keys(entree).length) await modifierDossier(dossierId, entree);

  const direct: { dateSouhaitee?: Date | null; dateFinChantier?: Date | null; teintes?: string | null } = {};
  if (valeurs.date_souhaitee !== undefined) direct.dateSouhaitee = valeurs.date_souhaitee ? new Date(`${valeurs.date_souhaitee}T12:00:00.000Z`) : null;
  if (valeurs.date_fin_chantier !== undefined) direct.dateFinChantier = valeurs.date_fin_chantier ? new Date(`${valeurs.date_fin_chantier}T12:00:00.000Z`) : null;
  if (valeurs.teintes !== undefined) direct.teintes = Object.keys(valeurs.teintes).length ? JSON.stringify(valeurs.teintes) : null;
  if (Object.keys(direct).length) await prisma.dossier.update({ where: { id: dossierId }, data: direct });

  if (valeurs.familles !== undefined) await enregistrerPrestations(dossierId, valeurs.familles, "LUCAS");

  if (valeurs.dimensions !== undefined || valeurs.notes_projet !== undefined) {
    const espace = lecture.espace;
    if (!espace) throw new ErreurMetier("Les dimensions et le mot du projet vivent dans l'espace client, que ce dossier n'a pas encore : ouvre-le d'abord (outil « lien_espace »).", 409);
    const selection = valeurs.familles ?? lecture.valeurs.familles;
    const { souhaits } = projetDepuisEntree({ familles: selection, tailles: valeurs.dimensions ?? lecture.valeurs.dimensions, precisions: valeurs.notes_projet ?? lecture.valeurs.notes_projet }, lecture.projet, lecture.typeProjet);
    const apres = lireProjet(JSON.stringify(souhaits), selection, lecture.typeProjet);
    const espaceEntier = await prisma.espaceClient.findUniqueOrThrow({ where: { id: espace.id } });
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: JSON.stringify(souhaits), souhaitsLe: new Date() } });
    await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_SOUHAITS", direction: "INTERNE", contenu: `Projet modifié par Lucas (${motif}) : ${resumerProjet(apres) || "vidé"}`.slice(0, 1500), metadata: JSON.stringify({ auteur: "LUCAS", avant: lecture.projet }) } });
    if (espaceEntier.projetValideLe && projetComplet(apres)) await devaliderProjet(espaceEntier, "LUCAS", "il n'est plus complet");
  }
}

const versVue = (m: { id: string; dossierId: string; createdAt: Date; par: string; commande: string | null; champs: string; annuleeLe: Date | null; annuleePar: string | null }): ModificationVue => ({
  id: m.id,
  dossierId: m.dossierId,
  le: m.createdAt.toISOString(),
  par: m.par,
  commande: m.commande,
  changements: (() => {
    try {
      return JSON.parse(m.champs) as Changement[];
    } catch {
      return [];
    }
  })(),
  annuleeLe: m.annuleeLe?.toISOString() ?? null,
  annuleePar: m.annuleePar,
});

export type ResultatModification = { modification: ModificationVue | null; changements: Changement[]; devis: DevisImpacte | null; clientNom: string };

/** Modifie, trace, recalcule la main, signale le devis. Rien à changer : rend la liste vide, sans trace. */
export async function modifierDossierAssistant(dossierId: string, entree: EntreeModificationAssistant, options: { commande?: string | null } = {}): Promise<ResultatModification> {
  const lecture = await lireValeurs(dossierId);
  const changements = calculerChangements(entree, lecture);
  if (changements.length === 0) return { modification: null, changements, devis: null, clientNom: lecture.clientNom };
  const devis = await devisImpacte(dossierId, changements);
  const { acteur } = await resoudreContexte();
  const valeurs = Object.fromEntries(changements.map((c) => [c.champ, c.apres])) as Partial<ValeursDossier>;
  await appliquerValeurs(dossierId, valeurs, lecture, options.commande ? `« ${options.commande.slice(0, 120)} »` : "assistant");
  const modification = await prisma.modificationDossier.create({ data: { dossierId, champs: JSON.stringify(changements), par: acteur, commande: options.commande?.slice(0, 500) ?? null } });
  const resume = changements.map((c) => `${c.libelle} : ${c.texteAvant} → ${c.texteApres}`).join(" · ");
  await prisma.dossierEvenement.create({ data: { dossierId, type: "DOSSIER_MODIFIE", direction: "INTERNE", contenu: `${resume}${options.commande ? ` — « ${options.commande.slice(0, 160)} »` : ""}${devis ? ` — ${devis.message}` : ""}`.slice(0, 1500), metadata: JSON.stringify({ modificationId: modification.id, champs: changements.map((c) => c.champ), devisId: devis?.id ?? null }) } });
  await recalculerMain(dossierId);
  return { modification: versVue(modification), changements, devis, clientNom: lecture.clientNom };
}

export async function derniereModification(dossierId: string): Promise<ModificationVue | null> {
  const m = await prisma.modificationDossier.findFirst({ where: { dossierId, annuleeLe: null }, orderBy: { createdAt: "desc" } });
  return m ? versVue(m) : null;
}

export async function listerModifications(dossierId: string, limite = 10): Promise<ModificationVue[]> {
  return (await prisma.modificationDossier.findMany({ where: { dossierId }, orderBy: { createdAt: "desc" }, take: limite })).map(versVue);
}

/** Remet chaque champ à sa valeur d'avant, par le même chemin ; la modification est marquée annulée (jamais effacée). */
export async function annulerModification(modificationId: string, options: { commande?: string | null } = {}): Promise<ResultatModification & { modification: ModificationVue }> {
  const m = await prisma.modificationDossier.findUnique({ where: { id: modificationId } });
  if (!m) throw new ErreurMetier("Modification introuvable.", 404);
  if (m.annuleeLe) throw new ErreurMetier(`Cette modification a déjà été annulée le ${m.annuleeLe.toLocaleDateString("fr-FR")}.`, 409);
  const vue = versVue(m);
  const lecture = await lireValeurs(m.dossierId);
  // Retour : la valeur d'avant redevient la valeur d'après.
  const retours: Changement[] = vue.changements.map((c) => ({ champ: c.champ, libelle: c.libelle, avant: c.apres, apres: c.avant, texteAvant: c.texteApres, texteApres: c.texteAvant }));
  const valeurs = Object.fromEntries(retours.map((c) => [c.champ, c.apres])) as Partial<ValeursDossier>;
  await appliquerValeurs(m.dossierId, valeurs, lecture, "annulation");
  const { acteur } = await resoudreContexte();
  const annulee = await prisma.modificationDossier.update({ where: { id: m.id }, data: { annuleeLe: new Date(), annuleePar: acteur } });
  const devis = await devisImpacte(m.dossierId, retours);
  await prisma.dossierEvenement.create({ data: { dossierId: m.dossierId, type: "DOSSIER_MODIFIE", direction: "INTERNE", contenu: `Modification annulée : ${retours.map((c) => `${c.libelle} : ${c.texteAvant} → ${c.texteApres}`).join(" · ")}${options.commande ? ` — « ${options.commande.slice(0, 160)} »` : ""}`.slice(0, 1500), metadata: JSON.stringify({ modificationId: m.id, annulation: true }) } });
  await recalculerMain(m.dossierId);
  return { modification: versVue(annulee), changements: retours, devis, clientNom: lecture.clientNom };
}
