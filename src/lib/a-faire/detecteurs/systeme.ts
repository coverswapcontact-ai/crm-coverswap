import path from "node:path";
import prisma from "@/lib/prisma";
import { pluriel } from "@/lib/commun/format";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { ADRESSE_SYSTEME } from "@/lib/parametres/sections";
import { travauxPeriodiques } from "@/lib/taches/registre";
import { jourMois, PREFIXE_COCHE } from "../achevement";
import type { Detection, NiveauTache, Raccourci } from "../types";
import { court, depuisDe, reconduite, tachesOuvertesDe } from "./ouvertes";
import { cleTache, type Achevement, type ContexteDetection, type Detecteur } from "./types";

/**
 * Mission 17 (partie A, lot 2) : détecteur SYSTEME — ce qui bloque le CRM et que Lucas seul peut régler (docs/TACHES.md
 * § 3). Chaque tâche : sujet `{ type: "SYSTEME", id: null }`, clé stable `SYSTEME:<code>`, titre « (verbe) · (quoi) »,
 * niveau 4 si urgent sinon 5, raccourci PAGE avec la marche à suivre en une ligne et le lien (externe pour Railway,
 * Stripe, Meta, Google Cloud, OpenAI).
 *
 * Lecture seule, et JAMAIS de réseau : tout se lit en base, dans l'environnement ou sur le disque local. Les sources
 * sont lues directement (pas `santeSysteme`, qui perd les identifiants, ni `etatDesTaches`, qui enregistre tous les
 * volets : cycle d'import, comprendre-a/systeme.md § 0) ; les modules lourds sont importés à l'exécution.
 *
 * Un signal dont la lecture échoue n'arrête pas les autres : ses tâches ouvertes sont rendues telles quelles
 * (`reconduite`), rien n'est coché à tort. Quand un signal ne voit plus une tâche, `acheves` rend la preuve lue en
 * base (« coché par le CRM : paiement Railway reçu le 29/09 ») ; à défaut, le moteur coche par absence.
 *
 * Une tâche SYSTEME n'est jamais écartée par une prochaine action manuelle ; répondue « Fait » à la main, elle revient
 * si la condition tient encore 24 h après (moteur.ts).
 */

const JOUR_MS = 86_400_000;
const SUJET = { type: "SYSTEME", id: null } as const;
const cle = (code: string) => cleTache("SYSTEME", SUJET, code);

type Etat = { maintenant: Date; ouvertes: Awaited<ReturnType<typeof tachesOuvertesDe>> };
type Lecture = {
  detections: Detection[];
  /** La preuve d'achèvement d'une tâche de ce signal qu'il ne voit plus (sans le préfixe « coché par le CRM : »). */
  preuve?: (cle: string) => Promise<string | null> | string | null;
};
type Signal = { nom: string; possede: (cle: string) => boolean; lire: (etat: Etat) => Promise<Lecture> };

type Tache = { code: string; titre: string; raison: string; niveau: NiveauTache; depuis: Date; raccourci: Omit<Raccourci, "genre">; dureeMin?: number; donnees?: Record<string, unknown> };

function tacheSysteme(etat: Etat, t: Tache): Detection {
  const c = cle(t.code);
  return {
    cle: c,
    type: "SYSTEME",
    source: "SYSTEME",
    sujet: { ...SUJET },
    titre: t.titre,
    raison: court(t.raison),
    niveau: t.niveau,
    depuis: depuisDe(etat.ouvertes, c, t.depuis),
    raccourci: { genre: "PAGE", ...t.raccourci },
    ...(t.donnees ? { donnees: t.donnees } : {}),
    ...(t.dureeMin ? { dureeMin: t.dureeMin } : {}),
  };
}

const plusAncienne = (dates: (Date | null | undefined)[]): Date | null => dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);
const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;
/** Minuscules, sans accents : les filtres sur les mails (anglais et français) ne dépendent ni de la casse ni des accents. */
const aplatir = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const baseLocale = () => Boolean(process.env.DATABASE_URL?.startsWith("file:")) && !process.env.TURSO_DATABASE_URL;

/* ── Tâches de fond en échec définitif ─────────────────────────────────── */

/** SAUVEGARDE_DRIVE a sa propre tâche (SYSTEME:sauvegarde), ANALYTIQUE_SYNCHRO la sienne (SYSTEME:synchro-<source>) : pas comptées deux fois. */
const TYPES_A_PART = ["SAUVEGARDE_DRIVE", "ANALYTIQUE_SYNCHRO"];
/** Mission 18 (A5) : l'onglet Système de Paramètres ; la clé de la tâche (`SYSTEME:taches-de-fond`) ne change pas. */
const LIEN_TACHES_DE_FOND = ADRESSE_SYSTEME;

