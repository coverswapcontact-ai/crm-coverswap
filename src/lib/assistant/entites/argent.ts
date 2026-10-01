import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateCourte, euros } from "@/lib/commun/format";
import { libelleCategorie } from "@/lib/depenses/constantes";
import { schemaCreationDepense, schemaModificationDepense } from "@/lib/depenses/constantes";
import { archiverDepense, creerDepense, modifierDepense, restaurerDepense } from "@/lib/depenses/service";
import { UNITES } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { modifierDocumentExistant, schemaModificationDocumentExistant } from "@/lib/dossiers/documents-existants";
import { modifierPresentationDevis } from "@/lib/dossiers/presentation-devis";
import { archiverPreset, creerPreset, lirePrestationsDuTarif, modifierPreset, restaurerPreset, schemaPreset } from "@/lib/dossiers/presets";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { schemaCorrectionEncaissement } from "@/lib/encaissements/schemas";
import { crediterCheque, modifierEncaissement } from "@/lib/encaissements/service";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { libelleReperee, repererSousPartie } from "@/lib/prestations/reperage";
import { attribuerTarif, modifierTarifSousPartie, tarifsDesPrestations } from "@/lib/prestations/tarifs";
import { lien } from "../definition";
import { ambiguite, datesDictees, exigerId, type DefinitionEntite, type Resolu, type Valeurs } from "./socle";

/**
 * L'argent et les prix (mission 17, partie C) : document émis (présentation, ou correction d'un document repris),
 * encaissement, dépense, tarif (preset) et tarif d'une sous-partie. Tout est sensible sauf la dépense (réversible,
 * comme à l'écran) ; chaque écriture passe par la fonction de service de la route.
 */

type Objet = z.ZodObject<z.ZodRawShape>;
const objet = (schema: unknown) => schema as Objet;
const jour = (d: Date | null | undefined) => (d ? jourParis(d) : null);

/* ── Document émis ──────────────────────────────────────────────────── */

const CHAMPS_PRESENTATION = ["visibleEspace", "libelleVariante"];
const CHAMPS_REPRIS = ["dateEmission", "montant", "objet", "statut", "acomptePct"];

export const DOCUMENT: DefinitionEntite = {
  code: "DOCUMENT",
  libelle: "le document",
  designation: "id du document (devis, facture ; rendu par « lire_fiche » du dossier)",
  resoudre: async (r) => {
    const id = exigerId(r, "le document", "« lire_fiche » (documents du dossier)");
    const d = await prisma.document.findUnique({ where: { id }, select: { id: true, type: true, numero: true, dossierId: true, origine: true, archiveLe: true, dossier: { select: { clientNom: true } } } });
    if (!d || !d.dossierId) throw new ErreurMetier(`Document introuvable : ${id}.`, 404);
    return { id, nom: `${d.type === "DEVIS" ? "le devis" : d.type === "FACTURE" ? "la facture" : "le document"} ${d.numero ?? "(brouillon)"} de ${d.dossier?.clientNom ?? "?"}`, archive: Boolean(d.archiveLe), contexte: { dossierId: d.dossierId, type: d.type, repris: d.origine === "REPRISE" } };
  },
  chemin: (c) => `/dossiers?dossier=${String(c.contexte.dossierId)}`,
  modifier: {
    schema: objet(schemaModificationDocumentExistant),
    libelles: { dateEmission: "la date d'émission", montant: "le montant", objet: "l'objet", statut: "le statut", acomptePct: "l'acompte (%)", libelleVariante: "le libellé de variante", visibleEspace: "la visibilité dans l'espace client" },
    texte: { visibleEspace: (v) => (v ? "visible" : "masqué"), acomptePct: (v) => (typeof v === "number" ? `${v} %` : "—") },
    // Un document repris qui change touche l'argent ; un devis masqué qui devient visible vaut envoi au client.
    sensible: (apres, avant) => CHAMPS_REPRIS.some((c) => c in apres && JSON.stringify(apres[c]) !== JSON.stringify(avant[c])) || (apres.visibleEspace === true && avant.visibleEspace !== true),
    pretraiter: (e, contexte) => datesDictees(e, ["dateEmission"], contexte.maintenant),
    note: (apres, avant) => (apres.visibleEspace === true && avant.visibleEspace !== true ? "Rendu visible, le devis vaut envoi au client : la main passe au client, le dossier passe en « Devis envoyé » s'il n'y est pas." : null),
    lire: async (cible) => {
      const d = await prisma.document.findUniqueOrThrow({ where: { id: cible.id } });
      return { dateEmission: jour(d.dateEmission), montant: d.totalHt, objet: d.objet, statut: d.statut, acomptePct: d.acomptePct, libelleVariante: d.libelleVariante, visibleEspace: d.visibleEspace };
    },
    appliquer: async (cible, valeurs) => {
      const dossierId = cible.contexte.dossierId as string;
      // Comme la route : { visibleEspace, libelleVariante } seuls = la présentation ; le reste = la correction d'un document repris.
      if (Object.keys(valeurs).every((c) => CHAMPS_PRESENTATION.includes(c))) {
        await modifierPresentationDevis(dossierId, cible.id, valeurs);
        return [];
      }
      return modifierDocumentExistant(dossierId, cible.id, valeurs);
    },
  },
};

