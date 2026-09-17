import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { LIBELLES_CATEGORIE_CLIENT, LIBELLES_FAMILLE_SOURCE, familleDeSource, type CategorieClient, type FamilleSource } from "@/lib/clients/constantes";
import { libelleCategorie } from "@/lib/depenses/constantes";
import { CODES_COMPLETUDE, LIBELLES_QUALITE_DOSSIERS } from "@/lib/dossiers/completude";
import { ETAPES_ACTIVES, LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE, LIBELLES_SOURCE, type EtapeDossier, type MotifPerte, type SourceDossier } from "@/lib/dossiers/constants";
import { dateEnLettres, jourParis } from "@/lib/dossiers/dates";
import { ecartsPrix } from "@/lib/dossiers/delais";
import { pointsACompleterDossiers } from "@/lib/dossiers/dossiers";
import { versCentimes } from "@/lib/dossiers/montants";
import { lireMetadataChangementEtape } from "@/lib/dossiers/regles";
import { chargerLivre, totalCentimes } from "@/lib/finances/livre";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { STATUTS_LEAD_APRES_DEVIS, libelleSourceLead } from "@/lib/prospects/constantes";
import { typesDePropositions, definitionDe } from "@/lib/validation/catalogue";
import { MOTIFS_REJET_COMMUNS } from "@/lib/validation/types";
import { VERSION_SYNTHESE, type Repartition, type Synthese } from "./types";

/**
 * Synthèse d'une période (du, au : jours inclus, AAAA-MM-JJ), calculée depuis
 * les données : événements d'étape, documents émis, livre des recettes,
 * dépenses, clients, propositions, journal. Aucun nom de personne dans le
 * résultat (voir types.ts).
 */

const JOUR_MS = 24 * 60 * 60_000;
const INACTIF_APRES_JOURS = 365;

const euros = (centimes: number) => centimes / 100;
const arrondi1 = (valeur: number) => Math.round(valeur * 10) / 10;

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2;
}

function repartir<T>(elements: T[], cle: (element: T) => string, libelle: (cle: string) => string, valeur: (element: T) => number = () => 1): Repartition[] {
  const cumul = new Map<string, number>();
  for (const element of elements) cumul.set(cle(element), (cumul.get(cle(element)) ?? 0) + valeur(element));
  return [...cumul.entries()].map(([c, v]) => ({ cle: c, libelle: libelle(c), valeur: v })).sort((a, b) => b.valeur - a.valeur);
}

function libelleMotifRejet(code: string): string {
  const connus = [...MOTIFS_REJET_COMMUNS, ...typesDePropositions().flatMap(({ type }) => definitionDe(type)?.motifsRejet ?? [])];
  return connus.find((motif) => motif.code === code)?.libelle ?? code;
}

export function libellePeriode(du: string, au: string): string {
  return `du ${dateEnLettres(`${du}T12:00:00Z`)} au ${dateEnLettres(`${au}T12:00:00Z`)}`;
}