const tachesDeFond: Signal = {
  nom: "tâches de fond",
  possede: (c) => c === cle("taches-de-fond"),
  async lire(etat) {
    const echecs = await prisma.tache.findMany({ where: { statut: "ECHEC_DEFINITIF", type: { notIn: TYPES_A_PART } }, select: { updatedAt: true, termineLe: true } });
    if (echecs.length === 0) return { detections: [], preuve: () => "plus aucune tâche de fond en échec" };
    const depuis = plusAncienne(echecs.map((e) => e.termineLe ?? e.updatedAt)) ?? etat.maintenant;
    return {
      detections: [
        tacheSysteme(etat, {
          code: "taches-de-fond",
          titre: `Relancer ${pluriel(echecs.length, "tâche de fond", "tâches de fond")} en échec`,
          raison: `${pluriel(echecs.length, "échec définitif", "échecs définitifs")} depuis le ${jourMois(depuis)}`,
          niveau: 4,
          depuis,
          dureeMin: 2,
          raccourci: { libelle: "Ouvrir les tâches de fond", href: LIEN_TACHES_DE_FOND, marche: "Lire l'erreur de chaque tâche en échec, régler la cause, puis « Relancer » (ou « Annuler » si elle n'a plus lieu d'être)." },
        }),
      ],
    };
  },
};

/* ── Travaux périodiques en échec ──────────────────────────────────────── */

const PREFIXE_TRAVAIL = "travail-";
/** La sauvegarde quotidienne a sa propre tâche (SYSTEME:sauvegarde, dès le premier échec). */
const TRAVAUX_A_PART = ["sauvegarde-quotidienne"];
const ECHECS_DE_SUITE = 2;

/** « Relève de la boîte mail » : le libellé du travail sans sa parenthèse, sinon son nom. */
function libelleTravail(nom: string): string {
  const libelle = travauxPeriodiques().find((t) => t.nom === nom)?.libelle;
  return court((libelle ?? nom).split(" (")[0], 60);
}

const travaux: Signal = {
  nom: "travaux périodiques",
  possede: (c) => c.startsWith(cle(PREFIXE_TRAVAIL)),
  async lire(etat) {
    // Seulement les travaux qui tournent encore (passés dans la semaine) : une ligne d'un travail retiré ne compte pas.
    const lignes = await prisma.planification.findMany({ where: { dernierStatut: "ECHEC", echecsConsecutifs: { gte: ECHECS_DE_SUITE }, nom: { notIn: TRAVAUX_A_PART }, dernierDebut: { gte: new Date(etat.maintenant.getTime() - 7 * JOUR_MS) } } });
    return {
      detections: lignes.map((p) =>
        tacheSysteme(etat, {
          code: `${PREFIXE_TRAVAIL}${p.nom}`,
          titre: `Réparer · ${libelleTravail(p.nom)}`,
          raison: `${pluriel(p.echecsConsecutifs, "échec", "échecs")} de suite : ${p.derniereErreur ?? "erreur inconnue"}`,
          niveau: p.nom.startsWith("sauvegarde") ? 4 : 5,
          depuis: p.dernierDebut ?? etat.maintenant,
          raccourci: { libelle: "Ouvrir les tâches de fond", href: LIEN_TACHES_DE_FOND, marche: "Lire l'erreur du travail dans Paramètres › Système et régler sa cause : il repart seul au passage suivant." },
        })
      ),
      preuve: async (c) => {
        const nom = c.slice(cle(PREFIXE_TRAVAIL).length);
        const p = await prisma.planification.findUnique({ where: { nom } });
        return p?.dernierStatut === "SUCCES" ? `travail repassé${p.dernierFin ? ` le ${jourMois(p.dernierFin)}` : ""}` : null;
      },
    };
  },
};

/* ── Paiements refusés (Railway, Stripe) ───────────────────────────────── */

/** Anglais et français, sur le texte aplati (sans accents, minuscules). */
export const MOTIF_PAIEMENT_ECHOUE =
  /payment (was |has )?(unsuccessful|failed|declined)|(failed|unsuccessful|declined) payment|payment failure|card (was |has been )?declined|past due|(could ?not|couldn.?t|unable to) (process|charge|collect)|paiement (a )?(echoue|refuse|rejete)|echec (du |de |de la )?(paiement|prelevement)|impaye/;