/* ── Encaissement ───────────────────────────────────────────────────── */

export const ENCAISSEMENT: DefinitionEntite = {
  code: "ENCAISSEMENT",
  libelle: "le paiement",
  designation: "id de l'encaissement (rendu par « lire_fiche » du dossier, paiements)",
  resoudre: async (r) => {
    const id = exigerId(r, "le paiement", "« lire_fiche » (paiements du dossier)");
    const e = await prisma.encaissement.findUnique({ where: { id }, select: { id: true, montant: true, payeur: true, recuLe: true, dossierId: true, statut: true } });
    if (!e) throw new ErreurMetier(`Encaissement introuvable : ${id}.`, 404);
    return { id, nom: `le paiement de ${euros(e.montant)} (${e.payeur}, reçu le ${dateCourte(e.recuLe)})`, archive: e.statut !== "VALIDE", contexte: { dossierId: e.dossierId } };
  },
  chemin: (c) => (c.contexte.dossierId ? `/dossiers?dossier=${String(c.contexte.dossierId)}` : "/finances"),
  modifier: {
    schema: objet(schemaCorrectionEncaissement),
    libelles: { montant: "le montant", recuLe: "la date de réception", moyen: "le moyen", reference: "la référence", crediteLe: "la date de crédit", payeur: "le payeur", note: "la note" },
    texte: { moyen: (v) => (typeof v === "string" ? LIBELLES_MOYEN[v as MoyenPaiement]?.toLowerCase() ?? v : "—"), payeur: (v) => (typeof v === "string" ? v : "—") },
    sensible: () => true,
    pretraiter: (e, contexte) => datesDictees(e, ["recuLe", "crediteLe"], contexte.maintenant),
    lire: async (cible) => {
      const e = await prisma.encaissement.findUniqueOrThrow({ where: { id: cible.id } });
      return { montant: e.montant, recuLe: jour(e.recuLe), moyen: e.moyen, reference: e.reference, crediteLe: jour(e.crediteLe), payeur: e.payeur, note: e.note };
    },
    appliquer: async (cible, valeurs) => {
      const cles = Object.keys(valeurs);
      // Le bouton « Chèque crédité » : seule la date de crédit, posée sur un chèque qui n'en a pas.
      if (cles.length === 1 && cles[0] === "crediteLe" && typeof valeurs.crediteLe === "string") {
        const e = await prisma.encaissement.findUniqueOrThrow({ where: { id: cible.id }, select: { moyen: true, crediteLe: true } });
        if (e.moyen === "CHEQUE" && !e.crediteLe) {
          await crediterCheque(cible.id, { crediteLe: valeurs.crediteLe });
          return;
        }
      }
      await modifierEncaissement(cible.id, valeurs);
    },
  },
};

