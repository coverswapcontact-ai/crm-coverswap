import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { alerter } from "@/lib/alertes/canaux";
import { ETAPES, LIBELLES_ETAPE, REGLES_ETAPES, type EtapeDossier } from "@/lib/dossiers/constants";
import { calculerMain, recalculerMain } from "@/lib/dossiers/main";
import { appliquerChangementEtape, effetsDuChangementEtape } from "@/lib/dossiers/transitions";
import { suivreSoldeDossier } from "@/lib/encaissements/service";
import { faitsPaiements } from "@/lib/encaissements/soldes";
import { dateSignature, lireDevisEtPaiements } from "@/lib/espace/faits";
import { lireProjet, projetComplet } from "@/lib/espace/projet";
import { lireSelection } from "@/lib/prestations/prestations";
import { devaliderChoix, devaliderProjet, RAISON_PROJET_VALIDE } from "@/lib/espace/validations";
import { figeDuProjet, LIMITE_PROJETS_EN_COURS, projetsVisibles } from "@/lib/espace/projets";

/**
 * Contrôle de cohérence : chaque section du CRM dit une partie de la vérité sur
 * un client ; ce contrôle vérifie qu'elles disent LA MÊME. Il parcourt tous les
 * dossiers vivants et compare l'étape du dossier, l'état de l'espace client,
 * les documents, les encaissements et le lead d'origine (docs/COHERENCE.md en
 * donne la matrice). Lecture seule ; chaque incohérence dit ce qu'elle est,
 * pourquoi elle compte, et — quand la correction est sans risque — propose un
 * bouton « Corriger » (`corrigerIncoherence`). Tourne au démarrage et une fois
 * par jour (taches.ts) ; Tâches de fond l'affiche et le relance à la demande.
 */

export type CodeIncoherence =
  | "DEVIS_MONTANT_NUL"
  | "ACCORD_SANS_SIGNATURE"
  | "DEVIS_ACCEPTE_AVANT_SIGNE"
  | "SIGNE_SANS_DEVIS_ACCEPTE"
  | "PAIEMENT_AVANT_SIGNATURE"
  | "ETAPE_ET_SOLDE"
  | "PROJET_VALIDE_INCOMPLET"
  | "PROJET_VALIDE_SANS_AVANCER"
  | "CHOIX_SANS_SIMULATION"
  | "PROCHAINE_ACTION_PERIMEE"
  | "STATUT_DU_LEAD"
  | "LEAD_A_PLUSIEURS_DOSSIERS"
  | "ESPACE_ACTIF_DOSSIER_ARCHIVE"
  | "SIMULATIONS_HORS_DOSSIER"
  // Mission 5 (22/09/2026) : l'espace permanent et ses projets.
  | "PROJET_FIGE_MODIFIE"
  | "PROJETS_AU_DELA_DE_LA_LIMITE"
  // Mission 6 (22/09/2026) : qui a la main, une seule règle (dossiers/main.ts).
  | "MAIN_DECALEE"
  // Mission 7 (22/09/2026) : un mail du client resté sans réponse alors que le dossier dit « chez le client ».
  | "MAIL_SANS_REPONSE";

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