export const MOTIF_PAIEMENT_REUSSI =
  /payment (was |has been )?(successful|succeeded|received|confirmed)|(successful|succeeded) payment|receipt|thanks for your payment|invoice (was |has been )?paid|recu de paiement|paiement (bien )?(recu|reussi|accepte|confirme)|merci pour votre paiement/;

const FOURNISSEURS = {
  railway: { nom: "Railway", domaines: ["railway.app", "railway.com"], href: "https://railway.com/account/billing", marche: "Mettre à jour la carte sur la page de facturation Railway, puis régler la facture en attente (sinon le CRM s'arrête)." },
  stripe: { nom: "Stripe", domaines: ["stripe.com"], href: "https://dashboard.stripe.com/settings/billing", marche: "Mettre à jour le moyen de paiement dans la facturation Stripe, puis régler la facture en attente." },
} as const;
type Fournisseur = keyof typeof FOURNISSEURS;
const DOMAINES = Object.values(FOURNISSEURS).flatMap((f) => [...f.domaines]);
const JOURS_PAIEMENTS = 30;

const domaineDe = (adresse: string) => adresse.split("@")[1] ?? "";
const dansDomaine = (adresse: string, domaine: string) => {
  const d = domaineDe(adresse);
  return d === domaine || d.endsWith(`.${domaine}`);
};

/** Railway facture parfois par Stripe (expéditeur stripe.com, « Railway » dans le nom ou l'objet) : c'est Railway. */
function fournisseurDe(m: { de: string; deNom: string | null; objet: string | null }): Fournisseur | null {
  if (FOURNISSEURS.railway.domaines.some((d) => dansDomaine(m.de, d)) || /railway/.test(aplatir(`${m.deNom ?? ""} ${m.objet ?? ""}`))) return "railway";
  if (FOURNISSEURS.stripe.domaines.some((d) => dansDomaine(m.de, d))) return "stripe";
  return null;
}

const paiements: Signal = {
  nom: "paiements",
  possede: (c) => c.startsWith(cle("paiement-")),
  async lire(etat) {
    // Railway est rangé d'office (bruit), Stripe est administratif : ni `rangeLe`, ni `classe`, ni `traiteLe` ne filtrent.
    const mails = await prisma.message.findMany({
      where: { canal: "EMAIL", sens: "ENTRANT", recuLe: { gte: new Date(etat.maintenant.getTime() - JOURS_PAIEMENTS * JOUR_MS), lte: etat.maintenant }, OR: DOMAINES.map((d) => ({ de: { endsWith: d } })) },
      orderBy: { recuLe: "asc" },
      select: { id: true, de: true, deNom: true, objet: true, extrait: true, recuLe: true },
    });
    const parFournisseur = new Map<Fournisseur, { echecs: typeof mails; reussite: Date | null }>();
    for (const m of mails) {
      const f = fournisseurDe(m);
      if (!f) continue;
      const suivi = parFournisseur.get(f) ?? { echecs: [], reussite: null };
      const texte = aplatir(`${m.objet ?? ""} ${m.extrait ?? ""} ${m.deNom ?? ""}`);
      if (MOTIF_PAIEMENT_ECHOUE.test(texte)) suivi.echecs.push(m);
      else if (MOTIF_PAIEMENT_REUSSI.test(texte)) suivi.reussite = m.recuLe;
      parFournisseur.set(f, suivi);
    }
    const detections: Detection[] = [];
    for (const [f, suivi] of parFournisseur) {
      // Seuls les échecs d'après le dernier paiement réussi comptent : un reçu plus récent règle la tâche.
      const echecs = suivi.echecs.filter((m) => !suivi.reussite || m.recuLe > suivi.reussite);
      if (echecs.length === 0) continue;
      const fournisseur = FOURNISSEURS[f];
      detections.push(
        tacheSysteme(etat, {
          code: `paiement-${f}`,
          titre: `Régler le paiement · ${fournisseur.nom}`,
          raison: `${pluriel(echecs.length, "échec", "échecs")} depuis le ${jourMois(echecs[0].recuLe)}`,
          niveau: 4,
          depuis: echecs[0].recuLe,
          raccourci: { libelle: `Ouvrir la facturation ${fournisseur.nom}`, href: fournisseur.href, externe: true, marche: fournisseur.marche },
          donnees: { mailsEchec: echecs.map((m) => m.id) },
        })
      );
    }
    return {
      detections,
      preuve: (c) => {
        const f = c.slice(cle("paiement-").length) as Fournisseur;
        const reussite = parFournisseur.get(f)?.reussite;
        return FOURNISSEURS[f] && reussite ? `paiement ${FOURNISSEURS[f].nom} reçu le ${jourMois(reussite)}` : null;
      },
    };
  },
};