/* ── Dépense ────────────────────────────────────────────────────────── */

/**
 * La création d'une dépense accepte son justificatif dans le même geste (« Enregistrer la dépense » de l'écran, champ
 * `justificatif` du formulaire) : une des voies d'« ajouter_fichier », lue puis passée à `creerDepense` comme le fichier
 * du formulaire (même contrôle de doublon ; `forcer` = « Enregistrer quand même »).
 */
const schemaJustificatif = z
  .object({ lienDepot: z.string().max(40).optional(), url: z.string().max(2000).optional(), base64: z.string().max(13_000_000).optional(), nom: z.string().max(200).optional(), pieceMail: z.object({ messageId: z.string().max(40), piece: z.string().max(40) }).optional(), fichierId: z.string().max(40).optional() })
  .refine((j) => [j.lienDepot, j.url, j.base64, j.pieceMail, j.fichierId].filter(Boolean).length === 1, { message: "justificatif : UNE source (lien_depot, url, base64 + nom, piece_mail { message_id, piece }, fichier_id)." });
const schemaCreationDepenseOutil = z
  .object({ ...(schemaCreationDepense as unknown as z.ZodObject<typeof schemaCreationDepense.shape>).shape, justificatif: schemaJustificatif.optional() })
  .refine((e) => !(e.dossierId && e.horsChantier), { message: "Une dépense est rattachée à un chantier ou hors chantier, pas les deux.", path: ["hors_chantier"] });

async function justificatifDe(j: z.output<typeof schemaJustificatif> | undefined): Promise<File | null> {
  if (!j) return null;
  const { lireSourceFichier } = await import("@/lib/fichiers-depot/source");
  const { verifierFichier } = await import("@/lib/fichiers-depot/enregistrement");
  const brut = await lireSourceFichier({ lien_depot: j.lienDepot, url: j.url, base64: j.base64, nom: j.nom, piece_mail: j.pieceMail ? { message_id: j.pieceMail.messageId, piece: j.pieceMail.piece } : undefined, fichier_id: j.fichierId });
  const f = await verifierFichier({ contenu: brut.contenu, nom: brut.nom });
  return new File([new Uint8Array(f.contenu)], f.nom, { type: f.format.typeMime });
}

