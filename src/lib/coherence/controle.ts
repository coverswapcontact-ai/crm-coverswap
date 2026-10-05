import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { alerter } from "@/lib/alertes/canaux";
import { ETAPES, LIBELLES_ETAPE, PROCHAINE_ACTION_APRES_DEVIS, REGLES_ETAPES, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { annoncerDevisEnLigne, devisAEnvoyer, mettreEnLigneDevis, phraseAnnonce } from "@/lib/dossiers/devis-envoye";
import { annulerRelancesEnAttente, ETAPES_RETOUR_DEVIS, etapeAvantLeDevis } from "@/lib/dossiers/devis-retire";
import { signerParDevisAccepte } from "@/lib/dossiers/devis-signe";
import { retenirDevis, suiteNonRetenus } from "@/lib/dossiers/devis-retenu";
import { lireFaitsMain, mainSelonFaits, recalculerMain } from "@/lib/dossiers/main";
import { estActionManuelleEnPlace } from "@/lib/dossiers/prochaine-action-auto";
import { estEtape } from "@/lib/dossiers/regles";
import { ecrireStatutLead } from "@/lib/dossiers/statut-lead";
import { appliquerEvenementDossier, suitesEvenementDossier, type Suites } from "@/lib/dossiers/synchro";
import { appliquerChangementEtape, effetsDuChangementEtape, marquerSynchronise } from "@/lib/dossiers/transitions";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { devisDesAcomptes, suivreSoldeDossier } from "@/lib/encaissements/service";
import { faitsPaiements } from "@/lib/encaissements/soldes";
import { dateSignature, lectureDesDevis, lireDevisEtPaiements } from "@/lib/espace/faits";
import { lireProjet, projetComplet } from "@/lib/espace/projet";
import { lireSelection } from "@/lib/prestations/prestations";
import { devaliderChoix, devaliderProjet, RAISON_PROJET_VALIDE } from "@/lib/espace/validations";
import { figeDuProjet, LIMITE_PROJETS_EN_COURS, projetsVisibles } from "@/lib/espace/projets";
import { desactiverLien } from "@/lib/espace/gestion";
import { pluriel } from "@/lib/commun/format";
import { ADRESSE_SYSTEME } from "@/lib/parametres/sections";
import { synchroniserRappel } from "@/lib/agenda/rappels";

/**
 * Contrôle de cohérence : chaque section du CRM dit une partie de la vérité sur
 * un client ; ce contrôle vérifie qu'elles disent LA MÊME. Il parcourt tous les
 * dossiers vivants et compare l'étape du dossier, l'état de l'espace client,
 * les documents, les encaissements et le lead d'origine (docs/COHERENCE.md en
 * donne la matrice). Lecture seule ; chaque incohérence dit ce qu'elle est,
 * pourquoi elle compte, et — quand la correction est sans risque — propose un
 * bouton « Corriger » (`corrigerIncoherence`). Tourne au démarrage et une fois
 * par jour (taches.ts) ; Paramètres › Système l'affiche et le relance à la demande.
 *
 * Mission 18 (B13) : règles des écarts 1, 3, 5, 6 et 7 de la partie B (devis « envoyé » sans envoi, PDF parti de Gmail
 * pas enregistré, devis visible jamais annoncé, « Devis envoyé » sans devis actif, avenant que l'espace ne propose pas),
 * « Attendre l'accord » sans devis, date du chantier posée en « Signé », dossier perdu ou archivé dont l'espace est encore
 * ouvert. Chaque correction passe par les fonctions du métier (point d'entrée `dossiers/synchro.ts` pour ce qui touche la
 * phase du devis) et laisse une trace `COHERENCE_CORRIGEE` dans l'historique du dossier. `appliquerCorrection` corrige
 * une incohérence déjà lue (sans rejouer le contrôle : la mise en route en applique plusieurs d'un passage) ;
 * `controlerCoherence({ etendu: true })` lit aussi les dossiers perdus et archivés.
 */

/** Tous les codes du contrôle (chacun a sa ligne dans docs/COHERENCE.md § 5 : un essai le vérifie). */
export const CODES_INCOHERENCE = [
  "DEVIS_MONTANT_NUL",
  "ACCORD_SANS_SIGNATURE",
  "DEVIS_ACCEPTE_AVANT_SIGNE",
  "SIGNE_SANS_DEVIS_ACCEPTE",
  "PAIEMENT_AVANT_SIGNATURE",
  "ETAPE_ET_SOLDE",
  "PROJET_VALIDE_INCOMPLET",
  "PROJET_VALIDE_SANS_AVANCER",
  "CHOIX_SANS_SIMULATION",
  "PROCHAINE_ACTION_PERIMEE",
  "STATUT_DU_LEAD",
  "LEAD_A_PLUSIEURS_DOSSIERS",
  "SIMULATIONS_HORS_DOSSIER",
  // Mission 5 (22/09/2026) : l'espace permanent et ses projets.
  "PROJET_FIGE_MODIFIE",
  "PROJETS_AU_DELA_DE_LA_LIMITE",
  // Mission 6 (22/09/2026) : qui a la main, une seule règle (dossiers/main.ts).
  "MAIN_DECALEE",
  // Mission 7 (22/09/2026) : un mail du client resté sans réponse alors que le dossier dit « chez le client ».
  "MAIL_SANS_REPONSE",
  // Mission 18 (B13) : écarts 1, 3, 5, 6 et 7 de la partie B ; prochaine action et date de chantier ; espace d'un dossier
  // clos (perdu ou archivé : remplace ESPACE_ACTIF_DOSSIER_ARCHIVE, qui ne voyait que les archivés d'avant la mission 5).
  "DEVIS_ENVOYE_SANS_ENVOI",
  "DEVIS_GMAIL_NON_ENREGISTRE",
  "DEVIS_VISIBLE_NON_NOTIFIE",
  "DEVIS_ENVOYE_SANS_DEVIS_ACTIF",
  "AVENANT_NON_PROPOSE",
  "ATTENTE_ACCORD_SANS_DEVIS",
  "DATE_CHANTIER_EN_SIGNE",
  "ESPACE_ACTIF_DOSSIER_CLOS",
] as const;

export type CodeIncoherence = (typeof CODES_INCOHERENCE)[number];

/**
 * Les corrections qui déplacent le dossier d'étape (un essai fige cette liste). Mission 18 (B13) : toutes sont sensibles
 * pour l'assistant (aperçu, puis confirmation) et la mise en route ne les applique jamais d'office.
 */
export const CORRECTIONS_QUI_CHANGENT_L_ETAPE: readonly CodeIncoherence[] = [
  "ACCORD_SANS_SIGNATURE",
  "PAIEMENT_AVANT_SIGNATURE",
  "DEVIS_ACCEPTE_AVANT_SIGNE",
  "ETAPE_ET_SOLDE",
  "PROJET_VALIDE_INCOMPLET",
  "PROJET_VALIDE_SANS_AVANCER",
  "DEVIS_ENVOYE_SANS_ENVOI",
  "DEVIS_ENVOYE_SANS_DEVIS_ACTIF",
  "DEVIS_VISIBLE_NON_NOTIFIE",
  "DEVIS_GMAIL_NON_ENREGISTRE",
  "DATE_CHANTIER_EN_SIGNE",
];

/**
 * Les corrections sensibles (outil `agir_systeme` CORRIGER_INCOHERENCE : aperçu puis confirmation ; jamais appliquées
 * d'office par une migration) : celles qui changent une étape (ci-dessus), touchent un devis, ou envoient un mail au
 * client (« Devis disponible » d'un devis jamais annoncé, avenant envoyé par mail).
 */
export const CORRECTIONS_SENSIBLES: ReadonlySet<CodeIncoherence> = new Set<CodeIncoherence>([...CORRECTIONS_QUI_CHANGENT_L_ETAPE, "SIGNE_SANS_DEVIS_ACCEPTE", "AVENANT_NON_PROPOSE"]);

export type Incoherence = {
  /** Stable d'un passage à l'autre : code + dossier (ou lead). */
  cle: string;
  code: CodeIncoherence;
  gravite: "HAUTE" | "MOYENNE";
  dossierId: string | null;
  leadId: string | null;
  client: string;
  constat: string;
  /** Ce que fait le bouton « Corriger » ; null : à régler à la main, depuis le dossier. */
  correction: string | null;
};

export type RapportCoherence = { le: string; dureeMs: number; dossiersControles: number; incoherences: Incoherence[] };

const rang = (etape: string) => (ETAPES as readonly string[]).indexOf(etape);
const ETAPES_ACTIVES: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"];
const estActive = (etape: string): etape is EtapeDossier => (ETAPES_ACTIVES as string[]).includes(etape);

/** Au-delà, un mail du client sans réponse sur un dossier « chez le client » est une incohérence. */
const JOURS_MAIL_SANS_REPONSE = 2;

const STATUT_LEAD_ATTENDU: Partial<Record<EtapeDossier, string[]>> = {
  DEVIS_ENVOYE: ["DEVIS_ENVOYE"],
  RELANCE: ["DEVIS_ENVOYE"],
  SIGNE: ["SIGNE"],
  PLANIFIE: ["CHANTIER_PLANIFIE"],
  CHANTIER: ["CHANTIER_PLANIFIE"],
  FACTURE: ["TERMINE"],
  ENCAISSE: ["TERMINE"],
  PERDU: ["PERDU"],
};

export type OptionsControle = {
  /**
   * Mission 18 (mise en route) : lire aussi les dossiers perdus et archivés. Les règles du lead (statut, doublons) et de
   * la main ne regardent jamais un dossier archivé ; celles des devis ne regardent que les dossiers vivants.
   */
  etendu?: boolean;
};

/** Les étapes après la signature où un devis émis plus tard est un avenant (ou un nouveau devis) à proposer au client. */
const ETAPES_AVENANT: readonly EtapeDossier[] = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE"];

/** Un devis d'un dossier, tel que les règles des écarts de la partie B le lisent. */
type DevisControle = { id: string; dossierId: string; numero: string | null; statut: string; origine: string; visibleEspace: boolean; createdAt: Date };

/** Ce que disent les traces d'envoi des devis : ceux qui ont atteint le client, ceux dont l'annonce a échoué, ceux en cours d'envoi par mail. */
type TracesDEnvoi = { partis: Set<string>; annonceEchouee: Set<string>; enCoursParMail: Set<string> };

const idDocumentDe = (metadata: string): { documentId: string | null; envoye: unknown } => {
  try {
    const valeur = JSON.parse(metadata) as { documentId?: unknown; envoye?: unknown };
    return { documentId: typeof valeur?.documentId === "string" ? valeur.documentId : null, envoye: valeur?.envoye };
  } catch {
    return { documentId: null, envoye: undefined };
  }
};

/**
 * Mission 18 (B13) : les devis qui ont atteint le client, d'après leurs traces — mis en ligne ou envoyés (événement
 * « Devis envoyé » : espace, mail du CRM, Gmail), annoncés à la génération (`DEVIS_GENERE` marqué `envoye: true`), ou
 * annoncés par le mail « Devis disponible » (programmé ou parti). Un devis repris, « Envoyé », accepté ou non retenu a
 * atteint le client par définition (`devisDejaParti`) : `estParti` le dit sans trace.
 */
async function tracesDEnvoi(dossierIds: readonly string[], documentIds: readonly string[]): Promise<TracesDEnvoi> {
  const traces: TracesDEnvoi = { partis: new Set(), annonceEchouee: new Set(), enCoursParMail: new Set() };
  if (documentIds.length === 0) return traces;
  const [evenements, annonces, propositions] = await Promise.all([
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: [...dossierIds] }, type: { in: ["DEVIS_ENVOYE", "DEVIS_GENERE"] } }, select: { type: true, metadata: true } }),
    prisma.envoiMail.findMany({ where: { cle: { in: documentIds.map((id) => `notif:DEVIS_DISPONIBLE:${id}`) } }, select: { cle: true, statut: true } }),
    prisma.proposition.findMany({ where: { type: "ENVOI_MAIL", statut: { in: ["EN_ATTENTE", "VALIDEE"] }, cleUnicite: { startsWith: "envoi-document:" } }, select: { cleUnicite: true } }),
  ]);
  for (const e of evenements) {
    const { documentId, envoye } = idDocumentDe(e.metadata);
    if (documentId && (e.type === "DEVIS_ENVOYE" || envoye === true)) traces.partis.add(documentId);
  }
  for (const a of annonces) {
    const id = a.cle.slice("notif:DEVIS_DISPONIBLE:".length);
    if (a.statut === "A_ENVOYER" || a.statut === "ENVOYE") traces.partis.add(id);
    else traces.annonceEchouee.add(id);
  }
  const regardes = new Set(documentIds);
  for (const p of propositions) {
    const id = p.cleUnicite?.split(":")[1];
    if (id && regardes.has(id)) traces.enCoursParMail.add(id);
  }
  return traces;
}