/* ── Jeton Meta refusé ─────────────────────────────────────────────────── */

export type EtatJetonMeta = { aRenouveler: boolean; etat: string; message: string; refusLe: Date | null; succesLe: Date | null };

/**
 * Le jeton de page Meta est-il à renouveler ? `resumeChaineMeta` (base seule, aucun appel à Meta) : invalide, expiré ou
 * proche. Piège (comprendre-a/systeme.md § 8) : un refus reste « vrai » sept jours (tâches META_CONVERSION en échec de la
 * semaine) — un succès Meta postérieur au refus (conversion acceptée, lead lu) dit que le jeton a été remplacé.
 * Partagé avec la condition JETON_META des tâches à moi (manuelles.ts).
 */
export async function lireJetonMeta(maintenant: Date): Promise<EtatJetonMeta> {
  const [{ resumeChaineMeta }, { faitsJeton, TACHE_CONVERSION }] = await Promise.all([import("@/lib/meta/sante"), import("@/lib/meta/taches")]);
  const [{ jeton }, faits] = await Promise.all([resumeChaineMeta(maintenant), faitsJeton(maintenant)]);
  const refusLe = faits.refusLe;
  let succesLe: Date | null = null;
  if (refusLe) {
    const [conversion, lead] = await Promise.all([
      prisma.tache.findFirst({ where: { type: TACHE_CONVERSION, statut: "TERMINEE", termineLe: { gt: refusLe } }, orderBy: { termineLe: "desc" }, select: { termineLe: true } }),
      prisma.metaLead.findFirst({ where: { ...AVEC_ARCHIVES, statut: "TRAITE", traiteLe: { gt: refusLe } }, orderBy: { traiteLe: "desc" }, select: { traiteLe: true } }),
    ]);
    succesLe = [conversion?.termineLe, lead?.traiteLe].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  }
  const refuse = jeton.etat === "invalide" || jeton.etat === "expire" || jeton.etat === "proche";
  return { aRenouveler: refuse && !(jeton.etat === "invalide" && succesLe), etat: jeton.etat, message: jeton.message, refusLe, succesLe };
}

const jetonMeta: Signal = {
  nom: "jeton Meta",
  possede: (c) => c === cle("jeton-meta"),
  async lire(etat) {
    const e = await lireJetonMeta(etat.maintenant);
    if (!e.aRenouveler) return { detections: [], preuve: () => (e.succesLe ? `Meta a accepté un envoi le ${jourMois(e.succesLe)}` : "plus aucun refus du jeton Meta") };
    const raison = e.etat === "invalide" ? (e.refusLe ? `refusé par Meta le ${jourMois(e.refusLe)}` : "refusé par Meta") : e.etat === "expire" ? "jeton expiré : les leads ne sont plus lus" : e.message;
    return {
      detections: [
        tacheSysteme(etat, {
          code: "jeton-meta",
          titre: "Renouveler le jeton · Meta",
          raison,
          niveau: e.etat === "proche" ? 5 : 4,
          depuis: e.refusLe ?? etat.maintenant,
          dureeMin: 10,
          raccourci: { libelle: "Ouvrir l'explorateur Graph", href: "https://developers.facebook.com/tools/explorer/", externe: true, marche: "Régénérer le jeton de page dans l'explorateur Graph, puis le remplacer sur Railway (META_PAGE_ACCESS_TOKEN)" },
        }),
      ],
    };
  },
};

/* ── Numérotation des factures ─────────────────────────────────────────── */