export const DEPENSE: DefinitionEntite = {
  code: "DEPENSE",
  libelle: "la dépense",
  designation: "id de la dépense (rendu par « lister » DEPENSES)",
  resoudre: async (r) => {
    const id = exigerId(r, "la dépense", "« lister » DEPENSES");
    const d = await prisma.depense.findFirst({ where: { ...AVEC_ARCHIVES, id }, select: { id: true, montant: true, fournisseur: true, payeeLe: true, archiveLe: true } });
    if (!d) throw new ErreurMetier(`Dépense introuvable : ${id}.`, 404);
    return { id, nom: `la dépense du ${dateCourte(d.payeeLe)} (${euros(d.montant)} chez ${d.fournisseur})`, archive: Boolean(d.archiveLe), contexte: {} };
  },
  chemin: () => "/depenses",
  modifier: {
    schema: objet(schemaModificationDepense),
    libelles: { payeeLe: "la date", montant: "le montant", fournisseur: "le fournisseur", categorie: "la catégorie", libelle: "le libellé", moyen: "le moyen", dossierId: "le chantier", horsChantier: "hors chantier", note: "la note" },
    texte: { categorie: (v) => (typeof v === "string" ? libelleCategorie(v).toLowerCase() : "—"), fournisseur: (v) => (typeof v === "string" ? v : "—") },
    pretraiter: (e, contexte) => datesDictees(e, ["payeeLe"], contexte.maintenant),
    lire: async (cible) => {
      const d = await prisma.depense.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, id: cible.id } });
      return { payeeLe: jourParis(d.payeeLe), montant: d.montant, fournisseur: d.fournisseur, categorie: d.categorie, libelle: d.libelle, moyen: d.moyen, dossierId: d.dossierId, horsChantier: d.horsChantier, note: d.note };
    },
    // Le rattachement se donne toujours en entier (chantier ET hors chantier) : le service remet l'autre à zéro, l'annulation doit pouvoir le rendre.
    preparer: async (e, avant) => {
      if (!("dossierId" in e) && !("horsChantier" in e)) return e;
      const dossierId = "dossierId" in e ? ((e.dossierId as string | null) || null) : e.horsChantier ? null : ((avant.dossierId as string | null) ?? null);
      if (dossierId) {
        const d = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true } });
        if (!d) throw new ErreurMetier("Chantier introuvable.", 404);
      }
      return { ...e, dossierId, horsChantier: dossierId ? false : "horsChantier" in e ? Boolean(e.horsChantier) : Boolean(avant.horsChantier) };
    },
    appliquer: async (cible, valeurs) => {
      await modifierDepense(cible.id, valeurs);
    },
  },
  creer: {
    schema: schemaCreationDepenseOutil as unknown as z.ZodType<Valeurs>,
    cible: "FACULTATIVE",
    typeCible: "DOSSIER",
    pretraiter: (e, contexte) => datesDictees({ payeeLe: jourParis(contexte.maintenant), ...e }, ["payeeLe"], contexte.maintenant),
    apercu: async (e, cible) => `Je vais enregistrer une dépense de ${euros(e.montant as number)} chez ${String(e.fournisseur)} (${libelleCategorie(e.categorie as string).toLowerCase()})${cible ? `, rattachée au chantier de ${cible.nom}` : ""}${e.justificatif ? ", avec son justificatif" : ""}.`,
    executer: async (e, cible) => {
      const dossierId = (e.dossierId as string | null | undefined) ?? ((cible?.contexte.dossierId as string | null | undefined) || null);
      if (cible && !dossierId) throw new ErreurMetier(`${cible.nom} n'a pas de dossier : une dépense se rattache à un chantier.`, 409);
      const { justificatif, ...valeurs } = e as z.output<typeof schemaCreationDepenseOutil>;
      const { depense, dejaRecue } = await creerDepense({ ...(valeurs as z.output<typeof schemaCreationDepense>), dossierId }, await justificatifDe(justificatif));
      return {
        texte: `Dépense ${dejaRecue ? "déjà connue" : "enregistrée"} : ${euros(depense.montant)} chez ${depense.fournisseur} (${libelleCategorie(depense.categorie).toLowerCase()})${depense.dossier ? `, rattachée au chantier de ${depense.dossier.clientNom}` : depense.horsChantier ? ", hors chantier" : ", pas encore rattachée"} [depense:${depense.id}].${depense.justificatif ? " Justificatif attaché." : " Le justificatif s'ajoute ici (justificatif) ou ensuite par « ajouter_fichier »."}`,
        donnees: { depenseId: depense.id, depense },
        liens: [lien("Dépenses", "/depenses")],
      };
    },
  },
  archiver: async (cible, motif) => archiverDepense(cible.id, motif),
  restaurer: async (cible) => restaurerDepense(cible.id),
};

/* ── Tarif (preset du générateur) ───────────────────────────────────── */

