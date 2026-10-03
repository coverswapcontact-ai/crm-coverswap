import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-lister-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — « lister », « etat_crm », « chercher » (archives) et « lire_fiche » (tout) : chaque liste rend
 * le même contenu que la fonction de l'écran (mêmes identifiants, même ordre), « etat_crm » dit tout en un seul appel,
 * les archivés se trouvent. Base d'essai, noms fictifs, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let lister: typeof import("@/lib/assistant/outils/lister");
let etat: typeof import("@/lib/assistant/outils/etat");
let lecture: typeof import("@/lib/assistant/outils/lecture");
let session: import("@/lib/assistant/execution").Session;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const ids: Record<string, string> = {};
const J = 86_400_000;

const REFERENCES = [
  { id: "AA01", nom: "Beige Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/aa01.jpg", tags: ["chêne", "beige"] },
  { id: "J3", nom: "Ultra White", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/j3.jpg", tags: ["couleur"] },
  { id: "NE31", nom: "Statuary White", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ne31.jpg", tags: ["pierre", "marbre"] },
];

const executer = (outil: unknown, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(outil as DefinitionOutil, entree, session, new Date());
const listerAvec = (entree: Record<string, unknown>) => executer(lister.outilLister, entree);
const idsDe = <T extends { id: string }>(lignes: T[]) => lignes.map((l) => l.id);

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("@/lib/assistant/execution");
  lister = await import("@/lib/assistant/outils/lister");
  etat = await import("@/lib/assistant/outils/etat");
  lecture = await import("@/lib/assistant/outils/lecture");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES);
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
  const maintenant = Date.now();

  // Leads : deux à appeler, un à rappeler, un sans suite, un archivé.
  ids.appeler1 = (await prisma.lead.create({ data: { prenom: "Alice", nom: "Appelle", telephone: "0611000001", ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE", campagne: "Campagne automne" } })).id;
  ids.appeler2 = (await prisma.lead.create({ data: { prenom: "Bruno", nom: "Appelle", telephone: "0611000002", ville: "Pérols", source: "SITE_DEVIS", typeProjet: "SDB" } })).id;
  ids.rappeler = (await prisma.lead.create({ data: { prenom: "Chloé", nom: "Rappel", telephone: "0611000003", ville: "Mauguio", source: "META_ADS", typeProjet: "CUISINE", rappelLe: new Date(maintenant + 2 * J), dernierAppelLe: new Date(maintenant - J), tentatives: 1 } })).id;
  ids.sansSuite = (await prisma.lead.create({ data: { prenom: "Denis", nom: "Perdu", telephone: "0611000004", ville: "Sète", source: "SITE_DEVIS", typeProjet: "CUISINE", statut: "PERDU" } })).id;
  ids.leadArchive = (await prisma.lead.create({ data: { prenom: "Eliane", nom: "Oubliette", telephone: "0611000005", ville: "Agde", source: "META_ADS", typeProjet: "CUISINE", archiveLe: new Date(maintenant - 3 * J), archiveMotif: "Test" } })).id;

  // Clients, dont un pro et une fiche archivée.
  ids.clientBloch = (await prisma.client.create({ data: { nom: "Hélène Bloch", prenom: "Hélène", nomFamille: "Bloch", ville: "Montpellier", source: "SITE_DEVIS", premierContactLe: new Date(maintenant - 40 * J), notes: "Cliente fidèle, deux chantiers.", emails: { create: { adresse: "bloch@exemple.test" } }, telephones: { create: { numero: "+33611000010", saisi: "06 11 00 00 10" } } } })).id;
  ids.clientPro = (await prisma.client.create({ data: { nom: "Cuisines Pro SARL", raisonSociale: "Cuisines Pro SARL", categorie: "PROFESSIONNEL", siret: "12345678900011", ville: "Nîmes", source: "SITE_PRO", premierContactLe: new Date(maintenant - 10 * J) } })).id;
  ids.clientArchive = (await prisma.client.create({ data: { nom: "Gaston Parti", ville: "Béziers", source: "INCONNUE", premierContactLe: new Date(maintenant - 400 * J), archiveLe: new Date(maintenant - 5 * J), archiveMotif: "Doublon" } })).id;

  // Dossiers : deux en cours, un archivé ; des événements, une note, une tâche, des messages.
  ids.dossierBloch = (await prisma.dossier.create({ data: { clientNom: "Hélène Bloch", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000010", clientEmail: "bloch@exemple.test", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: ids.clientBloch } })).id;
  ids.dossierSimu = (await prisma.dossier.create({ data: { clientNom: "Igor Simule", clientAdresse: "5 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0611000011", objet: "Salle de bain", source: "ENTRANT", etape: "SIMULATION" } })).id;
  ids.dossierArchive = (await prisma.dossier.create({ data: { clientNom: "Jules Rangé", clientAdresse: "9 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000012", objet: "Dressing", source: "ENTRANT", etape: "QUALIFICATION", archiveLe: new Date(maintenant - 2 * J), archiveMotif: "Hors cible" } })).id;
  for (let i = 1; i <= 25; i++) await prisma.dossierEvenement.create({ data: { dossierId: ids.dossierBloch, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: `Événement numéro ${i}`, createdAt: new Date(maintenant - (30 - i) * 3_600_000) } });
  await prisma.tacheAFaire.create({ data: { cle: `RELANCER_DEVIS:dossier:${ids.dossierBloch}`, type: "RELANCER_DEVIS", source: "RELANCES", sujetType: "DOSSIER", sujetId: ids.dossierBloch, dossierId: ids.dossierBloch, titre: "Relancer le devis · Bloch", raison: "devis envoyé il y a 8 jours", niveau: 2, depuis: new Date(maintenant - 8 * J), dureeMin: 3 } });
  ids.mailBloch = (await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "lister-1", filCanal: "fil-lister-1", sens: "ENTRANT", de: "bloch@exemple.test", deNom: "Hélène Bloch", objet: "Question sur le devis", extrait: "Bonjour, une question sur le devis", recuLe: new Date(maintenant - 3_600_000), classe: "CLIENT", classePar: "TRI", clientId: ids.clientBloch, dossierId: ids.dossierBloch } })).id;
  await prisma.contenuMessage.create({ data: { messageId: ids.mailBloch, texte: "Bonjour, une question sur le devis : le plan de travail est-il compris ?" } });

  // Proposition à valider, dépenses (dont une retirée), publication du site.
  ids.proposition = (await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance du devis Bloch", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "bloch@exemple.test", objet: "Votre devis cuisine", texte: "Bonjour, avez-vous pu regarder le devis ? Lucas", documentIds: [] }), dossierId: ids.dossierBloch, cleUnicite: "lister-relance" } })).id;
  const cetteAnnee = new Date();
  ids.depense = (await prisma.depense.create({ data: { payeeLe: cetteAnnee, montant: 42.5, fournisseur: "Leroy Merlin", categorie: "FOURNITURES" } })).id;
  ids.depenseRetiree = (await prisma.depense.create({ data: { payeeLe: cetteAnnee, montant: 12, fournisseur: "Erreur de saisie", categorie: "AUTRE", archiveLe: new Date(), archiveMotif: "Doublon" } })).id;
  ids.publication = (await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine chêne à Lattes", ville: "Lattes", dossierId: ids.dossierBloch } })).id;

  // Un espace client ouvert (Alice).
  const { avecActeur } = await import("@/lib/journal/contexte");
  const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
  const ouvert = await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, () => ouvrirEspaceDuContact(ids.appeler1));
  ids.dossierAlice = ouvert.dossierId;
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("« lister » : le même contenu que la fonction de l'écran", () => {
  test("LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend les lignes de listerLeads, dans le même ordre", async () => {
    const { listerLeads } = await import("@/lib/prospects/leads");
    for (const vue of ["A_APPELER", "A_RAPPELER", "SANS_SUITE", "ARCHIVES"] as const) {
      const r = await listerAvec({ liste: "LEADS", vue });
      const ecran = await listerLeads({ vue, page: 1, parPage: 20 });
      const donnees = r.donnees as { lignes: { id: string }[]; compteurs: unknown };
      assert.deepEqual(idsDe(donnees.lignes), idsDe(ecran.lignes), `vue ${vue}`);
      assert.deepEqual(donnees.compteurs, ecran.compteurs);
      for (const l of ecran.lignes) assert.ok(r.texte.includes(`[lead:${l.id}]`), `${vue} : ${l.id}`);
    }
    const archives = await listerAvec({ liste: "LEADS", vue: "ARCHIVES" });
    assert.match(archives.texte, /Eliane Oubliette[^\n]*archivé le [^\n]*\(Test\)/);
    const rappel = await listerAvec({ liste: "LEADS", vue: "A_RAPPELER" });
    assert.match(rappel.texte, /Chloé Rappel[^\n]*1 tentative, rappel [^\n]*dernier appel/);
  });

  test("LEADS : filtre source, recherche (campagne comprise) et pages, comme l'écran", async () => {
    const { listerLeads } = await import("@/lib/prospects/leads");
    const meta = await listerAvec({ liste: "LEADS", vue: "A_APPELER", filtres: { source: "META_ADS" } });
    assert.deepEqual(idsDe((meta.donnees as { lignes: { id: string }[] }).lignes), idsDe((await listerLeads({ vue: "A_APPELER", source: "META_ADS", page: 1, parPage: 20 })).lignes));
    const campagne = await listerAvec({ liste: "LEADS", vue: "A_APPELER", recherche: "automne" });
    assert.deepEqual(idsDe((campagne.donnees as { lignes: { id: string }[] }).lignes), idsDe((await listerLeads({ vue: "A_APPELER", recherche: "automne", page: 1, parPage: 20 })).lignes));
    const page2 = await listerAvec({ liste: "LEADS", vue: "A_APPELER", page: 2, par_page: 1 });
    assert.deepEqual(idsDe((page2.donnees as { lignes: { id: string }[] }).lignes), idsDe((await listerLeads({ vue: "A_APPELER", page: 2, parPage: 1 })).lignes));
    assert.match((await listerAvec({ liste: "LEADS", filtres: { source: "INCONNUE_XYZ" } })).texte, /^Refusé : Source de lead inconnue/);
    assert.match((await listerAvec({ liste: "LEADS", vue: "NIMPORTE" })).texte, /^Refusé : Vue inconnue pour LEADS/);
  });

  test("DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) = pageDossiers ; Archivés = dossiersArchives ; par étape = l'ex-« dossiers_par_etape »", async () => {
    const { pageDossiers } = await import("@/lib/dossiers/dossiers");
    const { dossiersArchives } = await import("@/lib/dossiers/archivage");
    for (const vue of ["EN_COURS", "A_FAIRE", "TOUS"] as const) {
      const r = await listerAvec({ liste: "DOSSIERS", vue });
      const ecran = await pageDossiers({ vue, page: 1, parPage: 20 });
      assert.deepEqual(idsDe((r.donnees as { dossiers: { id: string }[] }).dossiers), idsDe(ecran.dossiers), vue);
      assert.deepEqual((r.donnees as { compteurs: unknown }).compteurs, ecran.compteurs);
    }
    // « Masquer les inactifs » (D6) : le même filtre que la case de l'écran.
    const actifs = await listerAvec({ liste: "DOSSIERS", vue: "TOUS", filtres: { masquer_inactifs: true } });
    assert.deepEqual(idsDe((actifs.donnees as { dossiers: { id: string }[] }).dossiers), idsDe((await pageDossiers({ vue: "TOUS", masquerInactifs: true, page: 1, parPage: 20 })).dossiers));
    assert.match(actifs.texte, /inactifs masqués/);
    const recherche = await listerAvec({ liste: "DOSSIERS", recherche: "Salle de bain" });
    assert.deepEqual(idsDe((recherche.donnees as { dossiers: { id: string }[] }).dossiers), idsDe((await pageDossiers({ recherche: "Salle de bain", page: 1, parPage: 20 })).dossiers));
    const archives = await listerAvec({ liste: "DOSSIERS", vue: "ARCHIVES" });
    assert.deepEqual(idsDe((archives.donnees as { lignes: { id: string }[] }).lignes), idsDe(await dossiersArchives()));
    assert.match(archives.texte, /Jules Rangé[^\n]*archivé le [^\n]*\(Hors cible\) \[dossier:/);
    const parEtape = await listerAvec({ liste: "DOSSIERS", vue: "PAR_ETAPE", filtres: { etape: "SIMULATION" } });
    const ancien = await lecture.outilDossiersParEtape.executer({ etape: "SIMULATION" }, { sessionId: session.id, commande: null, utilisateur: "essai", maintenant: new Date() });
    assert.equal(parEtape.texte, ancien.texte);
  });

  test("CLIENTS : pageClients, avec catégorie, source, recherche et fiches archivées", async () => {
    const { pageClients } = await import("@/lib/clients/fiches");
    const tous = await listerAvec({ liste: "CLIENTS" });
    assert.deepEqual(idsDe((tous.donnees as { clients: { id: string }[] }).clients), idsDe((await pageClients({ page: 1, parPage: 20 })).clients));
    const pros = await listerAvec({ liste: "CLIENTS", filtres: { categorie: "PROFESSIONNEL" } });
    assert.deepEqual(idsDe((pros.donnees as { clients: { id: string }[] }).clients), [ids.clientPro]);
    const archives = await listerAvec({ liste: "CLIENTS", vue: "ARCHIVES" });
    assert.deepEqual(idsDe((archives.donnees as { clients: { id: string }[] }).clients), idsDe((await pageClients({ archives: true, page: 1, parPage: 20 })).clients));
    assert.ok(archives.texte.includes(`[client:${ids.clientArchive}]`));
  });

  test("ESPACES : pageClientsEspaces, filtre et tri de l'écran ; l'ex-« espaces_clients » (sans photo ni simulation) repris tel quel", async () => {
    const { pageClientsEspaces } = await import("@/lib/espace/suivi");
    const ecran = await pageClientsEspaces(new Date(), { page: 1, parPage: 50 });
    const r = await listerAvec({ liste: "ESPACES" });
    assert.deepEqual((r.donnees as { clients: { clientId: string }[] }).clients.map((c) => c.clientId), lister.filtrerEspaces(ecran.clients, "TOUS", undefined, undefined).map((c) => c.clientId));
    assert.ok(r.texte.includes(`[dossier:${ids.dossierAlice}]`), r.texte);
    const desactives = await listerAvec({ liste: "ESPACES", vue: "DESACTIVES" });
    assert.equal((desactives.donnees as { clients: unknown[] }).clients.length, 0);
    const relance = await listerAvec({ liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 1 } });
    const ancien = await lecture.outilEspacesClients.executer({ sans_photo_ni_simulation_depuis_jours: 1 }, { sessionId: session.id, commande: null, utilisateur: "essai", maintenant: new Date() });
    assert.equal(relance.texte, ancien.texte);
    // Mission 18 (A1) : l'onglet Espaces n'existe plus ; le lien mène au filtre « Espaces » de Dossiers.
    assert.equal(r.liens?.[0].href, "http://localhost:3001/dossiers?espace=TOUS");
  });

  test("DOSSIERS filtres.espace (ex-onglet Espaces) = pageDossiers({ espace }) : pastilles, étape, compteurs exacts, colonne Espace sur chaque ligne", async () => {
    const { pageDossiers } = await import("@/lib/dossiers/dossiers");
    for (const espace of ["TOUS", "MOI", "CLIENT", "SIGNAUX", "DESACTIVES"] as const) {
      const r = await listerAvec({ liste: "DOSSIERS", filtres: { espace } });
      const ecran = await pageDossiers({ espace, page: 1, parPage: 20 });
      const donnees = r.donnees as { dossiers: { id: string }[]; compteursEspaces: unknown; espace: string };
      assert.deepEqual(idsDe(donnees.dossiers), idsDe(ecran.dossiers), espace);
      assert.deepEqual(donnees.compteursEspaces, ecran.espaces, espace);
      assert.equal(donnees.espace, espace);
    }
    const tous = await listerAvec({ liste: "DOSSIERS", filtres: { espace: "TOUS" } });
    assert.match(tous.texte, /^\d+ dossiers? avec un espace client, filtre « Tous »\. Compteurs des espaces : à moi \d+, chez le client \d+, signaux \d+, tous \d+, désactivés 0\./);
    assert.match(tous.texte, new RegExp(`; espace : Photos attendues · lien pas encore envoyé[^\\n]*\\[dossier:${ids.dossierAlice}\\]`));
    assert.equal(tous.liens?.[0].href, "http://localhost:3001/dossiers?espace=TOUS");
    const etape = await listerAvec({ liste: "DOSSIERS", filtres: { espace: "TOUS", etape_espace: "devis" } });
    assert.deepEqual(idsDe((etape.donnees as { dossiers: { id: string }[] }).dossiers), idsDe((await pageDossiers({ espace: "TOUS", etapeEspace: "DEVIS", page: 1, parPage: 20 })).dossiers));
    assert.equal(etape.liens?.[0].href, "http://localhost:3001/dossiers?espace=TOUS&etapeEspace=DEVIS");
    assert.match((await listerAvec({ liste: "DOSSIERS", filtres: { espace: "TOUS", etape_espace: "NIMPORTE" } })).texte, /^Refusé : Étape d'espace inconnue/);
    // Sans filtre, la colonne aussi : l'état de l'espace sur la ligne du dossier qui en a un.
    const enCours = await listerAvec({ liste: "DOSSIERS" });
    assert.ok((enCours.donnees as { dossiers: { id: string; espace: unknown }[] }).dossiers.find((d) => d.id === ids.dossierAlice)?.espace);
    assert.match(enCours.texte, new RegExp(`; espace : Photos attendues[^\\n]*\\[dossier:${ids.dossierAlice}\\]`));
  });

  test("MAILS : listerVue par vue (rangés compris), recherche dans la vue ; NON_CLASSES = l'ex-« mails_non_classes »", async () => {
    const { listerVue } = await import("@/lib/mail/vues");
    for (const vue of ["A_TRAITER", "CLIENTS", "ADMINISTRATIF", "RANGES"] as const) {
      const r = await listerAvec({ liste: "MAILS", vue });
      assert.deepEqual((r.donnees as { mails: { messageId: string }[] }).mails.map((m) => m.messageId), (await listerVue(vue)).lignes.slice(0, 20).map((m) => m.messageId), vue);
    }
    const trouve = await listerAvec({ liste: "MAILS", vue: "CLIENTS", recherche: "question" });
    assert.ok(trouve.texte.includes(`[mail:${ids.mailBloch}]`));
    const nonClasses = await listerAvec({ liste: "MAILS", vue: "NON_CLASSES" });
    assert.match(nonClasses.texte, /mail[s]? à classer|Aucun mail à classer/);
  });

  test("MESSAGES_ESPACE et RELANCES : le texte des outils qu'ils remplacent", async () => {
    const contexte = { sessionId: session.id, commande: null, utilisateur: "essai", maintenant: new Date() };
    const espace = await import("@/lib/assistant/outils/espace");
    const relances = await import("@/lib/assistant/outils/relances");
    assert.equal((await listerAvec({ liste: "MESSAGES_ESPACE" })).texte, (await espace.outilMessagesEspace.executer({}, contexte)).texte);
    assert.equal((await listerAvec({ liste: "RELANCES" })).texte, (await relances.outilVoirRelances.executer({}, contexte)).texte);
  });

  test("PROPOSITIONS : les onglets de « À valider », et une proposition lue en entier (sensible, champs corrigibles, motifs)", async () => {
    const { listerPropositions } = await import("@/lib/validation/service");
    const r = await listerAvec({ liste: "PROPOSITIONS" });
    assert.deepEqual(idsDe((r.donnees as { propositions: { id: string }[] }).propositions), idsDe(await listerPropositions({ statuts: ["EN_ATTENTE"], limite: 200 })).slice(0, 20));
    const une = await listerAvec({ liste: "PROPOSITIONS", filtres: { proposition_id: ids.proposition } });
    assert.match(une.texte, new RegExp(`\\[proposition:${ids.proposition}\\].*SENSIBLE`));
    assert.match(une.texte, /Champs corrigibles/);
    assert.match(une.texte, /Motifs de rejet : /);
  });

  test("DEPENSES : listerDepenses de l'année, les retirées à part, la période de l'ex-« depenses »", async () => {
    const { listerDepenses } = await import("@/lib/depenses/service");
    const annee = new Date().getFullYear();
    const r = await listerAvec({ liste: "DEPENSES" });
    assert.deepEqual(idsDe((r.donnees as { depenses: { id: string }[] }).depenses), idsDe((await listerDepenses(annee)).depenses).slice(0, 25));
    assert.ok(!r.texte.includes(`[depense:${ids.depenseRetiree}]`));
    const retirees = await listerAvec({ liste: "DEPENSES", vue: "ARCHIVEES" });
    assert.match(retirees.texte, new RegExp(`Erreur de saisie[^\\n]*\\(Doublon\\) \\[depense:${ids.depenseRetiree}\\]`));
    const periode = await listerAvec({ liste: "DEPENSES", filtres: { periode: "mois_en_cours" } });
    const depenses = await import("@/lib/assistant/outils/depenses");
    assert.equal(periode.texte, (await depenses.outilDepenses.executer({ periode: "mois_en_cours" }, { sessionId: session.id, commande: null, utilisateur: "essai", maintenant: new Date() })).texte);
  });

  test("ENCOURS, CHEQUES, QUALITE_FINANCES : chargerTableauFinances ; LIVRE : chargerLivre et le lien CSV", async () => {
    const { chargerTableauFinances } = await import("@/lib/finances/tableau");
    const annee = new Date().getFullYear();
    const t = await chargerTableauFinances(annee);
    assert.deepEqual(((await listerAvec({ liste: "ENCOURS" })).donnees as { lignes: unknown[] }).lignes, t.encours.lignes.slice(0, 20));
    assert.deepEqual(((await listerAvec({ liste: "CHEQUES" })).donnees as { cheques: unknown[] }).cheques, t.cheques);
    assert.deepEqual(((await listerAvec({ liste: "QUALITE_FINANCES" })).donnees as { qualite: unknown[] }).qualite, t.qualite);
    const livre = await listerAvec({ liste: "LIVRE" });
    assert.match(livre.texte, /Livre des recettes \d{4}/);
  });

  test("TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES, ENTREPRISES", async () => {
    const { listerPresets } = await import("@/lib/dossiers/presets");
    const tarifs = await listerAvec({ liste: "TARIFS" });
    for (const p of await listerPresets()) assert.ok(tarifs.texte.includes(`[tarif:${p.id}]`), p.id);
    const publications = await listerAvec({ liste: "PUBLICATIONS" });
    assert.match(publications.texte, new RegExp(`Cuisine chêne à Lattes[^\\n]*brouillon, SANS accord écrit[^\\n]*\\[publication:${ids.publication}\\]`));
    const creneaux = await listerAvec({ liste: "CRENEAUX", filtres: { dossier_id: ids.dossierBloch } });
    const { creneauxLibres } = await import("@/lib/agenda/creneaux");
    assert.deepEqual((creneaux.donnees as { libres: unknown[] }).libres, (await creneauxLibres(new Date())).libres);
    assert.match(creneaux.texte, /Dossier Hélène Bloch : date posée aucune/);
    const teintes = await listerAvec({ liste: "TEINTES", recherche: "white" });
    assert.deepEqual((teintes.donnees as { teintes: { ref: string }[] }).teintes.map((t) => t.ref).sort(), ["J3", "NE31"]);
    assert.match((await listerAvec({ liste: "ENTREPRISES" })).texte, /^Refusé : Donne un nom, un SIREN ou un SIRET/);
    assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  });
});

describe("« etat_crm » : tout ce qui est ouvert en un appel, ou une partie", () => {
  test("sans partie : tâches du jour, alertes, argent en attente, derniers événements et sources — un seul appel journalisé", async () => {
    const avant = await prisma.appelOutil.count({ where: { sessionId: session.id } });
    const r = await executer(etat.outilEtatCrm, {});
    assert.equal(await prisma.appelOutil.count({ where: { sessionId: session.id } }), avant + 1);
    for (const titre of ["TÂCHES DU JOUR", "ALERTES", "ARGENT EN ATTENTE", "DERNIERS ÉVÉNEMENTS", "SOURCES"]) assert.ok(r.texte.includes(titre), titre);
    assert.match(r.texte, /Reste à encaisser/);
    assert.match(r.texte, /Devis en attente de réponse/);
    assert.ok(r.texte.includes(`[lead:${ids.appeler2}]`), "les leads arrivés");
    assert.ok(r.texte.includes(`[dossier:${ids.dossierBloch}]`), "les événements des dossiers");
    const d = r.donnees as { taches: unknown; argent: unknown; evenements: unknown[]; leads: unknown[]; sources: unknown };
    assert.ok(d.taches && d.argent && d.evenements.length && d.leads.length);
  });

  test("chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS, META… : les anciens outils repris)", async () => {
    const contexte = { sessionId: session.id, commande: null, utilisateur: "essai", maintenant: new Date() };
    for (const partie of etat.PARTIES_ETAT) {
      const r = await executer(etat.outilEtatCrm, { partie });
      assert.ok(!/a échoué|^Refusé/.test(r.texte), `${partie} : ${r.texte.slice(0, 300)}`);
    }
    const catalogue = await import("@/lib/assistant/outils/catalogue-outils");
    assert.equal((await executer(etat.outilEtatCrm, { partie: "OUTILS" })).texte, (await catalogue.outilListerOutils.executer({}, contexte)).texte);
    const parametres = await executer(etat.outilEtatCrm, { partie: "PARAMETRES" });
    assert.match(parametres.texte, /Aucun secret n'est lu ni rendu/);
    const consignes = await executer(etat.outilEtatCrm, { partie: "CONSIGNES" });
    assert.match(consignes.texte, /Texte par défaut \(« Revenir au défaut »\)/);
    const coherence = await executer(etat.outilEtatCrm, { partie: "COHERENCE" });
    assert.match(coherence.texte, /Cohérence|incohérence/);
  });
});

describe("les archivés se trouvent, et « lire_fiche » rend tout", () => {
  test("« chercher » : archives: true rend le lead, le dossier et la fiche archivés, marqués ARCHIVÉ ; un nom seul les trouve aussi", async () => {
    const sans = await executer(lecture.outilChercher, { texte: "Oubliette" });
    assert.ok(sans.texte.includes(`[lead:${ids.leadArchive}]`), "un nom qui ne désigne qu'un archivé le rend");
    assert.match(sans.texte, /ARCHIVÉ le/);
    const avec = await executer(lecture.outilChercher, { texte: "Rangé", archives: true });
    assert.ok(avec.texte.includes(`[dossier:${ids.dossierArchive}]`), avec.texte);
    const fiche = await executer(lecture.outilChercher, { texte: "Gaston Parti", archives: true });
    assert.ok(fiche.texte.includes(`[client:${ids.clientArchive}]`), fiche.texte);
    const vivant = await executer(lecture.outilChercher, { texte: "Appelle" });
    assert.ok(!vivant.texte.includes("ARCHIVÉ"));
  });

  test("les résolveurs de cible voient les archivés : « lire_fiche » par le nom d'un dossier archivé", async () => {
    const r = await executer(lecture.outilLireFiche, { nom: "Jules Rangé" });
    assert.match(r.texte, /^Dossier Jules Rangé/);
    assert.match(r.texte, /ARCHIVÉ le [^\n]*\(Hors cible\)/);
  });

  test("dossier : historique complet paginé, tâches, mails, devis, paiements, espace ; client : fiche complète", async () => {
    const r = await executer(lecture.outilLireFiche, { dossierId: ids.dossierBloch, nombre: 10 });
    assert.match(r.texte, /^Dossier Hélène Bloch — Cuisine \(Montpellier\) : étape « Devis envoyé »/);
    assert.match(r.texte, /Historique \(1–10 sur \d+ ; « decalage: 10 » pour les plus anciens\)/);
    assert.match(r.texte, /Événement numéro 25/);
    assert.ok(!/Événement numéro 1\b/.test(r.texte));
    const suite = await executer(lecture.outilLireFiche, { dossierId: ids.dossierBloch, nombre: 10, decalage: 20 });
    assert.match(suite.texte, /Événement numéro 1\b/);
    assert.match(r.texte, /Tâches de Lucas : Relancer le devis · Bloch — à faire \[tache:/);
    assert.ok(r.texte.includes(`[mail:${ids.mailBloch}]`), "les mails");
    assert.match(r.texte, /Paiements : /);
    assert.match(r.texte, /Fiche : particulier[^\n]*provenance SITE_DEVIS/);
    assert.match(r.texte, /Passif : Cliente fidèle/);
    assert.match(r.texte, /Coordonnées : e-mails bloch@exemple\.test[^\n]*\[coordonnee:/);
    const chrono = await executer(lecture.outilLireFiche, { dossierId: ids.dossierBloch, chronologie: 5, familles: ["MAIL"] });
    assert.match(chrono.texte, /Chronologie \(\d+\/\d+, MAIL\)/);
    const espace = await executer(lecture.outilLireFiche, { dossierId: ids.dossierAlice, messages: 0 });
    assert.match(espace.texte, /Espace client : étape du client/);
    assert.match(espace.texte, /voir comme le client : http/);
  });

  test("lead : tous les champs de la fiche (campagne, tentatives, dernier appel, archivage)", async () => {
    const r = await executer(lecture.outilLireFiche, { leadId: ids.rappeler });
    assert.match(r.texte, /Fiche : 06 11 00 00 03[^\n]*1 tentative, dernier appel/);
    const archive = await executer(lecture.outilLireFiche, { leadId: ids.leadArchive });
    assert.match(archive.texte, /ARCHIVÉ le [^\n]*\(Test\)/);
    const campagne = await executer(lecture.outilLireFiche, { leadId: ids.appeler1 });
    assert.match(campagne.texte, /campagne Campagne automne/);
  });
});