const numerotation: Signal = {
  nom: "numérotation des factures",
  possede: (c) => c === cle("numerotation-factures"),
  async lire(etat) {
    const [{ anneeParis }, { prochainNumero }, { NUMEROTATION }] = await Promise.all([import("@/lib/dossiers/dates"), import("@/lib/dossiers/numerotation"), import("@/lib/dossiers/constants")]);
    const annee = anneeParis(etat.maintenant);
    const compteur = await prisma.compteurNumerotation.findUnique({ where: { serie_annee: { serie: NUMEROTATION.FACTURE.compteur, annee } } });
    // La série F a démarré (première facture émise, ou compteur posé à la main) : plus de collision possible.
    if (compteur) return { detections: [], preuve: () => `numérotation des factures ${annee} posée` };
    const prochain = await prochainNumero("FACTURE", etat.maintenant);
    const manuelles = prochain.endsWith("-001")
      ? await prisma.numeroDocument.findMany({ where: { annee, type: { in: ["FACTURE", "INCONNU"] }, famille: { notIn: [...NUMEROTATION.FACTURE.famillesPrecedentes] } }, orderBy: { rang: "asc" }, select: { numero: true, type: true } })
      : [];
    if (manuelles.length === 0) return { detections: [], preuve: () => `numérotation des factures ${annee} sans collision` };
    const factures = manuelles.filter((n) => n.type === "FACTURE").map((n) => n.numero);
    const cite = factures.length ? `${factures.slice(0, 3).join(", ")}${factures.length > 3 ? "…" : ""} ${factures.length > 1 ? "existent" : "existe"}` : `${pluriel(manuelles.length, "numéro manuel", "numéros manuels")} ${annee} hors série F`;
    return {
      detections: [
        tacheSysteme(etat, {
          code: "numerotation-factures",
          titre: "Faire valider la numérotation · Factures",
          raison: `première facture prévue en ${prochain} alors que ${cite}`,
          niveau: 4,
          depuis: etat.maintenant,
          dureeMin: 15,
          raccourci: { libelle: "Ouvrir la numérotation", href: "/parametres#numerotation", marche: `Faire valider par le comptable la suite des factures (${prochain} ou la suite des numéros manuels), puis poser le prochain numéro dans Paramètres → Facturation → Numérotation.` },
        }),
      ],
    };
  },
};

/* ── Crédit OpenAI ─────────────────────────────────────────────────────── */

/**
 * Le solde estimé comme `simulateur/consommation.ts › consommation()`, lu en base seulement : `consommation()` interroge
 * l'API de coûts d'OpenAI quand OPENAI_ADMIN_KEY est posée, et un détecteur n'appelle jamais le réseau.
 */