export async function calculerSynthese(du: string, au: string, maintenant: Date = new Date()): Promise<Synthese> {
  // Bornes larges pour les requêtes (une journée à Paris commence jusqu'à deux heures plus tôt en UTC),
  // puis le tri exact au jour de Paris.
  const debut = new Date(`${du}T00:00:00Z`).getTime() - 2 * 60 * 60_000;
  const fin = new Date(`${au}T23:59:59.999Z`).getTime();
  const dans = (date: Date | null | undefined) => {
    if (!date) return false;
    const jour = jourParis(date);
    return jour >= du && jour <= au;
  };

  const [dossiers, clients, propositionsBrutes, depensesBrutes, inconnus, messagesBruts, rangementsBruts, appelsIaBruts, bruitsAnnules, leadsBruts] = await Promise.all([
    prisma.dossier.findMany({
      where: AVEC_ARCHIVES,
      select: {
        id: true,
        createdAt: true,
        ouvertLe: true,
        updatedAt: true,
        etape: true,
        source: true,
        clientId: true,
        clientCp: true,
        montantEstime: true,
        client: { select: { source: true, categorie: true } },
        evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { createdAt: true, survenuLe: true, metadata: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        documents: { where: { numero: { not: null } }, select: { id: true, type: true, statut: true, totalHt: true, dateEmission: true, createdAt: true } },
        depenses: { select: { montant: true } },
      },
    }),
    prisma.client.findMany({
      where: { fusionneDansId: null },
      select: {
        id: true,
        source: true,
        categorie: true,
        campagne: true,
        premierContactLe: true,
        recommandeParId: true,
        recommandeParTexte: true,
        anonymiseLe: true,
        dossiers: { select: { id: true, etape: true, updatedAt: true } },
        emails: { select: { id: true } },
        telephones: { select: { id: true } },
      },
    }),
    prisma.proposition.findMany({
      where: { createdAt: { gte: new Date(debut), lte: new Date(fin) } },
      select: { auteur: true, statut: true, modifiee: true, createdAt: true, decideLe: true, motifRejet: true },
    }),
    prisma.depense.findMany({ where: { payeeLe: { gte: new Date(debut), lte: new Date(fin) } }, select: { montant: true, categorie: true, payeeLe: true, dossierId: true, horsChantier: true, justificatifId: true } }),
    prisma.$queryRawUnsafe<{ n: number | bigint }[]>(
      `SELECT count(*) AS n FROM "JournalModification" WHERE "acteur" LIKE 'INCONNU%' AND "horodatage" BETWEEN ? AND ?`,
      debut,
      fin
    ),
    prisma.message.findMany({ where: { sens: "ENTRANT", recuLe: { gte: new Date(debut), lte: new Date(fin) } }, select: { recuLe: true, statut: true } }),
    prisma.proposition.findMany({
      where: { type: { in: ["RATTACHER_MESSAGE", "ARCHIVER_MESSAGE"] }, messageId: { not: null }, statut: { in: ["AUTOMATIQUE", "EXECUTEE"] } },
      select: { type: true, statut: true, messageId: true, createdAt: true, decideLe: true },
    }),
    prisma.appelIa.findMany({ where: { createdAt: { gte: new Date(debut), lte: new Date(fin) } }, select: { createdAt: true, coutEuros: true, usage: true } }),
    prisma.message.findMany({ where: { bruitAnnuleLe: { gte: new Date(debut), lte: new Date(fin) } }, select: { bruitAnnuleLe: true } }),
    prisma.lead.findMany({ where: { createdAt: { gte: new Date(debut), lte: new Date(fin) } }, select: { createdAt: true, source: true, statut: true, dossiers: { select: { id: true } } } }),
  ]);

  const propositions = propositionsBrutes.filter((proposition) => dans(proposition.createdAt));
  const depenses = depensesBrutes.filter((depense) => dans(depense.payeeLe));

  /* ── Commercial ─────────────────────────────────────────────────── */
  const rang = (etape: string) => (ETAPES_ACTIVES as readonly string[]).indexOf(etape);
  // Chaque passage compte à sa date réelle (corrigée, ou reprise d'avant le CRM) ; une date inconnue ne compte
  // ni dans l'activité d'une période ni dans les délais, mais l'étape atteinte compte pour la cohorte.
  const lus = dossiers.map((dossier) => {
    const changements = dossier.evenements
      .map((evenement) => ({ createdAt: evenement.survenuLe ?? evenement.createdAt, metadata: lireMetadataChangementEtape(evenement.metadata) }))
      .filter((changement): changement is { createdAt: Date; metadata: NonNullable<typeof changement.metadata> } => changement.metadata !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const atteintes = new Set(changements.map((changement) => changement.metadata.vers));
    const rangMax = Math.max(-1, ...[...atteintes].map(rang));
    const dates = changements.filter((changement) => !changement.metadata.dateInconnue);
    const premier = (etape: EtapeDossier) => dates.find((changement) => changement.metadata.vers === etape)?.createdAt ?? null;
    return { dossier, changements: dates, rangMax, premier };
  });

  const cohorte = lus.filter(({ dossier }) => dans(dossier.ouvertLe ?? dossier.createdAt));
  const signesCohorte = cohorte.filter(({ rangMax }) => rangMax >= rang("SIGNE"));
  const devisCohorte = cohorte.filter(({ rangMax }) => rangMax >= rang("DEVIS_ENVOYE"));

  const signatures = lus.flatMap(({ dossier, changements }) =>
    changements
      .filter((changement) => changement.metadata.vers === "SIGNE" && changement.metadata.nature === "SUIVANTE" && dans(changement.createdAt))
      .map((changement) => ({ dossier, montant: dossier.documents.find((document) => document.id === changement.metadata.documentId)?.totalHt ?? null }))
  );
  const pertes = lus.flatMap(({ dossier, changements }) =>
    changements.filter((changement) => changement.metadata.vers === "PERDU" && dans(changement.createdAt)).map((changement) => ({ dossier, metadata: changement.metadata }))
  );
  const documentsPeriode = dossiers.flatMap((dossier) => dossier.documents.filter((document) => dans(document.dateEmission)));
  const somme = (liste: { totalHt: number }[]) => euros(liste.reduce((total, document) => total + versCentimes(document.totalHt), 0));
  const devisEmis = documentsPeriode.filter((document) => document.type === "DEVIS");
  const facturesEmises = documentsPeriode.filter((document) => document.type === "FACTURE");
  const avoirs = documentsPeriode.filter((document) => document.type === "AVOIR");

  const delai = (cle: string, libelle: string, de: EtapeDossier | "OUVERTURE", a: EtapeDossier) => {
    const valeurs = lus.flatMap(({ dossier, changements, premier }) => {
      const arrivee = premier(a);
      if (!arrivee || !dans(arrivee)) return [];
      const depart = de === "OUVERTURE" ? (dossier.ouvertLe ?? changements[0]?.createdAt ?? dossier.createdAt) : premier(de);
      return depart && arrivee >= depart ? [(arrivee.getTime() - depart.getTime()) / JOUR_MS] : [];
    });
    const valeur = mediane(valeurs);
    return { cle, libelle, medianeJours: valeur === null ? null : arrondi1(valeur), nombre: valeurs.length };
  };

  const ecarts = signatures
    .map(({ dossier }) => ecartsPrix(dossier.documents, dossier.montantEstime).ecartSignaturePct)
    .filter((valeur): valeur is number => valeur !== null);

  const parConcurrent = new Map<string, { nombre: number; ecarts: number[] }>();
  for (const { metadata } of pertes) {
    if (!metadata.perteConcurrent) continue;
    const entree = parConcurrent.get(metadata.perteConcurrent) ?? { nombre: 0, ecarts: [] };
    entree.nombre++;
    if (metadata.perteMontantConcurrent != null && metadata.perteMontantPropose) {
      entree.ecarts.push(((metadata.perteMontantConcurrent - metadata.perteMontantPropose) / metadata.perteMontantPropose) * 100);
    }
    parConcurrent.set(metadata.perteConcurrent, entree);
  }

  /* ── Finances ───────────────────────────────────────────────────── */
  const livre = await chargerLivre(du, au);
  const livreComplet = livre.manquants.length === 0;
  const encaissementIds = [...new Set(livre.lignes.map((ligne) => ligne.encaissementId))];
  const encaissements = await prisma.encaissement.findMany({
    where: { id: { in: encaissementIds } },
    select: { id: true, clientId: true, client: { select: { source: true, categorie: true } }, dossier: { select: { clientCp: true } } },
  });
  const encaissementDe = new Map(encaissements.map((encaissement) => [encaissement.id, encaissement]));
  const lignesDetaillees = livre.lignes.map((ligne) => ({ ligne, encaissement: encaissementDe.get(ligne.encaissementId) }));
  const montantLigne = ({ ligne }: { ligne: { montant: number } }) => versCentimes(ligne.montant);

  const encaisseCentimes = totalCentimes(livre.lignes);
  const depensesCentimes = depenses.reduce((total, depense) => total + versCentimes(depense.montant), 0);
  const mois = new Map<string, number>();
  for (const ligne of livre.lignes) mois.set(ligne.jour.slice(0, 7), (mois.get(ligne.jour.slice(0, 7)) ?? 0) + versCentimes(ligne.montant));

  const tableau = await chargerTableauFinances(Number(au.slice(0, 4)), maintenant);
  const encours = tableau.encours;

  const margesDossiers = dossiers
    .filter((dossier) => dossier.documents.some((document) => document.type === "FACTURE" && document.statut !== "ANNULEE" && dans(document.dateEmission)))
    .map((dossier) => {
      const facture = dossier.documents.filter((document) => document.type === "FACTURE" && document.statut !== "ANNULEE").reduce((total, document) => total + versCentimes(document.totalHt), 0);
      const depense = dossier.depenses.reduce((total, ligne) => total + versCentimes(ligne.montant), 0);
      return { dossierId: dossier.id, clientId: dossier.clientId, facture: euros(facture), depenses: euros(depense), marge: euros(facture - depense), margePct: facture > 0 ? arrondi1(((facture - depense) / facture) * 100) : null };
    })
    .sort((a, b) => (a.margePct ?? 0) - (b.margePct ?? 0));

  /* ── Clients ────────────────────────────────────────────────────── */
  const nouveaux = clients.filter((client) => dans(client.premierContactLe));
  const familleClient = (client: { source: string } | null | undefined): FamilleSource => (client ? familleDeSource(client.source) : "NON_RENSEIGNE");
  const caParFamille = (famille: FamilleSource) =>
    livreComplet ? euros(lignesDetaillees.filter(({ encaissement }) => familleClient(encaissement?.client) === famille).reduce((total, element) => total + montantLigne(element), 0)) : null;
  const recommandeurs = repartir(
    nouveaux.filter((client) => client.recommandeParId),
    (client) => client.recommandeParId!,
    (cle) => cle
  ).map((ligne) => ({ clientId: ligne.cle, nombre: ligne.valeur }));
  const dossiersParClient = new Map(clients.map((client) => [client.id, client.dossiers.length]));
  const recurrentsCa = lignesDetaillees.filter(({ encaissement }) => encaissement?.clientId && (dossiersParClient.get(encaissement.clientId) ?? 0) >= 2);
  const inactifs = clients.filter(
    (client) =>
      !client.anonymiseLe &&
      client.dossiers.some((dossier) => dossier.etape === "ENCAISSE") &&
      client.dossiers.every((dossier) => maintenant.getTime() - dossier.updatedAt.getTime() > INACTIF_APRES_JOURS * JOUR_MS)
  );

  /* ── Agent ──────────────────────────────────────────────────────── */
  const auteurs = [...new Set(propositions.map((proposition) => proposition.auteur.split(":").slice(0, 2).join(":")))];
  const parAuteur = auteurs
    .map((auteur) => {
      const siennes = propositions.filter((proposition) => proposition.auteur.split(":").slice(0, 2).join(":") === auteur);
      const validees = siennes.filter((proposition) => ["VALIDEE", "EXECUTEE", "ECHEC", "AUTOMATIQUE"].includes(proposition.statut));
      const rejetees = siennes.filter((proposition) => proposition.statut === "REJETEE");
      const delais = siennes.filter((proposition) => proposition.decideLe).map((proposition) => (proposition.decideLe!.getTime() - proposition.createdAt.getTime()) / 3_600_000);
      const valeurDelai = mediane(delais);
      return {
        auteur,
        proposees: siennes.length,
        validees: validees.length,
        modifiees: validees.filter((proposition) => proposition.modifiee).length,
        rejetees: rejetees.length,
        expirees: siennes.filter((proposition) => proposition.statut === "EXPIREE" || proposition.statut === "ANNULEE").length,
        enAttente: siennes.filter((proposition) => proposition.statut === "EN_ATTENTE").length,
        tauxAcceptation: validees.length + rejetees.length > 0 ? arrondi1((validees.length / (validees.length + rejetees.length)) * 100) : null,
        delaiDecisionMedianHeures: valeurDelai === null ? null : arrondi1(valeurDelai),
      };
    })
    .filter((ligne) => !ligne.auteur.startsWith("HUMAIN"))
    .sort((a, b) => b.proposees - a.proposees);

  /* ── Agent mail ─────────────────────────────────────────────────── */
  const messagesRecus = messagesBruts.filter((message) => dans(message.recuLe));
  const appelsIa = appelsIaBruts.filter((appel) => appel.usage === "ANALYSE_MESSAGE" && dans(appel.createdAt));
  const rangesSeulsParMessage = new Set(rangementsBruts.filter((ligne) => ligne.type === "RATTACHER_MESSAGE" && ligne.statut === "AUTOMATIQUE").map((ligne) => ligne.messageId));
  const rangementsCorriges = new Set(
    rangementsBruts
      .filter((ligne) => ligne.type === "RATTACHER_MESSAGE" && ligne.statut === "EXECUTEE" && rangesSeulsParMessage.has(ligne.messageId) && dans(ligne.decideLe))
      .map((ligne) => ligne.messageId)
  ).size;

  /* ── Qualité des données ────────────────────────────────────────── */
  // Dossiers incomplets, à ce jour (archivés exclus) : ce que chaque dossier signale « à compléter ».
  const completude = [...(await pointsACompleterDossiers(prisma)).values()].flat();
  const qualite: Repartition[] = [
    { cle: "ECRITURES_HORS_COUCHE", libelle: "Écritures faites hors de l'application (auteur inconnu) dans la période", valeur: Number(inconnus[0]?.n ?? 0) },
    ...CODES_COMPLETUDE.map((code) => ({
      cle: `DOSSIERS_${code}`,
      libelle: LIBELLES_QUALITE_DOSSIERS[code],
      valeur: completude.filter((point) => point.code === code).length,
    })),
    { cle: "CLIENTS_INJOIGNABLES", libelle: "Clients sans e-mail ni téléphone", valeur: clients.filter((client) => !client.anonymiseLe && client.emails.length === 0 && client.telephones.length === 0).length },
    { cle: "SOURCE_INCONNUE", libelle: "Nouveaux clients de la période sans source renseignée", valeur: nouveaux.filter((client) => familleDeSource(client.source) === "NON_RENSEIGNE").length },
    { cle: "PERTES_SANS_CONCURRENT", libelle: "Pertes de la période sans « remporté par »", valeur: pertes.filter(({ metadata }) => !metadata.perteConcurrent).length },
    { cle: "DEPENSES_A_RATTACHER", libelle: "Dépenses de la période à rattacher", valeur: depenses.filter((depense) => !depense.dossierId && !depense.horsChantier).length },
    { cle: "DEPENSES_SANS_JUSTIFICATIF", libelle: "Dépenses de la période sans justificatif", valeur: depenses.filter((depense) => !depense.justificatifId).length },
    ...tableau.qualite.map((point) => ({ cle: point.code, libelle: point.libelle, valeur: point.detail.length })),
  ].filter((point) => point.valeur > 0);

  // Contacts entrants : reçus dans la période, suivis jusqu'à aujourd'hui (dossier ouvert, signé dans un
  // dossier ou déjà dans l'ancien CRM).
  const rangMaxParDossier = new Map(lus.map(({ dossier, rangMax }) => [dossier.id, rangMax]));
  const leads = leadsBruts
    .filter((lead) => dans(lead.createdAt))
    .map((lead) => ({
      source: lead.source,
      contacte: !["NOUVEAU", "DEVIS_DEMANDE"].includes(lead.statut) || lead.dossiers.length > 0,
      avecDossier: lead.dossiers.length > 0,
      signe:
        (STATUTS_LEAD_APRES_DEVIS as readonly string[]).filter((statut) => statut !== "DEVIS_ENVOYE").includes(lead.statut) ||
        lead.dossiers.some((dossier) => (rangMaxParDossier.get(dossier.id) ?? -1) >= rang("SIGNE")),
      sansSuite: lead.statut === "PERDU",
    }));
  const entrants = {
    recus: leads.length,
    contactes: leads.filter((lead) => lead.contacte).length,
    avecDossier: leads.filter((lead) => lead.avecDossier).length,
    signes: leads.filter((lead) => lead.signe).length,
    sansSuite: leads.filter((lead) => lead.sansSuite).length,
    parSource: repartir(leads, (lead) => lead.source, libelleSourceLead).map((ligne) => ({
      cle: ligne.cle,
      libelle: ligne.libelle,
      recus: ligne.valeur,
      avecDossier: leads.filter((lead) => lead.source === ligne.cle && lead.avecDossier).length,
      signes: leads.filter((lead) => lead.source === ligne.cle && lead.signe).length,
    })),
  };

  return {
    version: VERSION_SYNTHESE,
    periode: { du, au, libelle: libellePeriode(du, au) },
    calculeLe: maintenant.toISOString(),
    commercial: {
      cohorte: {
        ouverts: cohorte.length,
        devisEnvoyes: devisCohorte.length,
        signes: signesCohorte.length,
        encaisses: cohorte.filter(({ rangMax }) => rangMax >= rang("ENCAISSE")).length,
        perdus: cohorte.filter(({ dossier }) => dossier.etape === "PERDU").length,
        enCours: cohorte.filter(({ dossier }) => dossier.etape !== "PERDU" && dossier.etape !== "ENCAISSE").length,
        tauxSignatureDevis: devisCohorte.length > 0 ? arrondi1((signesCohorte.length / devisCohorte.length) * 100) : null,
        parSource: repartir(cohorte, ({ dossier }) => dossier.source, (cle) => LIBELLES_SOURCE[cle as SourceDossier] ?? cle).map((ligne) => ({
          cle: ligne.cle,
          libelle: ligne.libelle,
          ouverts: ligne.valeur,
          signes: signesCohorte.filter(({ dossier }) => dossier.source === ligne.cle).length,
        })),
      },
      entrants,
      activite: {
        devisEmis: devisEmis.length,
        montantDevis: somme(devisEmis),
        signatures: signatures.length,
        montantSigne: euros(signatures.reduce((total, signature) => total + versCentimes(signature.montant ?? 0), 0)),
        facturesEmises: facturesEmises.length,
        montantFacture: somme(facturesEmises),
        avoirs: avoirs.length,
        montantAvoirs: somme(avoirs),
        pertes: pertes.length,
      },
      delais: [
        delai("OUVERTURE_DEVIS", "De l'ouverture au devis envoyé", "OUVERTURE", "DEVIS_ENVOYE"),
        delai("DEVIS_SIGNATURE", "Du devis envoyé à la signature", "DEVIS_ENVOYE", "SIGNE"),
        delai("SIGNATURE_CHANTIER", "De la signature au chantier", "SIGNE", "CHANTIER"),
        delai("FACTURE_ENCAISSEMENT", "De la facture à l'encaissement", "FACTURE", "ENCAISSE"),
        delai("BOUT_EN_BOUT", "De l'ouverture à l'encaissement", "OUVERTURE", "ENCAISSE"),
      ],
      ecartPrixMoyenPct: ecarts.length > 0 ? arrondi1(ecarts.reduce((total, valeur) => total + valeur, 0) / ecarts.length) : null,
      pertes: {
        parMotif: repartir(pertes, ({ metadata }) => metadata.motifPerte ?? "NON_RENSEIGNE", (cle) => LIBELLES_MOTIF_PERTE[cle as MotifPerte] ?? "Non renseigné"),
        parEtape: repartir(pertes, ({ metadata }) => metadata.perteEtape ?? "INCONNUE", (cle) => LIBELLES_ETAPE[cle as EtapeDossier] ?? "Inconnue"),
        montantPropose: euros(pertes.reduce((total, { metadata }) => total + versCentimes(metadata.perteMontantPropose ?? 0), 0)),
        concurrents: [...parConcurrent.entries()]
          .map(([nom, { nombre, ecarts: liste }]) => ({ nom, nombre, ecartMoyenPct: liste.length ? arrondi1(liste.reduce((total, valeur) => total + valeur, 0) / liste.length) : null }))
          .sort((a, b) => b.nombre - a.nombre),
      },
    },
    finances: {
      encaisse: livreComplet ? euros(encaisseCentimes) : null,
      parametresManquants: livre.manquants,
      parMois: [...mois.entries()].sort().map(([cle, centimes]) => ({ mois: cle, montant: euros(centimes) })),
      parFamilleSource: livreComplet
        ? repartir(lignesDetaillees, ({ encaissement }) => familleClient(encaissement?.client), (cle) => LIBELLES_FAMILLE_SOURCE[cle as FamilleSource] ?? cle, montantLigne).map((ligne) => ({ ...ligne, valeur: euros(ligne.valeur) }))
        : [],
      parCategorieClient: livreComplet
        ? repartir(lignesDetaillees, ({ encaissement }) => encaissement?.client?.categorie ?? "NON_RENSEIGNE", (cle) => LIBELLES_CATEGORIE_CLIENT[cle as CategorieClient] ?? "Non renseigné", montantLigne).map((ligne) => ({ ...ligne, valeur: euros(ligne.valeur) }))
        : [],
      parDepartement: livreComplet
        ? repartir(lignesDetaillees, ({ encaissement }) => encaissement?.dossier?.clientCp?.slice(0, 2) ?? "HORS_DOSSIER", (cle) => (cle === "HORS_DOSSIER" ? "Hors dossier" : `Département ${cle}`), montantLigne).map((ligne) => ({ ...ligne, valeur: euros(ligne.valeur) }))
        : [],
      depenses: euros(depensesCentimes),
      depensesParCategorie: repartir(depenses, (depense) => depense.categorie, libelleCategorie, (depense) => versCentimes(depense.montant)).map((ligne) => ({ ...ligne, valeur: euros(ligne.valeur) })),
      margeBrute: livreComplet ? euros(encaisseCentimes - depensesCentimes) : null,
      panierMoyenSigne: signatures.length ? euros(Math.round(signatures.reduce((total, signature) => total + versCentimes(signature.montant ?? 0), 0) / signatures.length)) : null,
      panierMoyenFacture: facturesEmises.length ? euros(Math.round(facturesEmises.reduce((total, document) => total + versCentimes(document.totalHt), 0) / facturesEmises.length)) : null,
      encours: {
        total: encours.total,
        plus30Jours: euros(encours.lignes.filter((ligne) => (ligne.joursRetard ?? 0) > 30).reduce((total, ligne) => total + versCentimes(ligne.reste), 0)),
        factures: encours.lignes.length,
      },
      margesDossiers,
    },
    clients: {
      nouveaux: nouveaux.length,
      parFamilleSource: repartir(nouveaux, (client) => familleDeSource(client.source), (cle) => LIBELLES_FAMILLE_SOURCE[cle as FamilleSource] ?? cle),
      campagnes: repartir(nouveaux.filter((client) => client.campagne), (client) => client.campagne!, (cle) => cle).slice(0, 10),
      recommandations: nouveaux.filter((client) => client.recommandeParId || client.recommandeParTexte).length,
      recommandeurs,
      relationnelContrePayant: {
        nouveauxRelationnel: nouveaux.filter((client) => familleDeSource(client.source) === "RELATIONNEL").length,
        nouveauxPayant: nouveaux.filter((client) => familleDeSource(client.source) === "PAYANT").length,
        caRelationnel: caParFamille("RELATIONNEL"),
        caPayant: caParFamille("PAYANT"),
      },
      recurrents: {
        clients: new Set(recurrentsCa.map(({ encaissement }) => encaissement!.clientId)).size,
        partCa: livreComplet && encaisseCentimes > 0 ? arrondi1((recurrentsCa.reduce((total, element) => total + montantLigne(element), 0) / encaisseCentimes) * 100) : null,
      },
      inactifs: { nombre: inactifs.length, clientIds: inactifs.slice(0, 20).map((client) => client.id) },
    },
    agent: {
      parAuteur,
      motifsRejet: repartir(propositions.filter((proposition) => proposition.motifRejet), (proposition) => proposition.motifRejet!, libelleMotifRejet),
      mails: {
        recus: messagesRecus.length,
        rangesSeuls: rangementsBruts.filter((ligne) => ligne.type === "RATTACHER_MESSAGE" && ligne.statut === "AUTOMATIQUE" && dans(ligne.createdAt)).length,
        bruitArchiveSeul: rangementsBruts.filter((ligne) => ligne.type === "ARCHIVER_MESSAGE" && ligne.statut === "AUTOMATIQUE" && dans(ligne.createdAt)).length,
        bruitAnnule: bruitsAnnules.filter((ligne) => dans(ligne.bruitAnnuleLe)).length,
        rangementsCorriges,
        restantATrier: messagesRecus.filter((message) => message.statut === "A_TRIER").length,
        lecturesIa: appelsIa.length,
        coutIa: Math.round(appelsIa.reduce((total, appel) => total + (appel.coutEuros ?? 0), 0) * 100) / 100,
      },
    },
    qualite,
  };
}