async function resoudreTarif(r: { id?: string | null }): Promise<Resolu> {
  const texte = exigerId(r, "le tarif", "« lister » TARIFS (identifiant, ou des mots de sa désignation)");
  const direct = await prisma.presetTarif.findUnique({ where: { id: texte } });
  const trouves = direct ? [direct] : await prisma.presetTarif.findMany({ where: { designation: { contains: texte } }, orderBy: [{ actif: "desc" }, { ordre: "asc" }], take: 6 });
  if (trouves.length === 0) throw new ErreurMetier(`Tarif introuvable : « ${texte} ».`, 404);
  if (trouves.length > 1) throw ambiguite(trouves.map((p) => ({ id: p.id, nom: p.designation, detail: `${p.prixUnitaire === null ? "prix à saisir" : euros(p.prixUnitaire)} / ${p.unite}${p.actif ? "" : ", retiré"}` })), "tarifs");
  const p = trouves[0];
  return { id: p.id, nom: `le tarif « ${p.designation} »`, archive: !p.actif, contexte: {} };
}

export const TARIF: DefinitionEntite = {
  code: "TARIF",
  libelle: "le tarif",
  designation: "id du tarif (preset), ou des mots de sa désignation",
  resoudre: resoudreTarif,
  chemin: () => "/dossiers",
  modifier: {
    schema: objet(schemaPreset.partial()),
    libelles: { designation: "la désignation", unite: "l'unité", prixUnitaire: "le prix unitaire" },
    sensible: () => true,
    note: async (_apres, _avant, cible) => {
      const p = await prisma.presetTarif.findUniqueOrThrow({ where: { id: cible.id }, select: { prestations: true } });
      const cles = lirePrestationsDuTarif(p.prestations);
      return `${cles.length ? `Ce tarif chiffre : ${cles.join(", ")}. ` : ""}Les devis déjà émis ne changent pas.`;
    },
    lire: async (cible) => {
      const p = await prisma.presetTarif.findUniqueOrThrow({ where: { id: cible.id } });
      return { designation: p.designation, unite: p.unite, prixUnitaire: p.prixUnitaire };
    },
    appliquer: async (cible, valeurs) => {
      await modifierPreset(cible.id, valeurs);
    },
  },
  creer: {
    schema: schemaPreset.extend({ attribuerA: z.string().min(1).max(60).optional().describe("La sous-partie que ce tarif chiffre (« ilot », « SDB.plan-vasque »).") }) as unknown as z.ZodType<Valeurs>,
    sensible: () => true,
    apercu: async (e) => `Je vais créer le tarif « ${String(e.designation)} » : ${e.prixUnitaire === null ? "prix à saisir" : euros(e.prixUnitaire as number)} / ${String(e.unite)}${e.attribuerA ? `, attribué à « ${String(e.attribuerA)} »` : ""}. Les devis déjà émis ne changent pas.`,
    executer: async (e) => {
      const { attribuerA, ...preset } = e;
      let cle: string | null = null;
      if (typeof attribuerA === "string") {
        const r = repererSousPartie(attribuerA);
        if ("candidats" in r) throw new ErreurMetier(`« ${attribuerA} » existe dans plusieurs familles : précise laquelle (${r.candidats.map(libelleReperee).join(" ; ")}).`, 400);
        if ("aucune" in r) throw new ErreurMetier(`« ${attribuerA} » n'est pas une sous-partie connue.`, 400);
        cle = r.trouvee.cle;
      }
      const cree = await creerPreset(preset as z.output<typeof schemaPreset>);
      if (cle) await attribuerTarif(cle, cree.id);
      return { texte: `Tarif créé : « ${cree.designation} », ${cree.prixUnitaire === null ? "prix à saisir" : euros(cree.prixUnitaire)} / ${cree.unite}${cle ? `, attribué à ${cle}` : ""} [tarif:${cree.id}].`, donnees: { tarif: cree }, liens: [lien("Dossiers → Tarifs", "/dossiers")] };
    },
  },
  archiver: async (cible) => archiverPreset(cible.id),
  restaurer: async (cible) => {
    await restaurerPreset(cible.id);
  },
};

/* ── Tarif d'une sous-partie ────────────────────────────────────────── */

async function ligneDe(cle: string) {
  const ligne = (await tarifsDesPrestations()).find((l) => l.cle === cle);
  if (!ligne) throw new ErreurMetier("Sous-partie sans ligne de tarif.", 500);
  return ligne;
}