async function soldeOpenAI(maintenant: Date) {
  const [releve, dernierEchec, derniereReussite] = await Promise.all([
    prisma.parametre.findFirst({ where: { cle: "SIMULATEUR_CREDIT_OPENAI", valableDu: { lte: maintenant } }, orderBy: [{ valableDu: "desc" }, { createdAt: "desc" }], select: { valeur: true, valableDu: true } }),
    prisma.generationImage.findFirst({ where: { statut: "ECHEC", erreur: { startsWith: "service-indisponible" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.generationImage.findFirst({ where: { statut: "REUSSI" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const epuiseLe = dernierEchec && (!derniereReussite || derniereReussite.createdAt < dernierEchec.createdAt) ? dernierEchec.createdAt : null;
  if (!releve) return { releve: null, epuiseLe, derniereReussite: derniereReussite?.createdAt ?? null };
  const valeur = Number(JSON.parse(releve.valeur));
  const depuis = await prisma.generationImage.aggregate({ where: { createdAt: { gte: releve.valableDu } }, _sum: { coutDollars: true } });
  const estime = Math.round((valeur - (depuis._sum.coutDollars ?? 0)) * 100) / 100;
  return { releve: { valeur, le: releve.valableDu, estime }, epuiseLe, derniereReussite: derniereReussite?.createdAt ?? null };
}

const RECHARGER_OPENAI = { libelle: "Ouvrir la facturation OpenAI", href: "https://platform.openai.com/settings/organization/billing/overview", externe: true, marche: "Recharger le crédit sur platform.openai.com (Facturation), puis noter le nouveau solde dans Paramètres → Simulateur." };

const creditOpenAI: Signal = {
  nom: "crédit OpenAI",
  possede: (c) => c === cle("credit-openai"),
  async lire(etat) {
    const { SEUIL_ALERTE_DOLLARS } = await import("@/lib/simulateur/consommation");
    const s = await soldeOpenAI(etat.maintenant);
    const tache = (t: Omit<Tache, "code">) => ({ detections: [tacheSysteme(etat, { code: "credit-openai", ...t })] });
    if (s.epuiseLe) return tache({ titre: "Recharger le crédit · OpenAI", raison: `génération refusée le ${jourMois(s.epuiseLe)} faute de crédit`, niveau: 4, depuis: s.epuiseLe, raccourci: RECHARGER_OPENAI });
    if (s.releve && s.releve.estime < SEUIL_ALERTE_DOLLARS) {
      return tache({ titre: "Recharger le crédit · OpenAI", raison: `solde estimé ${euro(s.releve.estime)} (relevé ${euro(s.releve.valeur)} le ${jourMois(s.releve.le)})`, niveau: 4, depuis: etat.maintenant, raccourci: RECHARGER_OPENAI });
    }
    if (!s.releve) {
      return tache({
        titre: "Noter le solde OpenAI",
        raison: "solde jamais noté : le crédit restant n'est pas suivi",
        niveau: 5,
        depuis: etat.maintenant,
        dureeMin: 2,
        raccourci: { libelle: "Ouvrir les paramètres du simulateur", href: "/parametres#simulateur", marche: "Lire le solde sur platform.openai.com (Facturation), puis le noter dans Paramètres → Simulateur (crédit OpenAI)." },
      });
    }
    return { detections: [], preuve: () => `solde OpenAI noté : ${euro(s.releve!.valeur)} le ${jourMois(s.releve!.le)}` };
  },
};

/* ── Sauvegardes ───────────────────────────────────────────────────────── */

const sauvegarde: Signal = {
  nom: "sauvegardes",
  possede: (c) => c === cle("sauvegarde"),
  async lire(etat) {
    const [{ NOM_SAUVEGARDE_QUOTIDIENNE }, { TYPE_TACHE_SAUVEGARDE_DRIVE, empechementSauvegardeDrive }] = await Promise.all([import("@/lib/base/taches"), import("@/lib/base/sauvegarde-drive")]);
    const [quotidienne, driveEchec] = await Promise.all([
      prisma.planification.findUnique({ where: { nom: NOM_SAUVEGARDE_QUOTIDIENNE } }),
      prisma.tache.findFirst({ where: { type: TYPE_TACHE_SAUVEGARDE_DRIVE, statut: "ECHEC_DEFINITIF" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, termineLe: true } }),
    ]);
    const causes: { texte: string; depuis: Date; href: string; marche: string }[] = [];
    if (quotidienne?.dernierStatut === "ECHEC") {
      causes.push({ texte: `sauvegarde quotidienne en échec : ${quotidienne.derniereErreur ?? "erreur inconnue"}`, depuis: quotidienne.dernierDebut ?? etat.maintenant, href: LIEN_TACHES_DE_FOND, marche: "Lire l'erreur du travail « sauvegarde-quotidienne » dans Paramètres › Système (souvent : disque plein), régler la cause : il repart seul." });
    }
    if (driveEchec) {
      const echecLe = driveEchec.termineLe ?? driveEchec.updatedAt;
      // Une copie hebdomadaire réussie depuis règle l'échec d'une semaine passée.
      const reussie = await prisma.tache.findFirst({ where: { type: TYPE_TACHE_SAUVEGARDE_DRIVE, statut: "TERMINEE", termineLe: { gt: echecLe } }, select: { id: true } });
      if (!reussie) causes.push({ texte: `copie chiffrée vers Drive en échec le ${jourMois(echecLe)}`, depuis: echecLe, href: LIEN_TACHES_DE_FOND, marche: "Lire l'erreur de la tâche « SAUVEGARDE_DRIVE » dans Paramètres › Système, régler la cause, puis « Relancer »." });
    }
    // Base Turso (non locale) : rien à copier, ce n'est pas un défaut.
    const empechement = baseLocale() ? await empechementSauvegardeDrive() : null;
    if (empechement) {
      const google = /Google|Drive/.test(empechement);
      causes.push({ texte: `copie vers Drive impossible : ${empechement}`, depuis: etat.maintenant, href: google ? "/parametres#connexions" : LIEN_TACHES_DE_FOND, marche: google ? "Paramètres → Connexions → Google : connecter (ou reconnecter) Google Drive." : "Poser SAUVEGARDE_CLE (32 octets en base64) sur Railway, puis redémarrer." });
    }
    if (causes.length === 0) return { detections: [], preuve: () => "sauvegardes de nouveau en ordre" };
    const [premiere] = causes;
    return {
      detections: [
        tacheSysteme(etat, {
          code: "sauvegarde",
          titre: "Réparer · Sauvegarde",
          raison: `${premiere.texte}${causes.length > 1 ? ` (+${causes.length - 1})` : ""}`,
          niveau: 4,
          depuis: plusAncienne(causes.map((c) => c.depuis)) ?? etat.maintenant,
          raccourci: { libelle: premiere.href === LIEN_TACHES_DE_FOND ? "Ouvrir les tâches de fond" : "Ouvrir les connexions", href: premiere.href, marche: premiere.marche },
        }),
      ],
    };
  },
};

/* ── Google ────────────────────────────────────────────────────────────── */

/** `SYSTEME:google-api-agenda`, `-gmail`, `-drive`. */
function codeApi(api: string): string {
  if (/calendar/i.test(api)) return "google-api-agenda";
  if (/gmail/i.test(api)) return "google-api-gmail";
  if (/drive/i.test(api)) return "google-api-drive";
  return `google-api-${aplatir(api).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const google: Signal = {
  nom: "Google",
  possede: (c) => c.startsWith(cle("google-")),
  async lire(etat) {
    const { API_CALENDAR, etatConnexionGoogle, rappelConnexionGoogle } = await import("@/lib/google/connexion");
    const [rappel, connexion] = await Promise.all([rappelConnexionGoogle(etat.maintenant), etatConnexionGoogle()]);
    const detections: Detection[] = [];
    if (rappel) {
      const raison = rappel.coupee ? "connexion coupée : mails, agenda et Drive attendent" : rappel.niveau === "EXPIREE" ? "connexion expirée : mails, agenda et Drive attendent" : `connexion à renouveler avant le ${rappel.expireLe ? jourMois(new Date(rappel.expireLe)) : "prochain passage"}`;
      detections.push(
        tacheSysteme(etat, {
          code: "google-connexion",
          titre: "Reconnecter · Google",
          raison,
          niveau: 4,
          depuis: etat.maintenant,
          dureeMin: 2,
          raccourci: { libelle: "Ouvrir les connexions", href: "/parametres#connexions", marche: "Paramètres → Connexions → Google → « Reconnecter », puis accepter tous les accès demandés." },
        })
      );
    }
    const apis = [...(connexion.agendaApiActivee ? [] : [{ api: API_CALENDAR }]), ...connexion.autresApisNonActivees];
    for (const { api } of apis) {
      detections.push(
        tacheSysteme(etat, {
          code: codeApi(api),
          titre: `Activer l'API · ${api}`,
          raison: "API non activée dans le projet Google Cloud : les actions attendent",
          niveau: 5,
          depuis: etat.maintenant,
          raccourci: { libelle: "Ouvrir la console Google Cloud", href: "https://console.cloud.google.com/apis/library", externe: true, marche: `Console Google Cloud → API et services → activer « ${api} API », puis « Reconnecter » dans Paramètres → Connexions.` },
        })
      );
    }
    return { detections, preuve: (c) => (c === cle("google-connexion") ? "Google reconnecté" : "API Google activée") };
  },
};

/* ── Synchronisations de l'Analytique ──────────────────────────────────── */

/** `SYSTEME:synchro-meta`, `synchro-search-console`, `synchro-fiche-google`. */
const codeSynchro = (source: string) => `synchro-${source.toLowerCase().replace(/_/g, "-")}`;
const ONGLET_SYNCHRO: Record<string, string> = { META: "publicite", GOOGLE_ADS: "publicite", SEARCH_CONSOLE: "seo", FICHE_GOOGLE: "seo" };
/** Au-delà de 24 h d'échec, la tâche monte au niveau 4. */
const HEURES_SYNCHRO_URGENTE = 24;

const synchros: Signal = {
  nom: "synchronisations de l'Analytique",
  possede: (c) => c.startsWith(cle("synchro-")),
  async lire(etat) {
    // Base et variables seulement (etat.ts n'appelle jamais Meta ni Google).
    const { pannesDeSynchro } = await import("@/lib/analytique/etat");
    const pannes = await pannesDeSynchro(etat.maintenant);
    return {
      detections: pannes.map((p) =>
        tacheSysteme(etat, {
          code: codeSynchro(p.source),
          titre: `Réparer la synchronisation · ${p.libelle}`,
          raison: `en échec depuis le ${jourMois(p.depuis)}${p.derniereReussite ? ` (dernière réussite le ${jourMois(p.derniereReussite)})` : ""} : ${p.erreur}`,
          niveau: p.heures > HEURES_SYNCHRO_URGENTE ? 4 : 5,
          depuis: p.depuis,
          dureeMin: 5,
          raccourci: { libelle: "Ouvrir l'Analytique", href: `/analytique?onglet=${ONGLET_SYNCHRO[p.source] ?? "ensemble"}`, marche: p.aFaire || "Lire l'erreur de la synchronisation, régler sa cause, puis « Relancer » depuis l'Analytique." },
        })
      ),
      preuve: async (c) => {
        const { lireTousLesSuivis } = await import("@/lib/analytique/suivi");
        const suivi = [...(await lireTousLesSuivis()).values()].find((s) => cle(codeSynchro(s.source)) === c);
        return suivi?.detail.etat === "A_JOUR" && suivi.derniereReussiteLe ? `synchronisation réussie le ${jourMois(suivi.derniereReussiteLe)}` : suivi && suivi.detail.etat !== "EN_ECHEC" ? "synchronisation plus en échec" : null;
      },
    };
  },
};

/* ── Disque ────────────────────────────────────────────────────────────── */

export const SEUILS_DISQUE_TACHE = { attention: 70, urgent: 85 } as const;

const disque: Signal = {
  nom: "disque",
  possede: (c) => c === cle("disque"),
  async lire(etat) {
    const { fichierDeLaBase, capaciteVolume } = await import("@/lib/base/sauvegarde.mjs");
    const fichier = fichierDeLaBase();
    if (!fichier) return { detections: [] };
    const { pourcentUtilise } = capaciteVolume(path.dirname(fichier));
    if (pourcentUtilise < SEUILS_DISQUE_TACHE.attention) return { detections: [], preuve: () => `disque utilisé à ${pourcentUtilise} %` };
    return {
      detections: [
        tacheSysteme(etat, {
          code: "disque",
          titre: "Libérer de la place · Disque",
          raison: `volume de la base plein à ${pourcentUtilise} %`,
          niveau: pourcentUtilise >= SEUILS_DISQUE_TACHE.urgent ? 4 : 5,
          depuis: etat.maintenant,
          raccourci: { libelle: "Ouvrir les tâches de fond", href: LIEN_TACHES_DE_FOND, marche: "Agrandir le volume sur Railway (service → Volumes), ou supprimer les vieilles sauvegardes du volume." },
        }),
      ],
    };
  },
};

/* ── Le détecteur ──────────────────────────────────────────────────────── */

export const SIGNAUX_SYSTEME: readonly Signal[] = [tachesDeFond, travaux, paiements, jetonMeta, numerotation, creditOpenAI, sauvegarde, google, synchros, disque];

type Analyse = { detections: Detection[]; acheves: Achevement[] };

/** `detecter` et `acheves` sont appelés ensemble par un passage (même contexte) : une seule lecture des signaux. */
const analyses = new WeakMap<ContexteDetection, Promise<Analyse>>();

async function analyser(contexte: ContexteDetection): Promise<Analyse> {
  const ouvertes = await tachesOuvertesDe("SYSTEME");
  const etat: Etat = { maintenant: contexte.maintenant, ouvertes };
  const lectures = await Promise.all(
    SIGNAUX_SYSTEME.map(async (signal) => {
      try {
        return { signal, lecture: await signal.lire(etat) };
      } catch (erreur) {
        console.error(`[a-faire] signal système « ${signal.nom} » illisible (ses tâches restent telles quelles) :`, erreur);
        return { signal, lecture: null };
      }
    })
  );
  const detections: Detection[] = [];
  for (const { signal, lecture } of lectures) {
    if (lecture) detections.push(...lecture.detections);
    else for (const ligne of ouvertes.values()) if (signal.possede(ligne.cle)) detections.push(reconduite(ligne));
  }
  const vues = new Set(detections.map((d) => d.cle));
  const acheves: Achevement[] = [];
  for (const ligne of ouvertes.values()) {
    if (vues.has(ligne.cle)) continue;
    const lue = lectures.find((l) => l.signal.possede(ligne.cle));
    const texte = lue?.lecture?.preuve ? await lue.lecture.preuve(ligne.cle) : null;
    if (texte) acheves.push({ cle: ligne.cle, texte: `${PREFIXE_COCHE}${texte}` });
  }
  return { detections, acheves };
}

function analyse(contexte: ContexteDetection): Promise<Analyse> {
  let enCours = analyses.get(contexte);
  if (!enCours) {
    enCours = analyser(contexte);
    analyses.set(contexte, enCours);
  }
  return enCours;
}

export const detecteurSysteme: Detecteur = {
  source: "SYSTEME",
  async detecter(contexte) {
    return (await analyse(contexte)).detections;
  },
  async acheves(contexte) {
    return (await analyse(contexte)).acheves;
  },
};