/** Un devis parti chez le client, ou en train de partir par mail (proposition validée, pas encore exécutée). */
const estParti = (devis: DevisControle, traces: TracesDEnvoi) => devis.origine === "REPRISE" || devis.statut !== "GENERE" || traces.partis.has(devis.id) || traces.enCoursParMail.has(devis.id);

export async function controlerCoherence(options: OptionsControle = {}): Promise<RapportCoherence> {
  const debut = Date.now();
  const incoherences: Incoherence[] = [];
  const dossiers = await prisma.dossier.findMany({
    where: options.etendu ? { ...AVEC_ARCHIVES } : { etape: { not: "PERDU" } },
    select: {
      id: true, clientNom: true, etape: true, prochaineAction: true, prochaineActionManuelle: true, prochaineActionManuelleLe: true, dateChantier: true, archiveLe: true, leadId: true, prestations: true, main: true, mainMotif: true,
      lead: { select: { id: true, statut: true, typeProjet: true, archiveLe: true } },
      documents: lectureDesDevis(),
      accords: true,
      encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
      espaces: { select: { id: true, souhaits: true, projetValideLe: true, choix: true, choixLe: true, propositionDemandeeLe: true, revoqueLe: true, simulations: { where: { archiveLe: null }, select: { id: true, statut: true } } } },
    },
  });

  // Mission 18 (B13) : tous les devis numérotés des dossiers lus (non archivés), une requête ; les traces d'envoi de ceux
  // des dossiers que les règles des écarts regardent (Devis envoyé, Relance ; après la signature pour les avenants).
  const tousDevis: DevisControle[] = dossiers.length
    ? await prisma.document.findMany({ where: { type: "DEVIS", numero: { not: null }, dossierId: { in: dossiers.map((d) => d.id) } }, select: { id: true, dossierId: true, numero: true, statut: true, origine: true, visibleEspace: true, createdAt: true }, orderBy: { createdAt: "asc" } })
    : [];
  const devisPar = new Map<string, DevisControle[]>();
  for (const devis of tousDevis) devisPar.set(devis.dossierId, [...(devisPar.get(devis.dossierId) ?? []), devis]);
  const regardes = dossiers.filter((d) => !d.archiveLe && (ETAPES_RETOUR_DEVIS as readonly string[]).concat(ETAPES_AVENANT).includes(d.etape));
  const traces = await tracesDEnvoi(
    regardes.map((d) => d.id),
    regardes.flatMap((d) => (devisPar.get(d.id) ?? []).map((x) => x.id))
  );
  let aEnvoyer: Set<string> | null = null;
  const devisAEnvoyerIds = async () => (aEnvoyer ??= new Set((await devisAEnvoyer(prisma)).map((x) => x.documentId)));
  const { peutNotifier } = await import("@/lib/mail/notifications");

  for (const d of dossiers) {
    const signaler = (code: CodeIncoherence, gravite: Incoherence["gravite"], constat: string, correction: string | null) =>
      incoherences.push({ cle: `${code}:${d.id}`, code, gravite, dossierId: d.id, leadId: d.leadId, client: d.clientNom, constat, correction });
    const lecture = lireDevisEtPaiements({ devis: d.documents, accords: d.accords, encaissements: d.encaissements, clientNom: d.clientNom, signeLe: dateSignature(d.evenements) });
    const espace = d.espaces[0] ?? null;
    const archive = d.archiveLe !== null;
    const active = estActive(d.etape);
    const avantSigne = active && rang(d.etape) < rang("SIGNE");
    const devisDuDossier = devisPar.get(d.id) ?? [];

    // Documents ↔ espace : le « 0 € ».
    if (lecture.devis && lecture.montants && lecture.montants.totalTtcCentimes <= 0) {
      signaler("DEVIS_MONTANT_NUL", "HAUTE", `Le devis ${lecture.devis.numero} vaut 0 € : le client lit « 0 € » dans son espace. Corriger le montant du document (dossier → Documents).`, null);
    }
    // Espace ↔ dossier : accord, signature.
    const accordEnLigne = d.accords.some((a) => !a.retireLe);
    if (accordEnLigne && avantSigne) {
      signaler("ACCORD_SANS_SIGNATURE", "HAUTE", `Le client a donné son bon pour accord dans son espace, mais le dossier est encore en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} ».`, "Passer le dossier en « Signé » (le devis devient « accepté »)");
    } else if (!accordEnLigne && avantSigne && d.documents.some((doc) => doc.statut === "ACCEPTE")) {
      // Mission 18 (B4) : un devis noté « accepté » par Lucas vaut signature (hors ligne) ; depuis, le dépôt et la
      // correction signent le dossier d'eux-mêmes : il ne reste que des dossiers d'avant, que la correction signe.
      signaler("DEVIS_ACCEPTE_AVANT_SIGNE", "MOYENNE", `Un devis est noté « accepté » (signé hors ligne) alors que le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » : l'espace du client le croit signé.`, "Passer le dossier en « Signé » (les autres devis proposés : non retenus)");
    }
    if (active && rang(d.etape) >= rang("SIGNE") && rang(d.etape) <= rang("CHANTIER") && d.documents.length > 0 && !lecture.accord) {
      signaler("SIGNE_SANS_DEVIS_ACCEPTE", "MOYENNE", `Le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » mais aucun devis n'est accepté : l'espace du client lui demande encore de signer.`, "Noter le dernier devis « accepté »");
    }
    // Finances ↔ dossier.
    const recu = lecture.paiement?.recu ?? d.encaissements.filter((e) => e.statut === "VALIDE").reduce((s, e) => s + e.montant, 0);
    if (recu > 0 && avantSigne) {
      signaler("PAIEMENT_AVANT_SIGNATURE", "HAUTE", `${recu.toLocaleString("fr-FR")} € encaissés alors que le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » : un paiement reçu vaut accord.`, d.documents.length > 0 ? "Passer le dossier en « Signé »" : null);
    }
    if (d.etape === "FACTURE" || d.etape === "ENCAISSE") {
      const paiements = await faitsPaiements(prisma, d.id);
      if (d.etape === "FACTURE" && paiements.soldeEncaisse) signaler("ETAPE_ET_SOLDE", "MOYENNE", "Toutes les factures sont réglées mais le dossier est resté en « Facturé ».", "Passer le dossier en « Encaissé »");
      if (d.etape === "ENCAISSE" && paiements.resteCentimes > 0) signaler("ETAPE_ET_SOLDE", "HAUTE", `Le dossier est « Encaissé » mais il reste ${(paiements.resteCentimes / 100).toLocaleString("fr-FR")} € à recevoir sur ses factures.`, "Revenir à « Facturé »");
    }

    // Mission 18 (B13) : le devis « envoyé » doit l'être vraiment (écarts 1, 5, 6). En Devis envoyé ou Relance :
    // - aucun devis émis, envoyé, non retenu ou accepté → l'étape ment (écart 6) : retour d'avant le devis ;
    // - des devis, mais aucun n'a atteint le client et aucun n'est visible dans un espace ouvert → écart 1 : retour,
    //   le devis reste à envoyer ;
    // - visible dans un espace ouvert, jamais annoncé ni envoyé par mail → écart 5 : le prévenir (« Devis disponible »),
    //   sauf interrupteur coupé dans Paramètres (la mise en ligne vaut alors envoi, décision 7 de la mission 18).
    // Un devis accepté relève de DEVIS_ACCEPTE_AVANT_SIGNE.
    if (!archive && (ETAPES_RETOUR_DEVIS as readonly string[]).includes(d.etape)) {
      const actifs = devisDuDossier.filter((x) => ["GENERE", "ENVOYE", "NON_RETENU", "ACCEPTE"].includes(x.statut));
      const etape = LIBELLES_ETAPE[d.etape as EtapeDossier];
      if (actifs.length === 0) {
        const vers = await etapeAvantLeDevis(prisma, d.id);
        signaler("DEVIS_ENVOYE_SANS_DEVIS_ACTIF", "HAUTE", `Le dossier est en « ${etape} » mais aucun devis n'attend sa réponse (${devisDuDossier.length ? "ses devis sont annulés ou remplacés" : "aucun devis dans le dossier"}) : son espace ne lui montre rien à signer et les relances tourneraient à vide.`, `Revenir à « ${LIBELLES_ETAPE[vers]} » et refaire le devis`);
      } else if (!actifs.some((x) => x.statut === "ACCEPTE") && !actifs.some((x) => estParti(x, traces))) {
        const notification = await peutNotifier("DEVIS_DISPONIBLE", d.id);
        const visibles = actifs.filter((x) => x.visibleEspace);
        const numeros = actifs.map((x) => x.numero).join(", ");
        if (visibles.length > 0 && notification.espaceOuvert) {
          const dernier = visibles.at(-1)!;
          if (notification.modeleActif) {
            const echec = traces.annonceEchouee.has(dernier.id);
            const correction = notification.possible && !echec ? `Le prévenir par le mail « Devis disponible » (devis ${dernier.numero} ; relances comptées depuis aujourd'hui)` : null;
            const pourquoi = echec ? " Le mail « Devis disponible » n'est pas parti (échec ou annulé) : l'envoyer par mail depuis le dossier." : !notification.possible ? ` Aucun mail possible (${(notification.raison ?? "").replace(/\.$/, "").toLowerCase()}) : l'envoyer par mail depuis le dossier.` : "";
            signaler("DEVIS_VISIBLE_NON_NOTIFIE", "HAUTE", `Le devis ${dernier.numero} est visible dans son espace, mais le client n'en a jamais été prévenu (ni mail « Devis disponible », ni envoi par mail) : le dossier est en « ${etape} » et les relances lui parleraient d'un devis qu'il ne sait pas avoir.${pourquoi}`, correction);
          }
        } else {
          const vers = await etapeAvantLeDevis(prisma, d.id);
          signaler("DEVIS_ENVOYE_SANS_ENVOI", "HAUTE", `Le dossier est en « ${etape} » mais aucun devis n'est parti chez le client (devis ${numeros} : ${visibles.length ? "son espace n'est pas ouvert" : "masqué dans son espace"}, ni annoncé ni envoyé par mail) : les relances lui parleraient d'un devis qu'il n'a pas.`, `Revenir à « ${LIBELLES_ETAPE[vers]} » (le devis reste à envoyer)`);
        }
      }
    }
    // Écart 7 : un devis émis après la signature (avenant, nouveau devis) que le client ne peut pas signer — son espace ne
    // montre que le devis signé (le site ne le propose pas encore, B7) — et qui ne lui a pas été envoyé par mail. Un devis
    // pas encore envoyé (B1) a déjà sa tâche « Envoyer le devis » : il n'est pas repris ici.
    if (!archive && ETAPES_AVENANT.includes(d.etape as EtapeDossier)) {
      const signe = devisDuDossier.filter((x) => x.statut === "ACCEPTE").at(-1);
      const enAttente = signe ? devisDuDossier.filter((x) => x.statut === "GENERE" && x.origine !== "REPRISE" && x.createdAt > signe.createdAt && !traces.enCoursParMail.has(x.id)) : [];
      const exclus = enAttente.length ? await devisAEnvoyerIds() : new Set<string>();
      const avenants = enAttente.filter((x) => !exclus.has(x.id));
      if (avenants.length > 0) {
        const dernier = avenants.at(-1)!;
        const { brouillonEnvoiDocument, schemaEnvoiDocument } = await import("@/lib/mail/service");
        const brouillon = schemaEnvoiDocument.safeParse(await brouillonEnvoiDocument(d.id, dernier.id).catch(() => null));
        signaler(
          "AVENANT_NON_PROPOSE",
          "HAUTE",
          `${avenants.length > 1 ? `Les devis ${avenants.map((x) => x.numero).join(", ")}, émis` : `Le devis ${dernier.numero}, émis`} après la signature (avenant ou nouveau devis), ${avenants.length > 1 ? "n'ont pas été proposés" : "n'a pas été proposé"} au client : son espace ne montre que le devis signé, il ne peut pas le signer en ligne, et aucun mail ne le lui a envoyé.${brouillon.success ? "" : " Aucune adresse e-mail valide : le lui faire signer autrement."}`,
          brouillon.success ? `Lui envoyer le devis ${dernier.numero} par mail (texte type, à ${brouillon.data.a})` : null
        );
      }
    }
    // Prochaine action « Attendre l'accord » alors qu'aucun devis n'attend sa réponse (une action posée à la main reste à Lucas).
    if (!archive && d.prochaineAction?.startsWith(PROCHAINE_ACTION_APRES_DEVIS) && !estActionManuelleEnPlace(d) && !devisDuDossier.some((x) => x.statut === "GENERE" || x.statut === "ENVOYE")) {
      signaler("ATTENTE_ACCORD_SANS_DEVIS", "MOYENNE", `Prochaine action « ${d.prochaineAction} » alors qu'aucun devis n'attend sa réponse.`, "Effacer cette prochaine action");
    }
    // La date du chantier est posée, le dossier est resté en « Signé » (modifier le dossier ne change pas l'étape).
    if (!archive && d.etape === "SIGNE" && d.dateChantier) {
      signaler("DATE_CHANTIER_EN_SIGNE", "MOYENNE", `La date du chantier est posée (${formatDateCourte(d.dateChantier)}) mais le dossier est resté en « Signé » : l'espace du client et Leads ne disent pas « chantier planifié ».`, `Passer le dossier en « Planifié » (chantier le ${formatDateCourte(d.dateChantier)})`);
    }

    // Espace : projet, simulation validée.
    if (espace) {
      if (espace.projetValideLe) {
        const manque = projetComplet(lireProjet(espace.souhaits, lireSelection(d.prestations), d.lead?.typeProjet));
        if (manque) signaler("PROJET_VALIDE_INCOMPLET", "MOYENNE", `Le projet est marqué « validé » mais il est incomplet (${manque.replace(/\.$/, "").toLowerCase()}).`, "Dévalider le projet (le client le complète et le revalide)");
        else if (d.etape === "QUALIFICATION") signaler("PROJET_VALIDE_SANS_AVANCER", "MOYENNE", "Le client a validé son projet, mais le dossier est resté en « Qualification ».", "Passer le dossier en « Simulation »");
      }
      if (espace.choixLe) {
        const ids = (() => {
          try {
            const choix = JSON.parse(espace.choix ?? "null") as { simulationId?: string; zones?: { simulationId: string }[] } | null;
            return choix ? [choix.simulationId, ...(choix.zones ?? []).map((z) => z.simulationId)].filter((x): x is string => Boolean(x)) : [];
          } catch {
            return [];
          }
        })();
        const visibles = new Set(espace.simulations.filter((s) => s.statut === "PUBLIEE").map((s) => s.id));
        if (ids.length === 0 || ids.some((id) => !visibles.has(id))) signaler("CHOIX_SANS_SIMULATION", "HAUTE", "La simulation validée par le client n'est plus visible dans sa galerie (masquée ou retirée) : il valide quelque chose qu'il ne voit plus.", "Dévalider son choix (il en validera une autre)");
      }
    }
    // Prochaine action ↔ faits.
    const action = d.prochaineAction ?? "";
    // (seulement pour un dossier qui a un espace : sans espace, c'est Lucas qui a écrit cette action, elle lui appartient)
    if (espace && /préparer le devis \(simulation/i.test(action) && (lecture.devis || !espace.choixLe)) {
      signaler("PROCHAINE_ACTION_PERIMEE", "MOYENNE", `Prochaine action « ${action} » alors que ${lecture.devis ? "le devis est déjà émis" : "plus aucune simulation n'est validée"}.`, lecture.devis ? `Remplacer par « ${PROCHAINE_ACTION_APRES_DEVIS} »` : "Effacer cette prochaine action");
    } else if (espace && /autre proposition/i.test(action) && !espace.propositionDemandeeLe) {
      signaler("PROCHAINE_ACTION_PERIMEE", "MOYENNE", `Prochaine action « ${action} » alors qu'aucune demande n'est en attente dans l'espace du client.`, "Effacer cette prochaine action");
    }
    // Un dossier archivé est sorti des listes, son lead est revenu dans Leads : ni statut du lead, ni main à comparer.
    if (archive) continue;
    // Leads ↔ dossiers. Un dossier perdu (contrôle étendu) n'impose « PERDU » que si le contact n'a pas d'autre dossier vivant.
    const attendus = STATUT_LEAD_ATTENDU[d.etape as EtapeDossier];
    const autreVivant = d.etape === "PERDU" && dossiers.some((x) => x.id !== d.id && x.leadId === d.leadId && !x.archiveLe && x.etape !== "PERDU");
    if (d.lead && !d.lead.archiveLe && attendus && !autreVivant && !attendus.includes(d.lead.statut)) {
      signaler("STATUT_DU_LEAD", "MOYENNE", `Le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » mais son lead est resté « ${d.lead.statut} » : la section Leads et la publicité ne racontent pas la même histoire.`, `Aligner le lead sur « ${attendus[0]} »`);
    }
    // Qui a la main : ce que le dossier affiche (kanban, fiche, Espaces clients, Leads) ↔ ce que disent ses derniers gestes.
    // Mission 14 : les faits lus une fois, les mêmes que ceux de la main (message du client sans réponse compris).
    const faits = await lireFaitsMain(d.id);
    const regle = faits ? mainSelonFaits(faits) : null;
    const responsable = REGLES_ETAPES[d.etape as EtapeDossier]?.responsable ?? null;
    const affichee = d.main === "MOI" || d.main === "CLIENT" ? d.main : responsable;
    if (regle?.qui && affichee && regle.qui !== affichee) {
      const dire = (qui: string) => (qui === "MOI" ? "à moi" : "chez le client");
      signaler("MAIN_DECALEE", "MOYENNE", `Le dossier affiche « ${dire(affichee)} » alors que ses derniers gestes le mettent « ${dire(regle.qui)} » (${regle.motif}).`, `Remettre « ${dire(regle.qui)} » partout`);
    }
    // Message du client sans réponse : il a écrit, personne n'a répondu depuis, et le dossier affiche « chez le client ».
    // Mission 14 : la même définition que la main (main.ts › lireFaitsMain) — un mail rangé, traité, automatique ou
    // déplacé ne compte pas ; une réponse par mail, dans l'espace, par SMS ou par un appel abouti le clôt. La règle
    // épingle alors la main à moi : ce contrôle attrape une main affichée restée « chez le client ».
    const sansReponse = faits?.messageSansReponse ?? null;
    if (sansReponse && affichee === "CLIENT") {
      const depuis = Date.now() - sansReponse.le.getTime();
      if (depuis > JOURS_MAIL_SANS_REPONSE * 86_400_000) {
        const ou = sansReponse.type === "MAIL_RECU" ? "depuis l'onglet Mail" : "dans son espace";
        signaler("MAIL_SANS_REPONSE", "HAUTE", `Le client a écrit il y a ${Math.floor(depuis / 86_400_000)} jours (${sansReponse.contenu.slice(0, 120)}) et n'a pas eu de réponse, alors que le dossier dit « chez le client ». Lui répondre ${ou}.`, null);
      }
    }
  }

  // Un lead, un seul dossier vivant.
  const parLead = new Map<string, typeof dossiers>();
  for (const d of dossiers) if (d.leadId && !d.archiveLe && !["ENCAISSE", "PERDU"].includes(d.etape)) parLead.set(d.leadId, [...(parLead.get(d.leadId) ?? []), d]);
  for (const [leadId, liste] of parLead) {
    if (liste.length > 1) incoherences.push({ cle: `LEAD_A_PLUSIEURS_DOSSIERS:${leadId}`, code: "LEAD_A_PLUSIEURS_DOSSIERS", gravite: "MOYENNE", dossierId: liste[0].id, leadId, client: liste[0].clientNom, constat: `Ce contact a ${liste.length} dossiers en cours : un seul dossier par projet. Archiver celui qui fait doublon (dossier → Archiver).`, correction: null });
  }

  // Écart 3 : un PDF parti de Gmail qui ressemble à un devis et n'est pas encore dans le CRM (la tâche « Enregistrer comme
  // devis envoyé » le propose déjà ; le contrôle le compte et, quand tout est connu, l'enregistre d'un clic).
  incoherences.push(...(await devisGmailOublies(new Map(dossiers.map((d) => [d.id, d])))));
  // Espaces encore ouverts de dossiers clos (perdus, archivés) ; simulations restées hors du dossier que le contact a pourtant.
  incoherences.push(...(await espacesDeDossiersClos()));
  const aRanger = await prisma.lead.findMany({
    where: { dossiers: { some: { archiveLe: null, etape: { notIn: ["PERDU", "ENCAISSE"] } } }, simulations: { some: { dossierId: null, OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }] } } },
    select: { id: true, prenom: true, nom: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  for (const l of aRanger) incoherences.push({ cle: `SIMULATIONS_HORS_DOSSIER:${l.id}`, code: "SIMULATIONS_HORS_DOSSIER", gravite: "MOYENNE", dossierId: l.dossiers[0]?.id ?? null, leadId: l.id, client: `${l.prenom} ${l.nom}`.trim(), constat: "Ce contact a un dossier, mais certaines de ses simulations du site n'y sont pas rangées (ni dans son espace).", correction: "Les ranger dans son dossier" });

  // Espace permanent (mission 5) : un projet figé ne bouge plus ; jamais plus de projets en cours que la limite.
  incoherences.push(...(await projetsFigesModifies()), ...(await projetsAuDelaDeLaLimite()));

  incoherences.sort((a, b) => (a.gravite === b.gravite ? a.client.localeCompare(b.client) : a.gravite === "HAUTE" ? -1 : 1));
  return { le: new Date().toISOString(), dureeMs: Date.now() - debut, dossiersControles: dossiers.length, incoherences };
}

/** Les PDF partis de Gmail à enregistrer (écart 3) : la correction en un clic quand le devis du CRM ou le registre donne tout. */
async function devisGmailOublies(dossiers: Map<string, { clientNom: string; leadId: string | null }>): Promise<Incoherence[]> {
  const { devisGmailNonEnregistres, lireDevisGmail } = await import("@/lib/dossiers/devis-gmail");
  const trouvees: Incoherence[] = [];
  for (const candidat of await devisGmailNonEnregistres(prisma)) {
    const dossier = dossiers.get(candidat.dossierId) ?? (await prisma.dossier.findUnique({ where: { id: candidat.dossierId }, select: { clientNom: true, leadId: true } }));
    const le = formatDateCourte(candidat.envoyeLe);
    let correction: string | null = null;
    if (candidat.devisCrm) correction = `Enregistrer le devis ${candidat.devisCrm.numero} comme envoyé depuis Gmail le ${le}`;
    else if (candidat.numero) {
      const registre = (await lireDevisGmail(candidat.dossierId, candidat.pieceId).catch(() => null))?.registre ?? null;
      if (registre?.montant) correction = `Enregistrer le devis ${registre.numero} (${registre.montant.toLocaleString("fr-FR")} € HT, au registre) comme envoyé depuis Gmail le ${le}`;
    }
    trouvees.push({
      cle: `DEVIS_GMAIL_NON_ENREGISTRE:${candidat.pieceId}`,
      code: "DEVIS_GMAIL_NON_ENREGISTRE",
      gravite: "MOYENNE",
      dossierId: candidat.dossierId,
      leadId: dossier?.leadId ?? null,
      client: dossier?.clientNom ?? "Client",
      constat: `Le PDF « ${candidat.nom} », parti de Gmail le ${le} à ${candidat.a || "son adresse"}, ressemble à un devis mais n'est pas dans le dossier : l'étape, l'espace et les relances l'ignorent.${correction ? "" : " Montant à saisir : tâche « Enregistrer comme devis envoyé »."}`,
      correction,
    });
  }
  return trouvees;
}

/**
 * Un dossier clos (perdu, archivé) dont l'espace est encore ouvert. Archivé : son projet reste ouvert dans l'espace
 * (l'archivage le ferme d'ordinaire) ; perdu ou archivé : le lien du client fonctionne alors que TOUS les projets de son
 * espace sont clos (perdus ou archivés). Un projet perdu dans un espace qui a d'autres projets vivants reste affiché
 * « non réalisé », par conception (`figeDuProjet`) : ce n'est pas une incohérence. Un projet encaissé garde le lien
 * (révocation 90 jours après l'encaissement, `espace/revocation.ts`).
 */
async function espacesDeDossiersClos(): Promise<Incoherence[]> {
  const projets = await prisma.espaceClient.findMany({
    where: { dossier: { OR: [{ archiveLe: { not: null } }, { etape: "PERDU" }] } },
    select: {
      id: true, dossierId: true, revoqueLe: true, permanentId: true,
      dossier: { select: { clientNom: true, leadId: true, archiveLe: true, etape: true } },
      permanent: { select: { id: true, revoqueLe: true, fusionneDansId: true, projets: { select: { archiveLe: true, dossier: { select: { archiveLe: true, etape: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const trouvees: Incoherence[] = [];
  const liensVus = new Set<string>();
  for (const p of projets) {
    const ouvert = !p.revoqueLe;
    const fermerProjet = Boolean(p.dossier.archiveLe) && ouvert;
    const lienActif = p.permanent ? !p.permanent.revoqueLe && !p.permanent.fusionneDansId : ouvert;
    const tousClos = p.permanent ? p.permanent.projets.filter((x) => !x.archiveLe).every((x) => x.dossier.archiveLe !== null || x.dossier.etape === "PERDU") : true;
    const desactiver = lienActif && tousClos && !(p.permanent && liensVus.has(p.permanent.id));
    if (p.permanent && desactiver) liensVus.add(p.permanent.id);
    if (!fermerProjet && !desactiver) continue;
    const clos = p.dossier.archiveLe ? "archivé" : "perdu";
    trouvees.push({
      cle: `ESPACE_ACTIF_DOSSIER_CLOS:${p.dossierId}`,
      code: "ESPACE_ACTIF_DOSSIER_CLOS",
      gravite: "HAUTE",
      dossierId: p.dossierId,
      leadId: p.dossier.leadId,
      client: p.dossier.clientNom,
      constat: desactiver
        ? `Le dossier est ${clos}${p.permanent ? " et tous les projets de son espace sont clos" : ""}, mais le lien de son espace client fonctionne encore.`
        : "Le dossier est archivé mais son projet est encore ouvert dans l'espace du client (l'archivage le ferme).",
      correction: !p.permanent || !fermerProjet ? (desactiver ? "Désactiver le lien" : "Fermer le projet dans son espace") : desactiver ? "Fermer le projet et désactiver le lien" : "Fermer le projet dans son espace",
    });
  }
  return trouvees;
}

/** Ce qu'un client peut encore faire sur un projet figé : le regarder, le relire, laisser son avis, écrire. */
const GESTES_PERMIS_SUR_UN_PROJET_FIGE = ["ESPACE_VISITE", "ESPACE_DEVIS_CONSULTE", "ESPACE_AVIS", "ESPACE_MESSAGE", "ESPACE_SIMULATIONS_VUES", "ESPACE_PROJET_DEMANDE", "ESPACE_CONFIRMATION_BLOQUEE"];

/**
 * Un projet terminé (encaissé) ou non réalisé (perdu) se consulte, il ne se
 * modifie plus : un geste du client dans son espace APRÈS la date où le projet
 * s'est figé est une incohérence (l'espace l'aurait refusé ; s'il est passé,
 * c'est un défaut à regarder). Rien à corriger d'office : Lucas lit ce qui a changé.
 */
async function projetsFigesModifies(): Promise<Incoherence[]> {
  const projets = await prisma.espaceClient.findMany({
    where: { archiveLe: null, dossier: { archiveLe: null, etape: { in: ["ENCAISSE", "PERDU"] } } },
    select: { dossierId: true, dossier: { select: { etape: true, clientNom: true, leadId: true } } },
  });
  const trouvees: Incoherence[] = [];
  for (const p of projets) {
    const fige = figeDuProjet(p.dossier.etape);
    const passage = await prisma.dossierEvenement.findFirst({ where: { dossierId: p.dossierId, type: "CHANGEMENT_ETAPE", archiveLe: null, metadata: { contains: `"vers":"${p.dossier.etape}"` } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!passage || !fige) continue;
    const apres = await prisma.dossierEvenement.findFirst({
      where: {
        dossierId: p.dossierId,
        archiveLe: null,
        direction: "ENTRANT",
        createdAt: { gt: passage.createdAt },
        OR: [{ type: { startsWith: "ESPACE_", notIn: GESTES_PERMIS_SUR_UN_PROJET_FIGE } }, { type: "PRESTATIONS" }],
      },
      orderBy: { createdAt: "asc" },
      select: { contenu: true, createdAt: true },
    });
    if (!apres) continue;
    trouvees.push({
      cle: `PROJET_FIGE_MODIFIE:${p.dossierId}`,
      code: "PROJET_FIGE_MODIFIE",
      gravite: "HAUTE",
      dossierId: p.dossierId,
      leadId: p.dossier.leadId,
      client: p.dossier.clientNom,
      constat: `Le projet est ${fige === "TERMINE" ? "terminé et encaissé" : "non réalisé"} depuis le ${passage.createdAt.toLocaleDateString("fr-FR")}, mais l'espace du client l'a encore modifié le ${apres.createdAt.toLocaleDateString("fr-FR")} : « ${apres.contenu.slice(0, 140)} ». Un projet figé ne bouge plus.`,
      correction: null,
    });
  }
  return trouvees;
}

/** Au plus deux projets en cours par espace, plus ceux que Lucas a accordés : au-delà, une incohérence. */
async function projetsAuDelaDeLaLimite(): Promise<Incoherence[]> {
  const permanents = await prisma.espacePermanent.findMany({ where: { archiveLe: null, fusionneDansId: null }, select: { id: true, projetsAccordes: true } });
  const trouvees: Incoherence[] = [];
  for (const permanent of permanents) {
    const projets = await projetsVisibles(prisma, permanent.id);
    const enCours = projets.filter((p) => !figeDuProjet(p.dossier.etape));
    const limite = LIMITE_PROJETS_EN_COURS + permanent.projetsAccordes;
    if (enCours.length <= limite) continue;
    const dernier = enCours.at(-1)!;
    const dossier = await prisma.dossier.findUnique({ where: { id: dernier.dossierId }, select: { clientNom: true, leadId: true } });
    trouvees.push({
      cle: `PROJETS_AU_DELA_DE_LA_LIMITE:${permanent.id}`,
      code: "PROJETS_AU_DELA_DE_LA_LIMITE",
      gravite: "MOYENNE",
      dossierId: dernier.dossierId,
      leadId: dossier?.leadId ?? null,
      client: dossier?.clientNom ?? "Client",
      constat: `Ce client a ${enCours.length} projets en cours dans son espace, pour une limite de ${limite} (${LIMITE_PROJETS_EN_COURS} + ${permanent.projetsAccordes} accordé${permanent.projetsAccordes > 1 ? "s" : ""}).`,
      correction: "Accorder ces projets en cours (la limite suit)",
    });
  }
  return trouvees;
}

/* ── Corriger ──────────────────────────────────────────────────────── */

const RAISON = "contrôle de cohérence";
const OPTIONS_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };

/**
 * Mission 18 (B13) : la trace d'une correction dans l'historique du dossier, pour TOUS les codes (« Contrôle de
 * cohérence : … », événement `COHERENCE_CORRIGEE` avec le code) — dans la transaction de la correction quand elle en a une.
 */
async function tracer(client: Transaction, dossierId: string | null, code: CodeIncoherence, contenu: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!dossierId) return;
  await client.dossierEvenement.create({ data: { dossierId, type: "COHERENCE_CORRIGEE", direction: "INTERNE", contenu: `Contrôle de cohérence : ${contenu}`.slice(0, 1500), metadata: JSON.stringify({ code, ...extra }) } });
}

async function deplacer(dossierId: string, vers: EtapeDossier, nature: "AUTOMATIQUE" | "RETOUR", raison: string, code: CodeIncoherence): Promise<void> {
  const changement = await prisma.$transaction(async (tx) => {
    const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    const ecrit = await appliquerChangementEtape(tx, { dossierId, de: dossier.etape as EtapeDossier, vers, nature, raison });
    await tracer(tx, dossierId, code, `${LIBELLES_ETAPE[ecrit.de]} → ${LIBELLES_ETAPE[vers]} (${raison})`);
    return ecrit;
  });
  await effetsDuChangementEtape(changement);
}

/**
 * Écarts 1 et 6 : le dossier revient d'un bloc à son étape d'avant le devis (celle du dernier passage en « Devis envoyé »,
 * sinon Simulation ou Qualification : `devis-retire.ts › etapeAvantLeDevis`), nature RETOUR (pas de Meta), statut du lead
 * dans la transaction, mails de relance en attente annulés, trace, puis le point d'entrée : « Refaire le devis » (plus
 * de devis) ou « Envoyer le devis au client » (jamais parti), main écrite. Un devis annulé donne la main « Devis N
 * annulé : refaire le devis » (comme B6).
 */
async function revenirAvantLeDevis(dossierId: string, code: "DEVIS_ENVOYE_SANS_DEVIS_ACTIF" | "DEVIS_ENVOYE_SANS_ENVOI"): Promise<void> {
  const suites = await prisma.$transaction(async (tx): Promise<Suites> => {
    const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    if (!dossier || !estEtape(dossier.etape) || !ETAPES_RETOUR_DEVIS.includes(dossier.etape)) throw new ErreurMetier("Le dossier n'est plus en « Devis envoyé » ni en « Relance » : rien à corriger.", 409);
    const devis = await tx.document.findMany({ where: { dossierId, type: "DEVIS", numero: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true, statut: true } });
    if (devis.some((d) => d.statut === "ACCEPTE")) throw new ErreurMetier("Un devis est accepté sur ce dossier : rien à corriger ici.", 409);
    const sansDevis = code === "DEVIS_ENVOYE_SANS_DEVIS_ACTIF";
    const annule = sansDevis ? devis.find((d) => d.statut === "ANNULEE") : undefined;
    const vers = await etapeAvantLeDevis(tx, dossierId);
    const raison = `${RAISON} : ${sansDevis ? "aucun devis n'attend sa réponse" : "aucun devis n'est parti chez le client"}`;
    const changement = await appliquerChangementEtape(tx, { dossierId, de: dossier.etape, vers, nature: "RETOUR", raison, ...(annule?.numero ? { devisRetire: { numero: annule.numero, geste: "ANNULE" as const } } : {}) });
    await ecrireStatutLead(tx, dossierId, vers);
    marquerSynchronise(changement);
    const relances = await annulerRelancesEnAttente(tx, devis.map((d) => d.id));
    await tracer(tx, dossierId, code, `${LIBELLES_ETAPE[dossier.etape]} → ${LIBELLES_ETAPE[vers]}, ${sansDevis ? "aucun devis n'attend sa réponse : refaire le devis" : `aucun devis n'est parti chez le client (${devis.filter((d) => d.statut === "GENERE" || d.statut === "ENVOYE").map((d) => d.numero).join(", ")}) : il reste à l'envoyer`}${relances ? ` ; ${pluriel(relances, "mail de relance annulé", "mails de relance annulés")}` : ""}`, { de: dossier.etape, vers });
    const appliquees = await appliquerEvenementDossier(tx, dossierId, { type: "CORRECTION_COHERENCE", code });
    return { ...appliquees, changements: [changement] };
  }, OPTIONS_TRANSACTION);
  await suitesEvenementDossier(suites);
}

/**
 * Écart 5 : le devis visible jamais annoncé est mis en ligne pour de bon, comme par l'interrupteur du bloc Espace (B5) :
 * « Devis envoyé » qui date l'envoi (relances depuis aujourd'hui), Relance → Devis envoyé, point d'entrée (« Attendre
 * l'accord »), trace ; puis le mail « Devis disponible » (automatisme existant, une fois par devis, interrupteur gardé).
 */
async function annoncerDevisVisible(dossierId: string): Promise<string> {
  const devis = await prisma.document.findFirst({ where: { dossierId, type: "DEVIS", numero: { not: null }, statut: "GENERE", visibleEspace: true, origine: { not: "REPRISE" } }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true, origine: true, statut: true } });
  if (!devis?.numero) throw new ErreurMetier("Plus de devis visible à annoncer sur ce dossier.", 409);
  const numero = devis.numero;
  const suites = await prisma.$transaction(async (tx) => {
    const ecrites = await mettreEnLigneDevis(tx, dossierId, { id: devis.id, numero }, `Devis ${numero} : visible dans l'espace client, annoncé au client (contrôle de cohérence)`);
    await tracer(tx, dossierId, "DEVIS_VISIBLE_NON_NOTIFIE", `devis ${numero} visible dans son espace mais jamais annoncé : le client est prévenu (« Devis disponible »), relances comptées depuis aujourd'hui`, { documentId: devis.id });
    return ecrites;
  }, OPTIONS_TRANSACTION);
  await suitesEvenementDossier(suites);
  return phraseAnnonce(await annoncerDevisEnLigne(dossierId, devis));
}

/** Écart 3 : le PDF parti de Gmail enregistré comme devis envoyé, par la même fonction que la tâche (B3), quand tout est connu. */
async function enregistrerDevisGmailOublie(dossierId: string, pieceId: string): Promise<void> {
  const { enregistrerDevisGmail, lireDevisGmail } = await import("@/lib/dossiers/devis-gmail");
  const lu = await lireDevisGmail(dossierId, pieceId);
  const numero = lu.devisCrm?.numero ?? (lu.registre?.montant ? lu.registre.numero : null);
  if (!numero) throw new ErreurMetier("Le montant de ce devis n'est pas connu : l'enregistrer depuis la tâche « Enregistrer comme devis envoyé ».", 400);
  const resultat = await enregistrerDevisGmail(dossierId, { messageId: lu.messageId, pieceId, numero, montant: lu.devisCrm ? null : lu.registre!.montant, inscrireAuRegistre: false });
  if (!resultat.deja) await tracer(prisma, dossierId, "DEVIS_GMAIL_NON_ENREGISTRE", `PDF « ${lu.nom} » parti de Gmail le ${formatDateCourte(lu.envoyeLe)} enregistré comme devis ${resultat.numero} envoyé`, { pieceId, documentId: resultat.documentId });
}

/** Écart 7 : le devis émis après la signature, envoyé par mail avec le texte type (le bouton « Envoyer par mail » du dossier, B2). */
async function envoyerAvenant(dossierId: string): Promise<string> {
  const signe = await prisma.document.findFirst({ where: { dossierId, type: "DEVIS", numero: { not: null }, statut: "ACCEPTE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const aEnvoyer = new Set((await devisAEnvoyer(prisma, [dossierId])).map((d) => d.documentId));
  const avenants = signe ? await prisma.document.findMany({ where: { dossierId, type: "DEVIS", numero: { not: null }, statut: "GENERE", origine: { not: "REPRISE" }, createdAt: { gt: signe.createdAt } }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true } }) : [];
  const avenant = avenants.find((d) => !aEnvoyer.has(d.id));
  if (!avenant) throw new ErreurMetier("Plus de devis émis après la signature à proposer sur ce dossier.", 409);
  const { brouillonEnvoiDocument, envoyerDocumentParMail, schemaEnvoiDocument } = await import("@/lib/mail/service");
  const entree = schemaEnvoiDocument.safeParse(await brouillonEnvoiDocument(dossierId, avenant.id));
  if (!entree.success) throw new ErreurMetier("Aucune adresse e-mail valide pour ce client : lui faire signer le devis autrement.", 409);
  const envoi = await envoyerDocumentParMail(dossierId, avenant.id, entree.data);
  if (envoi.deja) return `le devis ${avenant.numero} est déjà en cours d'envoi par mail : rien de plus ne part`;
  await tracer(prisma, dossierId, "AVENANT_NON_PROPOSE", `devis ${avenant.numero}, émis après la signature, envoyé par mail à ${entree.data.a} (texte type)`, { documentId: avenant.id, propositionId: envoi.proposition.id });
  return `devis ${avenant.numero} envoyé par mail à ${entree.data.a}`;
}

/** Date du chantier posée en « Signé » : Signé → Planifié d'un bloc (lead CHANTIER_PLANIFIE ; « fixer la date du chantier » s'efface). */
async function planifierDateDejaPosee(dossierId: string): Promise<void> {
  const suites = await prisma.$transaction(async (tx): Promise<Suites> => {
    const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true, dateChantier: true } });
    if (dossier?.etape !== "SIGNE" || !dossier.dateChantier) throw new ErreurMetier("Le dossier n'est plus « Signé » avec une date de chantier : rien à corriger.", 409);
    const date = formatDateCourte(dossier.dateChantier);
    const changement = await appliquerChangementEtape(tx, { dossierId, de: "SIGNE", vers: "PLANIFIE", nature: "AUTOMATIQUE", raison: `${RAISON} : date du chantier déjà posée (${date})` });
    await ecrireStatutLead(tx, dossierId, "PLANIFIE");
    marquerSynchronise(changement);
    await tracer(tx, dossierId, "DATE_CHANTIER_EN_SIGNE", `date du chantier posée (${date}) : Signé → Planifié`);
    const appliquees = await appliquerEvenementDossier(tx, dossierId, { type: "CORRECTION_COHERENCE", code: "DATE_CHANTIER_EN_SIGNE" });
    return { ...appliquees, changements: [changement] };
  }, OPTIONS_TRANSACTION);
  await suitesEvenementDossier(suites);
}

/** « Attendre l'accord » sans devis : effacée par le point d'entrée (jamais une action posée à la main). */
async function effacerAttenteSansDevis(dossierId: string): Promise<void> {
  const suites = await prisma.$transaction(async (tx) => {
    const avant = (await tx.dossier.findUnique({ where: { id: dossierId }, select: { prochaineAction: true } }))?.prochaineAction ?? "";
    const appliquees = await appliquerEvenementDossier(tx, dossierId, { type: "CORRECTION_COHERENCE", code: "ATTENTE_ACCORD_SANS_DEVIS" });
    if (appliquees.prochaineAction !== "ECRITE") throw new ErreurMetier("La prochaine action a changé (ou elle est posée à la main) : rien à effacer.", 409);
    await tracer(tx, dossierId, "ATTENTE_ACCORD_SANS_DEVIS", `prochaine action « ${avant} » effacée (aucun devis n'attend sa réponse)`);
    return appliquees;
  }, OPTIONS_TRANSACTION);
  await suitesEvenementDossier(suites);
}

/**
 * Espace d'un dossier clos : le projet d'un dossier archivé fermé dans l'espace (comme l'archivage) ; le lien du client
 * désactivé si tous ses projets sont clos (rien n'est effacé : un nouveau lien le rouvre). Aucun envoi.
 */
async function fermerEspaceDeDossierClos(dossierId: string): Promise<void> {
  const projet = await prisma.espaceClient.findFirst({
    where: { dossierId },
    select: { id: true, revoqueLe: true, dossier: { select: { archiveLe: true, etape: true } }, permanent: { select: { id: true, revoqueLe: true, fusionneDansId: true, projets: { select: { archiveLe: true, dossier: { select: { archiveLe: true, etape: true } } } } } } },
  });
  if (!projet || (!projet.dossier.archiveLe && projet.dossier.etape !== "PERDU")) throw new ErreurMetier("Le dossier n'est plus clos : rien à corriger.", 409);
  const fait: string[] = [];
  const maintenant = new Date();
  if (!projet.revoqueLe && (projet.dossier.archiveLe || !projet.permanent)) {
    await prisma.espaceClient.update({ where: { id: projet.id }, data: { revoqueLe: maintenant } });
    fait.push(projet.permanent ? "projet fermé dans son espace" : "lien de son espace désactivé");
  }
  const permanent = projet.permanent;
  if (permanent && !permanent.revoqueLe && !permanent.fusionneDansId && permanent.projets.filter((x) => !x.archiveLe).every((x) => x.dossier.archiveLe !== null || x.dossier.etape === "PERDU")) {
    await desactiverLien(permanent.id, `${RAISON} : tous ses projets sont clos`);
    fait.push("lien de son espace désactivé (tous ses projets sont clos)");
  }
  if (fait.length === 0) throw new ErreurMetier("L'espace de ce dossier est déjà fermé : rien à corriger.", 409);
  await tracer(prisma, dossierId, "ESPACE_ACTIF_DOSSIER_CLOS", `dossier ${projet.dossier.archiveLe ? "archivé" : "perdu"} : ${fait.join(", ")} (rien n'est effacé ; un nouveau lien le rouvre)`);
}

/**
 * Corrige UNE incohérence, celle que Lucas vient de lire. Le contrôle est
 * rejoué d'abord : si elle a disparu entre-temps, rien n'est fait. Chaque
 * correction passe par les fonctions du métier (changement d'étape tracé,
 * dévalidation tracée) : l'historique du dossier dit « contrôle de cohérence ».
 */
export async function corrigerIncoherence(cle: string): Promise<{ corrigee: boolean; message: string }> {
  try {
    return await corrigerUneIncoherence(cle);
  } finally {
    // Mission 17 (partie A) : le détecteur de tâches garde le contrôle une heure ; une correction (ou une incohérence
    // déjà disparue) le rend périmé, et la tâche « Corriger » doit se cocher tout de suite. Import à l'exécution : le
    // détecteur importe ce module.
    try {
      const [{ invaliderCoherence }, { signalerChangementTaches }] = await Promise.all([import("@/lib/a-faire/detecteurs/coherence"), import("@/lib/a-faire/signal")]);
      invaliderCoherence();
      await signalerChangementTaches();
    } catch (erreur) {
      console.error("[coherence] tâches non prévenues de la correction :", erreur);
    }
  }
}

async function corrigerUneIncoherence(cle: string): Promise<{ corrigee: boolean; message: string }> {
  const rapport = await controlerCoherence();
  const incoherence = rapport.incoherences.find((i) => i.cle === cle);
  if (!incoherence) return { corrigee: false, message: "Cette incohérence n'existe plus : rien à corriger." };
  return appliquerCorrection(incoherence);
}

/**
 * Mission 18 (B13) : applique la correction d'une incohérence déjà lue, SANS rejouer le contrôle (la mise en route en
 * applique plusieurs d'un seul passage ; `corrigerIncoherence` rejoue d'abord pour Lucas). Chaque correction relit ce
 * qu'elle touche et refuse (409) si le dossier a bougé depuis. Ne prévient ni le détecteur de tâches ni l'agenda en bloc :
 * l'appelant le fait (`corrigerIncoherence`, la mise en route).
 */
export async function appliquerCorrection(incoherence: Incoherence): Promise<{ corrigee: boolean; message: string }> {
  if (!incoherence.correction) throw new ErreurMetier("Cette incohérence se règle à la main, depuis le dossier.", 400);
  const dossierId = incoherence.dossierId;
  const code = incoherence.code;
  let detail: string | null = null;
  switch (code) {
    case "ACCORD_SANS_SIGNATURE":
    case "PAIEMENT_AVANT_SIGNATURE": {
      // Mission 18 (B10) : le devis signé est celui de l'accord, ou celui que règlent les acomptes (à défaut le plus récent) ;
      // les autres variantes passent « non retenu » (il n'en signe qu'un), d'un bloc avec le passage en « Signé ».
      const changement = await prisma.$transaction(async (tx) => {
        const enVigueur = { dossierId: dossierId!, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } };
        const cible =
          code === "ACCORD_SANS_SIGNATURE"
            ? ((await tx.accordDevis.findFirst({ where: { dossierId: dossierId!, retireLe: null }, orderBy: { createdAt: "desc" }, select: { documentId: true } }))?.documentId ?? null)
            : await devisDesAcomptes(tx, dossierId!);
        const devis =
          (cible ? await tx.document.findFirst({ where: { ...enVigueur, id: cible }, select: { id: true, statut: true, numero: true } }) : null) ??
          (await tx.document.findFirst({ where: enVigueur, orderBy: { createdAt: "desc" }, select: { id: true, statut: true, numero: true } }));
        if (!devis) throw new ErreurMetier("Aucun devis en vigueur sur ce dossier.", 409);
        if (devis.statut !== "ACCEPTE") await tx.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
        const nonRetenus = await retenirDevis(tx, dossierId!, devis.id);
        const dossier = await tx.dossier.findUniqueOrThrow({ where: { id: dossierId! }, select: { etape: true } });
        const raison = [`${RAISON} : ${code === "ACCORD_SANS_SIGNATURE" ? "bon pour accord donné dans l'espace client" : "paiement reçu"}`, suiteNonRetenus(nonRetenus)].filter(Boolean).join(" ; ");
        const ecrit = await appliquerChangementEtape(tx, { dossierId: dossierId!, de: dossier.etape as EtapeDossier, vers: "SIGNE", nature: "AUTOMATIQUE", raison, documentId: devis.id });
        await tracer(tx, dossierId, code, `${LIBELLES_ETAPE[ecrit.de]} → Signé sur le devis ${devis.numero} (${code === "ACCORD_SANS_SIGNATURE" ? "bon pour accord donné dans l'espace client" : "paiement reçu"})`, { documentId: devis.id });
        return ecrit;
      }, OPTIONS_TRANSACTION);
      await effetsDuChangementEtape(changement);
      break;
    }
    case "DEVIS_ACCEPTE_AVANT_SIGNE": {
      // Mission 18 (B4) : comme un dépôt « accepté » (documents-existants.ts), par la même fonction et d'un bloc.
      const devis = await prisma.document.findFirst({ where: { dossierId: dossierId!, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: "ACCEPTE" }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true } });
      if (!devis) throw new ErreurMetier("Aucun devis accepté sur ce dossier.", 409);
      const suites = await prisma.$transaction(async (tx) => {
        const signe = await signerParDevisAccepte(tx, dossierId!, devis.id, `${RAISON} : devis ${devis.numero} noté « accepté » (signé hors ligne)`);
        if (!signe) throw new ErreurMetier("Le dossier n'est plus à une étape d'avant « Signé » : rien à corriger.", 409);
        await tracer(tx, dossierId, code, `devis ${devis.numero} « accepté » (signé hors ligne), le dossier passe en « Signé »`, { documentId: devis.id });
        return { ...(await appliquerEvenementDossier(tx, dossierId!, { type: "DEVIS_ACCEPTE", documentId: devis.id })), changements: [signe.changement] };
      }, OPTIONS_TRANSACTION);
      await suitesEvenementDossier(suites);
      break;
    }
    case "SIGNE_SANS_DEVIS_ACCEPTE": {
      const devis = await prisma.document.findFirst({ where: { dossierId: dossierId!, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true } });
      if (!devis) throw new ErreurMetier("Aucun devis émis sur ce dossier.", 409);
      await prisma.$transaction(async (tx) => {
        await tx.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
        await tracer(tx, dossierId, code, `devis ${devis.numero} noté « accepté » (le dossier est signé)`, { documentId: devis.id });
      });
      break;
    }
    case "ETAPE_ET_SOLDE": {
      const changement = await prisma.$transaction(async (tx) => {
        const ecrit = await suivreSoldeDossier(tx, dossierId!, RAISON, true);
        if (ecrit) await tracer(tx, dossierId, code, `${LIBELLES_ETAPE[ecrit.de]} → ${LIBELLES_ETAPE[ecrit.vers]} (le solde des factures le dit)`);
        return ecrit;
      });
      if (changement) await effetsDuChangementEtape(changement);
      break;
    }
    case "PROJET_VALIDE_INCOMPLET": {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: dossierId! } });
      if (espace) await devaliderProjet(espace, "LUCAS", RAISON);
      await tracer(prisma, dossierId, code, "projet incomplet dévalidé (le client le complète et le revalide)");
      break;
    }
    case "PROJET_VALIDE_SANS_AVANCER":
      await deplacer(dossierId!, "SIMULATION", "AUTOMATIQUE", RAISON_PROJET_VALIDE, code);
      break;
    case "CHOIX_SANS_SIMULATION": {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: dossierId! } });
      if (espace) await devaliderChoix(espace, "LUCAS");
      await tracer(prisma, dossierId, code, "choix d'une simulation qu'il ne voit plus dévalidé");
      break;
    }
    case "PROCHAINE_ACTION_PERIMEE": {
      // Mission 13 (B1) : un devis en vigueur → « Attendre l'accord du client sur le devis » ; sinon l'action s'efface.
      const devis = await prisma.document.findFirst({ where: { dossierId: dossierId!, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, select: { id: true } });
      const actuelle = (await prisma.dossier.findUnique({ where: { id: dossierId! }, select: { prochaineAction: true } }))?.prochaineAction ?? "";
      const suite = devis && /préparer le devis/i.test(actuelle) ? PROCHAINE_ACTION_APRES_DEVIS : null;
      await prisma.dossier.update({ where: { id: dossierId! }, data: { prochaineAction: suite, prochaineActionDate: null } });
      await synchroniserRappel({ type: "DOSSIER", id: dossierId! });
      await tracer(prisma, dossierId, code, suite ? `prochaine action « ${actuelle} » remplacée par « ${suite} » (le devis est rattaché)` : `prochaine action « ${actuelle} » effacée (plus aucune simulation validée)`);
      break;
    }
    case "STATUT_DU_LEAD": {
      const dossier = await prisma.dossier.findFirst({ where: { id: dossierId!, ...AVEC_ARCHIVES }, select: { etape: true, leadId: true, lead: { select: { statut: true } } } });
      const statut = dossier ? STATUT_LEAD_ATTENDU[dossier.etape as EtapeDossier]?.[0] : null;
      if (dossier?.leadId && statut) {
        await prisma.lead.update({ where: { id: dossier.leadId }, data: { statut } });
        await tracer(prisma, dossierId, code, `lead aligné sur « ${statut} » (il était « ${dossier.lead?.statut ?? "?"} »)`);
      }
      break;
    }
    case "SIMULATIONS_HORS_DOSSIER": {
      const { ouvrirDossierAutomatique } = await import("@/lib/dossiers/depuis-lead");
      await ouvrirDossierAutomatique(incoherence.leadId!);
      await tracer(prisma, dossierId, code, "simulations du site rangées dans le dossier");
      break;
    }
    case "PROJETS_AU_DELA_DE_LA_LIMITE": {
      const permanentId = incoherence.cle.split(":")[1];
      const projets = await projetsVisibles(prisma, permanentId);
      const enCours = projets.filter((p) => !figeDuProjet(p.dossier.etape)).length;
      const { accorderProjets } = await import("@/lib/espace/projets");
      const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanentId }, select: { projetsAccordes: true } });
      const manque = enCours - (LIMITE_PROJETS_EN_COURS + permanent.projetsAccordes);
      if (manque > 0) {
        await accorderProjets(permanentId, Math.min(5, manque));
        await tracer(prisma, dossierId, code, `${pluriel(Math.min(5, manque), "projet en cours accordé", "projets en cours accordés")} (la limite suit)`);
      }
      break;
    }
    case "MAIN_DECALEE": {
      const main = await recalculerMain(dossierId);
      await tracer(prisma, dossierId, code, `main remise « ${main?.qui === "MOI" ? "à moi" : main?.qui === "CLIENT" ? "chez le client" : "à personne"} » partout${main?.motif ? ` (${main.motif})` : ""}`);
      break;
    }
    // Mission 18 (B13).
    case "DEVIS_ENVOYE_SANS_ENVOI":
    case "DEVIS_ENVOYE_SANS_DEVIS_ACTIF":
      await revenirAvantLeDevis(dossierId!, code);
      break;
    case "DEVIS_VISIBLE_NON_NOTIFIE":
      detail = await annoncerDevisVisible(dossierId!);
      break;
    case "DEVIS_GMAIL_NON_ENREGISTRE":
      await enregistrerDevisGmailOublie(dossierId!, incoherence.cle.split(":")[1]);
      break;
    case "AVENANT_NON_PROPOSE":
      detail = await envoyerAvenant(dossierId!);
      break;
    case "ATTENTE_ACCORD_SANS_DEVIS":
      await effacerAttenteSansDevis(dossierId!);
      break;
    case "DATE_CHANTIER_EN_SIGNE":
      await planifierDateDejaPosee(dossierId!);
      break;
    case "ESPACE_ACTIF_DOSSIER_CLOS":
      await fermerEspaceDeDossierClos(dossierId!);
      break;
    default:
      throw new ErreurMetier("Cette incohérence se règle à la main, depuis le dossier.", 400);
  }
  return { corrigee: true, message: `Corrigé : ${incoherence.correction.toLowerCase()}.${detail ? ` ${detail.replace(/^./, (c) => c.toUpperCase()).replace(/\.?$/, ".")}` : ""}` };
}