export async function controlerCoherence(): Promise<RapportCoherence> {
  const debut = Date.now();
  const incoherences: Incoherence[] = [];
  const dossiers = await prisma.dossier.findMany({
    where: { etape: { not: "PERDU" } },
    select: {
      id: true, clientNom: true, etape: true, prochaineAction: true, leadId: true, prestations: true, main: true, mainMotif: true,
      lead: { select: { id: true, statut: true, typeProjet: true, archiveLe: true } },
      documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" } },
      accords: true,
      encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
      espaces: { select: { id: true, souhaits: true, projetValideLe: true, choix: true, choixLe: true, propositionDemandeeLe: true, revoqueLe: true, simulations: { where: { archiveLe: null }, select: { id: true, statut: true } } } },
    },
  });

  for (const d of dossiers) {
    const signaler = (code: CodeIncoherence, gravite: Incoherence["gravite"], constat: string, correction: string | null) =>
      incoherences.push({ cle: `${code}:${d.id}`, code, gravite, dossierId: d.id, leadId: d.leadId, client: d.clientNom, constat, correction });
    const lecture = lireDevisEtPaiements({ devis: d.documents, accords: d.accords, encaissements: d.encaissements, clientNom: d.clientNom, signeLe: dateSignature(d.evenements) });
    const espace = d.espaces[0] ?? null;
    const active = estActive(d.etape);
    const avantSigne = active && rang(d.etape) < rang("SIGNE");

    // Documents ↔ espace : le « 0 € ».
    if (lecture.devis && lecture.montants && lecture.montants.totalTtcCentimes <= 0) {
      signaler("DEVIS_MONTANT_NUL", "HAUTE", `Le devis ${lecture.devis.numero} vaut 0 € : le client lit « 0 € » dans son espace. Corriger le montant du document (dossier → Documents).`, null);
    }
    // Espace ↔ dossier : accord, signature.
    const accordEnLigne = d.accords.some((a) => !a.retireLe);
    if (accordEnLigne && avantSigne) {
      signaler("ACCORD_SANS_SIGNATURE", "HAUTE", `Le client a donné son bon pour accord dans son espace, mais le dossier est encore en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} ».`, "Passer le dossier en « Signé » (le devis devient « accepté »)");
    } else if (!accordEnLigne && avantSigne && d.documents.some((doc) => doc.statut === "ACCEPTE")) {
      signaler("DEVIS_ACCEPTE_AVANT_SIGNE", "MOYENNE", `Un devis est noté « accepté » alors que le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » : l'espace du client le croit signé.`, "Remettre le devis en « émis » (le dossier ne bouge pas)");
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
      signaler("PROCHAINE_ACTION_PERIMEE", "MOYENNE", `Prochaine action « ${action} » alors que ${lecture.devis ? "le devis est déjà émis" : "plus aucune simulation n'est validée"}.`, "Effacer cette prochaine action");
    } else if (espace && /autre proposition/i.test(action) && !espace.propositionDemandeeLe) {
      signaler("PROCHAINE_ACTION_PERIMEE", "MOYENNE", `Prochaine action « ${action} » alors qu'aucune demande n'est en attente dans l'espace du client.`, "Effacer cette prochaine action");
    }
    // Leads ↔ dossiers.
    const attendus = STATUT_LEAD_ATTENDU[d.etape as EtapeDossier];
    if (d.lead && !d.lead.archiveLe && attendus && !attendus.includes(d.lead.statut)) {
      signaler("STATUT_DU_LEAD", "MOYENNE", `Le dossier est en « ${LIBELLES_ETAPE[d.etape as EtapeDossier]} » mais son lead est resté « ${d.lead.statut} » : la section Leads et la publicité ne racontent pas la même histoire.`, `Aligner le lead sur « ${attendus[0]} »`);
    }
    // Qui a la main : ce que le dossier affiche (kanban, fiche, Espaces clients, Leads) ↔ ce que disent ses derniers gestes.
    const regle = await calculerMain(d.id);
    const responsable = REGLES_ETAPES[d.etape as EtapeDossier]?.responsable ?? null;
    const affichee = d.main === "MOI" || d.main === "CLIENT" ? d.main : responsable;
    if (regle?.qui && affichee && regle.qui !== affichee) {
      const dire = (qui: string) => (qui === "MOI" ? "à moi" : "chez le client");
      signaler("MAIN_DECALEE", "MOYENNE", `Le dossier affiche « ${dire(affichee)} » alors que ses derniers gestes le mettent « ${dire(regle.qui)} » (${regle.motif}).`, `Remettre « ${dire(regle.qui)} » partout`);
    }
    // Mail du client sans réponse : il a écrit, personne n'a répondu depuis, et le dossier le croit « chez le client ».
    if ((regle?.qui ?? affichee) === "CLIENT") {
      const mails = await prisma.dossierEvenement.findMany({ where: { dossierId: d.id, archiveLe: null, type: { in: ["MAIL_RECU", "MAIL_ENVOYE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true, survenuLe: true, contenu: true } });
      const dernier = mails[0];
      const depuis = dernier ? Date.now() - (dernier.survenuLe ?? dernier.createdAt).getTime() : 0;
      if (dernier?.type === "MAIL_RECU" && depuis > JOURS_MAIL_SANS_REPONSE * 86_400_000) {
        signaler("MAIL_SANS_REPONSE", "HAUTE", `Le client a écrit il y a ${Math.floor(depuis / 86_400_000)} jours (${dernier.contenu.slice(0, 120)}) et n'a pas eu de réponse, alors que le dossier dit « chez le client ». Lui répondre depuis l'onglet Mail.`, null);
      }
    }
  }

  // Un lead, un seul dossier vivant.
  const parLead = new Map<string, typeof dossiers>();
  for (const d of dossiers) if (d.leadId && !["ENCAISSE"].includes(d.etape)) parLead.set(d.leadId, [...(parLead.get(d.leadId) ?? []), d]);
  for (const [leadId, liste] of parLead) {
    if (liste.length > 1) incoherences.push({ cle: `LEAD_A_PLUSIEURS_DOSSIERS:${leadId}`, code: "LEAD_A_PLUSIEURS_DOSSIERS", gravite: "MOYENNE", dossierId: liste[0].id, leadId, client: liste[0].clientNom, constat: `Ce contact a ${liste.length} dossiers en cours : un seul dossier par projet. Archiver celui qui fait doublon (dossier → Archiver).`, correction: null });
  }

  // Espaces encore actifs de dossiers archivés ; simulations restées hors du dossier que le contact a pourtant.
  const orphelins = await prisma.espaceClient.findMany({ where: { revoqueLe: null, permanentId: null, dossier: { archiveLe: { not: null } } }, select: { id: true, dossierId: true, dossier: { select: { clientNom: true, leadId: true } } } });
  for (const e of orphelins) incoherences.push({ cle: `ESPACE_ACTIF_DOSSIER_ARCHIVE:${e.dossierId}`, code: "ESPACE_ACTIF_DOSSIER_ARCHIVE", gravite: "HAUTE", dossierId: e.dossierId, leadId: e.dossier.leadId, client: e.dossier.clientNom, constat: "Le dossier est archivé mais le lien de son espace client fonctionne encore.", correction: "Désactiver le lien" });
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

async function deplacer(dossierId: string, vers: EtapeDossier, nature: "AUTOMATIQUE" | "RETOUR", raison: string, documentId?: string): Promise<void> {
  const changement = await prisma.$transaction(async (tx) => {
    const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    return appliquerChangementEtape(tx, { dossierId, de: dossier.etape as EtapeDossier, vers, nature, raison, documentId });
  });
  await effetsDuChangementEtape(changement);
}

/**
 * Corrige UNE incohérence, celle que Lucas vient de lire. Le contrôle est
 * rejoué d'abord : si elle a disparu entre-temps, rien n'est fait. Chaque
 * correction passe par les fonctions du métier (changement d'étape tracé,
 * dévalidation tracée) : l'historique du dossier dit « contrôle de cohérence ».
 */
export async function corrigerIncoherence(cle: string): Promise<{ corrigee: boolean; message: string }> {
  const rapport = await controlerCoherence();
  const incoherence = rapport.incoherences.find((i) => i.cle === cle);
  if (!incoherence) return { corrigee: false, message: "Cette incohérence n'existe plus : rien à corriger." };
  if (!incoherence.correction) throw new ErreurMetier("Cette incohérence se règle à la main, depuis le dossier.", 400);
  const dossierId = incoherence.dossierId;
  const RAISON = "contrôle de cohérence";
  switch (incoherence.code) {
    case "ACCORD_SANS_SIGNATURE":
    case "PAIEMENT_AVANT_SIGNATURE": {
      const devis = await prisma.document.findFirst({ where: { dossierId: dossierId!, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, select: { id: true, statut: true } });
      if (!devis) throw new ErreurMetier("Aucun devis en vigueur sur ce dossier.", 409);
      if (devis.statut !== "ACCEPTE") await prisma.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
      await deplacer(dossierId!, "SIGNE", "AUTOMATIQUE", `${RAISON} : ${incoherence.code === "ACCORD_SANS_SIGNATURE" ? "bon pour accord donné dans l'espace client" : "paiement reçu"}`, devis.id);
      break;
    }
    case "DEVIS_ACCEPTE_AVANT_SIGNE":
      await prisma.document.updateMany({ where: { dossierId: dossierId!, type: "DEVIS", statut: "ACCEPTE" }, data: { statut: "GENERE" } });
      await prisma.dossierEvenement.create({ data: { dossierId: dossierId!, type: "COHERENCE_CORRIGEE", direction: "INTERNE", contenu: "Contrôle de cohérence : devis « accepté » remis en « émis » (le dossier n'est pas signé)", metadata: JSON.stringify({ code: incoherence.code }) } });
      break;
    case "SIGNE_SANS_DEVIS_ACCEPTE": {
      const devis = await prisma.document.findFirst({ where: { dossierId: dossierId!, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true } });
      if (!devis) throw new ErreurMetier("Aucun devis émis sur ce dossier.", 409);
      await prisma.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
      await prisma.dossierEvenement.create({ data: { dossierId: dossierId!, type: "COHERENCE_CORRIGEE", direction: "INTERNE", contenu: `Contrôle de cohérence : devis ${devis.numero} noté « accepté » (le dossier est signé)`, metadata: JSON.stringify({ code: incoherence.code, documentId: devis.id }) } });
      break;
    }
    case "ETAPE_ET_SOLDE": {
      const changement = await prisma.$transaction((tx) => suivreSoldeDossier(tx, dossierId!, RAISON, true));
      if (changement) await effetsDuChangementEtape(changement);
      break;
    }
    case "PROJET_VALIDE_INCOMPLET": {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: dossierId! } });
      if (espace) await devaliderProjet(espace, "LUCAS", RAISON);
      break;
    }
    case "PROJET_VALIDE_SANS_AVANCER":
      await deplacer(dossierId!, "SIMULATION", "AUTOMATIQUE", RAISON_PROJET_VALIDE);
      break;
    case "CHOIX_SANS_SIMULATION": {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: dossierId! } });
      if (espace) await devaliderChoix(espace, "LUCAS");
      break;
    }
    case "PROCHAINE_ACTION_PERIMEE":
      await prisma.dossier.update({ where: { id: dossierId! }, data: { prochaineAction: null, prochaineActionDate: null } });
      break;
    case "STATUT_DU_LEAD": {
      const dossier = await prisma.dossier.findUnique({ where: { id: dossierId! }, select: { etape: true, leadId: true } });
      const statut = dossier ? STATUT_LEAD_ATTENDU[dossier.etape as EtapeDossier]?.[0] : null;
      if (dossier?.leadId && statut) await prisma.lead.update({ where: { id: dossier.leadId }, data: { statut } });
      break;
    }
    case "ESPACE_ACTIF_DOSSIER_ARCHIVE":
      await prisma.espaceClient.updateMany({ where: { dossierId: dossierId!, revoqueLe: null }, data: { revoqueLe: new Date() } });
      break;
    case "SIMULATIONS_HORS_DOSSIER": {
      const { assurerDossierDeSimulation } = await import("@/lib/dossiers/depuis-lead");
      await assurerDossierDeSimulation(incoherence.leadId!);
      break;
    }
    case "PROJETS_AU_DELA_DE_LA_LIMITE": {
      const permanentId = cle.split(":")[1];
      const projets = await projetsVisibles(prisma, permanentId);
      const enCours = projets.filter((p) => !figeDuProjet(p.dossier.etape)).length;
      const { accorderProjets } = await import("@/lib/espace/projets");
      const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanentId }, select: { projetsAccordes: true } });
      const manque = enCours - (LIMITE_PROJETS_EN_COURS + permanent.projetsAccordes);
      if (manque > 0) await accorderProjets(permanentId, Math.min(5, manque));
      break;
    }
    case "MAIN_DECALEE":
      await recalculerMain(dossierId);
      break;
    default:
      throw new ErreurMetier("Cette incohérence se règle à la main, depuis le dossier.", 400);
  }
  return { corrigee: true, message: `Corrigé : ${incoherence.correction.toLowerCase()}.` };
}

