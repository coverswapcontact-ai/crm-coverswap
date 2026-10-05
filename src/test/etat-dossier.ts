/**
 * Mission 18 (partie B) : l'état d'un dossier DES DEUX CÔTÉS, pour les essais de la synchronisation (docs/SYNCHRO.md).
 * Chaque écart corrigé se teste ainsi : un déclencheur, puis cet état comparé à l'attendu — côté CRM (étape, main,
 * prochaine action, statut du lead, tâches après une passe de réconciliation, relances proposables) et côté client
 * (étape de son espace, calculée par le CRM comme le site la reçoit).
 *
 * À importer APRÈS `preparerBaseEssai()` : les modules du CRM sont chargés ici à la demande (le client Prisma lit
 * DATABASE_URL à sa création). Lecture seule, sauf la passe des tâches (`taches: false` pour s'en passer), qui écrit
 * les tâches comme toutes les 15 minutes en production. Rien ne part hors du poste (SMS des relances non préparés).
 */

export type TacheVue = { cle: string; type: string; titre: string; raison: string; statut: string; niveau: number };

export type EtatDesDeuxCotes = {
  etape: string;
  /** La main écrite sur le dossier (ce que lisent les écrans et l'assistant). */
  main: string | null;
  mainMotif: string | null;
  /** La main que la règle donne maintenant : elle doit être celle écrite (sinon un geste a oublié de la recalculer). */
  mainCalculee: string | null;
  prochaineAction: string | null;
  prochaineActionDate: Date | null;
  /** L'action posée à la main encore en place (texte inchangé), sinon null. */
  actionManuelle: string | null;
  statutLead: string | null;
  /** L'étape de l'espace du client (null : pas d'espace), la même lecture que le site. */
  etapeEspace: string | null;
  /** Mission 18 (B7) : les numéros des devis qu'il peut signer maintenant dans son espace (après la signature : les avenants). */
  devisASigner: string[];
  relances: {
    /** Ce qui est proposable maintenant : « DEVIS <numéro> n°<rang> », « PHOTOS », « AVIS ». */
    proposables: string[];
    /** Les relances de devis à venir ou dues : numéro, rang, date à partir de laquelle elle est proposable. */
    devis: { numero: string; rang: number; le: string | null }[];
  };
  /** Les tâches ouvertes (à faire, plus tard) du dossier après une passe de réconciliation, triées par clé. */
  taches: TacheVue[];
};

export async function etatDesDeuxCotes(dossierId: string, options: { maintenant?: Date; taches?: boolean } = {}): Promise<EtatDesDeuxCotes> {
  const maintenant = options.maintenant ?? new Date();
  const prisma = (await import("@/lib/prisma")).default;
  const { calculerMain } = await import("@/lib/dossiers/main");
  const { estActionManuelleEnPlace } = await import("@/lib/dossiers/prochaine-action-auto");
  const { chargerProjet } = await import("@/lib/espace/service");
  const { etapeEspace } = await import("@/lib/espace/etapes");
  const { relancesProposables } = await import("@/lib/relances/proposables");
  const { listerRelances } = await import("@/lib/relances/service");

  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, include: { lead: { select: { statut: true } } } });
  const calcul = await calculerMain(dossierId);
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId } });
  const projet = espace ? await chargerProjet(espace) : null;
  const etapeDeLEspace = projet ? etapeEspace(projet.faits) : null;

  const proposables = await relancesProposables(maintenant, { dossierId, smsPhotos: false, smsDevis: false, smsAvis: false, smsReactivations: false });
  const { devis } = await listerRelances(maintenant, { dossierId, sms: false });

  if (options.taches !== false) {
    const { passeComplete } = await import("@/lib/a-faire/detection");
    await passeComplete(maintenant);
  }
  const taches = options.taches === false ? [] : await prisma.tacheAFaire.findMany({ where: { dossierId, statut: { in: ["A_FAIRE", "PLUS_TARD"] } }, orderBy: { cle: "asc" } });

  return {
    etape: dossier.etape,
    main: dossier.main,
    mainMotif: dossier.mainMotif,
    mainCalculee: calcul?.qui ?? null,
    prochaineAction: dossier.prochaineAction,
    prochaineActionDate: dossier.prochaineActionDate,
    actionManuelle: estActionManuelleEnPlace(dossier) ? dossier.prochaineActionManuelle : null,
    statutLead: dossier.lead?.statut ?? null,
    etapeEspace: etapeDeLEspace,
    devisASigner: projet ? projet.lecture.aSigner.map((d) => d.numero ?? "?") : [],
    relances: {
      proposables: [
        ...proposables.devis.map((d) => `DEVIS ${d.numero} n°${d.rang}`),
        ...proposables.photos.map(() => "PHOTOS"),
        ...proposables.avis.map(() => "AVIS"),
      ],
      devis: devis.map((d) => ({ numero: d.numero, rang: d.rang, le: d.prochaineProposableLe })),
    },
    taches: taches.map((t) => ({ cle: t.cle, type: t.type, titre: t.titre, raison: t.raison, statut: t.statut, niveau: t.niveau })),
  };
}