export const SOUS_PARTIE: DefinitionEntite = {
  code: "SOUS_PARTIE",
  libelle: "le tarif de la sous-partie",
  designation: "la sous-partie en mots ou par sa clé (« ilot », « SDB.plan-vasque »)",
  resoudre: async (r) => {
    const texte = exigerId(r, "la sous-partie", "« lister » TARIFS (« ilot », « SDB.plan-vasque »)");
    const trouve = repererSousPartie(texte);
    if ("candidats" in trouve) throw ambiguite(trouve.candidats.map((c) => ({ id: c.cle, nom: libelleReperee(c) })), "sous-parties");
    if ("aucune" in trouve) throw new ErreurMetier(`« ${texte} » n'est pas une sous-partie connue. Possibles : ${trouve.proposees.map((p) => `${p.famille.libelle} › ${p.sousPartie.libelle}`).join(", ")}.`, 404);
    return { id: trouve.trouvee.cle, nom: `${trouve.trouvee.famille.libelle} › ${trouve.trouvee.sousPartie.libelle}`, archive: false, contexte: {} };
  },
  chemin: () => "/dossiers",
  modifier: {
    schema: objet(z.object({ prixUnitaire: z.number().min(0).max(1_000_000).nullable(), unite: z.enum(UNITES), designation: z.string().trim().min(1).max(200), presetId: z.string().max(40).nullable() }).partial()),
    libelles: { prixUnitaire: "le prix unitaire", unite: "l'unité", designation: "la désignation du tarif", presetId: "le tarif attribué" },
    texte: { presetId: (v) => (typeof v === "string" ? `le tarif ${v}` : "automatique (par mots-clés)") },
    sensible: () => true,
    note: async (_apres, _avant, cible) => {
      const l = await ligneDe(cible.id);
      const partagees = l.presetId ? (await tarifsDesPrestations()).filter((x) => x.presetId === l.presetId && x.cle !== l.cle) : [];
      const tarif = l.presetId ? `Tarif concerné : « ${l.designation} » (${l.unite})${l.explicite ? "" : ", trouvé par mots-clés : il sera attribué à cette sous-partie"}. ` : `Aucun tarif encore : un nouveau tarif « Revêtement adhésif — ${l.libelle.toLowerCase()} » sera créé et attribué à cette sous-partie. `;
      return `${tarif}${partagees.length ? `Ce tarif sert aussi à : ${partagees.map((p) => `${p.familleLibelle} › ${p.libelle}`).join(", ")} — leur prix changera aussi. ` : ""}Les devis déjà émis ne changent pas.`;
    },
    lire: async (cible) => {
      const l = await ligneDe(cible.id);
      return { prixUnitaire: l.prixUnitaire, unite: l.unite, designation: l.designation, presetId: l.explicite ? l.presetId : null };
    },
    appliquer: async (cible, valeurs) => {
      if ("presetId" in valeurs) await attribuerTarif(cible.id, (valeurs.presetId as string | null) ?? null);
      const { prixUnitaire, unite, designation } = valeurs as { prixUnitaire?: number | null; unite?: (typeof UNITES)[number]; designation?: string };
      if (prixUnitaire === undefined && unite === undefined && designation === undefined) return;
      if (typeof prixUnitaire === "number") {
        await modifierTarifSousPartie(cible.id, { prixUnitaire, unite, designation });
        return;
      }
      const l = await ligneDe(cible.id);
      if (!l.presetId) throw new ErreurMetier("Cette sous-partie n'a pas de tarif : donne son prix unitaire pour en créer un.", 409);
      await modifierPreset(l.presetId, { ...(prixUnitaire === null ? { prixUnitaire: null } : {}), ...(unite ? { unite } : {}), ...(designation ? { designation } : {}) });
    },
  },
};

export const ENTITES_ARGENT = [DOCUMENT, ENCAISSEMENT, DEPENSE, TARIF, SOUS_PARTIE];
