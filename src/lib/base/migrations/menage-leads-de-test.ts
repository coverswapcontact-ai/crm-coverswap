import type { MigrationDonnees } from "./index";

/**
 * Ménage demandé par Lucas le 21/09/2026 : les leads créés pendant les essais
 * (« AUDIT TEST », « TEST … », « DIAG TEST », « dummy data » de l'outil de test
 * Meta, téléphones 06 00 00 00 xx / +33 00 00 00 xx, adresses @example.com).
 *
 * Liste EXPLICITE, relevée en production le 21/09/2026 (lecture seule) puis
 * relue : aucun motif de recherche ne s'applique à l'aveugle au démarrage. Motif
 * « Test ». Les deux contacts nommés par Lucas (cmu9seh1s0035xiqqbmk9pvpr et
 * cmua6do0m00ab7eyqanajfoqc) sont archivés depuis le 20/09 : laissés tels quels.
 *
 * Leurs dossiers ouverts ce jour-là par le rattrapage des simulations (tests
 * eux aussi) sont archivés — seulement s'ils sont vides : ni document, ni
 * paiement, ni espace client, ni dépense. Rien n'est supprimé ; tout se restaure.
 */
const LEADS_DE_TEST: readonly string[] = [
  "cmu5f6id20008jfc8bkgay56u", // AUDIT TEST Lot C
  "cmu56ncn5004v11pp2lbjc1j0", // AUDIT TEST Consentement
  "cmu55zphf003911ppwb34xesi", // AUDIT TEST Simulateur 2
  "cmu55y7h9003111pp2tzpe5ew", // AUDIT TEST Contact
  "cmu55xzr4002t11ppp3psvwsi", // AUDIT TEST Devis
  "cmu55f05g002f11ppouckb5y1", // AUDIT TEST Simulateur
  "cmr24xfa10000rydr9n9xw55s", // DIAG TEST-1782913943181
  "cmr0nj67j00003lj8jsa8ppdb", // TEST QUALITE V2
  "cmo43jcc40005bv7ozejfc53w", // test lead: dummy data (outil de test Meta)
  "cmu73iywv00089j791ac20609", // AUDIT TEST Panne Simulateur
  "cmu5eigr60008xcp6ajrrmoov", // AUDIT TEST Simulateur v2
  "cmu578j080005ftlu3wy0zd9u", // AUDIT TEST Parcours
  "cmr0khau7002y4sgozguij1f0", // TEST DIAG 2026-06
  "cmoebykkb001r146hgnbiy7wm", // TEST AUTO 2026-04-25
];

/** Garde-fou : un lead de la liste qui ne ressemble plus à un test (renommé, réattribué) n'est pas touché. */
const RESSEMBLE_A_UN_TEST = /(audit\s*test|\btest\b|dummy|diag|essai)/i;
const RATTRAPAGE_DU = new Date("2026-09-21T00:00:00.000Z");

export const migrationMenageLeadsDeTest: MigrationDonnees = {
  nom: "menage-des-leads-de-test-21-09",
  description: "Archive (motif « Test ») les leads créés pendant les essais, et leurs dossiers vides ouverts par le rattrapage des simulations",
  executer: async (client) => {
    const maintenant = new Date();
    let leadsArchives = 0;
    let dejaArchives = 0;
    let ignores = 0;
    let dossiersArchives = 0;
    let dossiersGardes = 0;
    for (const id of LEADS_DE_TEST) {
      const lead = await client.lead.findFirst({
        where: { id, archiveLe: undefined },
        select: {
          id: true, prenom: true, nom: true, email: true, archiveLe: true,
          dossiers: { where: { archiveLe: null }, select: { id: true, createdAt: true, _count: { select: { documents: true, encaissements: true, espaces: true, depenses: true, accords: true } } } },
        },
      });
      if (!lead) continue;
      if (!RESSEMBLE_A_UN_TEST.test(`${lead.prenom} ${lead.nom} ${lead.email ?? ""}`)) {
        ignores++;
        console.warn(`[menage] ${id} ne ressemble plus à un lead de test : laissé tel quel`);
        continue;
      }
      if (lead.archiveLe) dejaArchives++;
      else {
        await client.lead.update({ where: { id }, data: { archiveLe: maintenant, archiveMotif: "Test" } });
        leadsArchives++;
      }
      for (const dossier of lead.dossiers) {
        const vide = Object.values(dossier._count).every((n) => n === 0);
        if (vide && dossier.createdAt >= RATTRAPAGE_DU) {
          await client.dossier.update({ where: { id: dossier.id }, data: { archiveLe: maintenant, archiveMotif: "Test : dossier d'un lead de test, ouvert par le rattrapage des simulations" } });
          dossiersArchives++;
        } else dossiersGardes++;
      }
      console.log(`[menage] lead de test archivé (motif « Test ») : ${id} — ${`${lead.prenom} ${lead.nom}`.trim()}`);
    }
    return { leadsArchives, dejaArchives, ignores, dossiersArchives, dossiersGardes };
  },
};