/** Passage automatique (démarrage, puis chaque jour) : le téléphone sonne seulement s'il y a quelque chose à lire. */
export async function controleAutomatique(): Promise<RapportCoherence> {
  const rapport = await controlerCoherence();
  console.log(`[coherence] ${rapport.dossiersControles} dossier(s) contrôlé(s) en ${rapport.dureeMs} ms : ${rapport.incoherences.length} incohérence(s)${rapport.incoherences.length ? ` — ${rapport.incoherences.map((i) => `${i.code}:${i.dossierId ?? i.leadId}`).join(", ")}` : ""}`);
  if (rapport.incoherences.length > 0) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
    const hautes = rapport.incoherences.filter((i) => i.gravite === "HAUTE").length;
    await alerter(
      { titre: `${rapport.incoherences.length} incohérence${rapport.incoherences.length > 1 ? "s" : ""} dans le CRM`, texte: `${rapport.incoherences.slice(0, 4).map((i) => `• ${i.client} : ${i.constat}`).join("\n")}${rapport.incoherences.length > 4 ? `\n… et ${rapport.incoherences.length - 4} autre(s).` : ""}`, lien: `${appUrl}/taches`, libelleLien: "Voir et corriger", urgence: hautes > 0 ? 4 : 2, etiquette: `coherence-${new Date().toISOString().slice(0, 10)}` },
      { origine: "coherence", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch(() => undefined);
  }
  return rapport;
}