/** Passage automatique (démarrage, puis chaque jour) : le téléphone sonne seulement s'il y a quelque chose à lire. */
export async function controleAutomatique(): Promise<RapportCoherence> {
  const rapport = await controlerCoherence();
  console.log(`[coherence] ${pluriel(rapport.dossiersControles, "dossier contrôlé", "dossiers contrôlés")} en ${rapport.dureeMs} ms : ${pluriel(rapport.incoherences.length, "incohérence")}${rapport.incoherences.length ? ` — ${rapport.incoherences.map((i) => `${i.code}:${i.dossierId ?? i.leadId}`).join(", ")}` : ""}`);
  if (rapport.incoherences.length > 0) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
    const hautes = rapport.incoherences.filter((i) => i.gravite === "HAUTE").length;
    await alerter(
      { titre: `${rapport.incoherences.length} incohérence${rapport.incoherences.length > 1 ? "s" : ""} dans le CRM`, texte: `${rapport.incoherences.slice(0, 4).map((i) => `• ${i.client} : ${i.constat}`).join("\n")}${rapport.incoherences.length > 4 ? `\n… et ${pluriel(rapport.incoherences.length - 4, "autre")}.` : ""}`, lien: `${appUrl}${ADRESSE_SYSTEME}`, libelleLien: "Voir et corriger", urgence: hautes > 0 ? 4 : 2, etiquette: `coherence-${new Date().toISOString().slice(0, 10)}` },
      { origine: "coherence", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch(() => undefined);
  }
  return rapport;
}
