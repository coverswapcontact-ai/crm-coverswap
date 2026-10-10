/**
 * Mission 25 — remplit une base d'ESSAI locale pour voir la messagerie (jamais la prod : refusé hors d'un fichier
 * `prisma/essai-*.db`). Données fictives et neutres, numéros de la plage de fiction 06 39 98 00 18 à 00 30.
 *
 *   $env:DATABASE_URL="file:./essai-m25.db"; npm run base:pousser; npx tsx scripts/demo-messagerie.ts
 *
 * Crée : le lead « Démo Messagerie » (A1 prêt), un lead appelé sans réponse (A2), un dossier avec photos reçues (S1),
 * un dossier dont le devis est en ligne (D1, puis une réponse « c'est trop cher »), un dossier ouvert avant la mise en
 * service (proposition du démarrage en douceur), puis passe l'analyse de chacun.
 */
process.env.CRM_ESSAI_LOCAL = "1";
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXTAUTH_SECRET ||= "secret-local-de-la-demo-messagerie";

async function principal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^file:\.\/essai-[\w-]+\.db$/.test(url)) throw new Error(`Base refusée (${url || "aucune"}) : seulement file:./essai-….db.`);
  const prisma = (await import("../src/lib/prisma")).default;
  const { enregistrerParametre } = await import("../src/lib/parametres/service");
  const { lancementMessagerie } = await import("../src/lib/messagerie/suivis");
  const { creerDemoMessagerie } = await import("../src/lib/messagerie/demo");
  const { suiviPour } = await import("../src/lib/messagerie/suivis");
  const { analyserSuivi } = await import("../src/lib/messagerie/analyse");
  const gestes = await import("../src/lib/messagerie/gestes");
  const maintenant = new Date();
  if (!(await prisma.parametre.findFirst({ where: { cle: "MESSAGERIE_LANCEMENT" } }))) {
    await enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(maintenant.getTime() - 3_600_000).toISOString(), valableDu: new Date("2026-01-01"), source: "démo locale" });
  }
  await lancementMessagerie(maintenant);

  const { leadId } = await creerDemoMessagerie(maintenant);
  const demo = await suiviPour({ leadId });
  if (demo) await analyserSuivi(demo.id, maintenant);

  const numero = (n: number) => `06399800${String(n).padStart(2, "0")}`;
  const appele = await prisma.lead.create({ data: { prenom: "Inès", nom: "Démo", telephone: numero(19), ville: "Mauguio", codePostal: "34130", source: "SITE_DEVIS", typeProjet: "SDB" } });
  const s2 = await suiviPour({ leadId: appele.id });
  if (s2) {
    await analyserSuivi(s2.id, maintenant);
    await gestes.apresAppel({ suiviId: s2.id, issue: "PAS_DE_REPONSE", note: "" }, maintenant);
  }

  const dossier = async (nom: string, n: number, etape: string, ville: string, cp: string, ilYaJours = 0) =>
    prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue de l'Essai", clientCp: cp, clientVille: ville, clientTelephone: numero(n), objet: "Recouvrement de cuisine", source: "ENTRANT", etape, prestations: JSON.stringify({ CUISINE: ["facades-basses"] }), createdAt: new Date(maintenant.getTime() - ilYaJours * 86_400_000) } });

  const devis = await dossier("Hugo Démo", 21, "DEVIS_ENVOYE", "Pérols", "34470");
  const document = await prisma.document.create({ data: { dossierId: devis.id, type: "DEVIS", numero: "DEMO-9001", dateEmission: maintenant, objet: "Façades basses", lignes: "[]", totalHt: 2200, acomptePct: 30, statut: "ENVOYE", visibleEspace: true } });
  await prisma.dossierEvenement.create({ data: { dossierId: devis.id, type: "DEVIS_ENVOYE", direction: "INTERNE", contenu: "Devis DEMO-9001 mis en ligne", metadata: JSON.stringify({ documentId: document.id, canal: "ESPACE" }) } });
  const s3 = await suiviPour({ dossierId: devis.id });
  if (s3) {
    await analyserSuivi(s3.id, maintenant);
    await gestes.rapporterReponse({ suiviId: s3.id, texte: "C'est un peu cher pour nous, on réfléchit", recuLe: new Date(maintenant.getTime() - 20 * 60_000) }, maintenant);
  }

  const ancien = await dossier("Léon Démo", 22, "SIMULATION", "Sète", "34200", 30);
  const espace = await prisma.espaceClient.create({ data: { code: `demo-${Date.now().toString(36)}`, dossierId: ancien.id, expireLe: new Date("2099-01-01") } });
  await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: ancien.id, chemin: "demo/rendu.jpg", source: "API", statut: "PUBLIEE", publieeLe: new Date(maintenant.getTime() - 9 * 86_400_000), vueLe: new Date(maintenant.getTime() - 8 * 86_400_000) } });
  const s4 = await suiviPour({ dossierId: ancien.id });
  if (s4) await analyserSuivi(s4.id, maintenant);

  console.log("Démo prête :", await prisma.suivi.count(), "conversations,", await prisma.messagePrepare.count(), "messages préparés.");
  await prisma.$disconnect();
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exitCode = 1;
});
