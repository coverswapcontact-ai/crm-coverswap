import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-lot6-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25 (lot 6) — l'écran Leads et la fiche dossier : « Archiver les anciens leads » (le nombre exact, puis
 * l'archivage d'un geste, réversible ; rien d'autre ne bouge), la ligne Situation dans les listes Leads et Dossiers,
 * les résumés de la fiche (`/api/messagerie/suivi`), l'ancien circuit de relances qui se tait quand la messagerie est
 * en service (ses tâches ouvertes : « Pas à faire », pas « Faite »), et les écrans par leur source (sections, boutons,
 * onglet d'ouverture). Clients fictifs (plage 06 39 98).
 */

let prisma: typeof import("@/lib/prisma").default;
let leads: typeof import("@/lib/prospects/leads");
let suivis: typeof import("./suivis");
let analyse: typeof import("./analyse");
let horaires: typeof import("./horaires");

const lire = (fichier: string) => readFileSync(path.join(process.cwd(), fichier), "utf8").replace(/\r\n/g, "\n");
let horloge: Date;
let numero = 70;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Fiction", telephone: `06399800${numero++}`, email: `${prenom.toLowerCase()}@exemple.fr`, ville: "Mauguio", source: "META_ADS", typeProjet: "CUISINE", ...donnees } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  leads = await import("@/lib/prospects/leads");
  suivis = await import("./suivis");
  analyse = await import("./analyse");
  horaires = await import("./horaires");
  (await import("./alertes")).definirAlertesEssai(() => undefined);
  let jour = horaires.momentParis(new Date(Date.now() + 86_400_000)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
});

after(async () => {
  (await import("./alertes")).definirAlertesEssai(null);
  await prisma.$disconnect();
});

describe("Mission 25 (lot 6) — « Archiver les anciens leads »", () => {
  test("le nombre exact d'abord ; puis seuls les « À appeler » d'avant le 25/09 sont archivés, avec le motif ; « Annuler » les rend", async () => {
    const vieux1 = await lead("Ancienne", { createdAt: new Date("2026-06-12T09:00:00Z") });
    const vieux2 = await lead("Antoine", { createdAt: new Date("2026-09-24T21:59:00Z") }); // 24/09 à 23 h 59 à Paris
    const appele = await lead("Appelée", { createdAt: new Date("2026-08-01T09:00:00Z"), dernierAppelLe: new Date("2026-08-02T09:00:00Z") });
    const recent = await lead("Récente", { createdAt: new Date("2026-09-24T22:00:00Z") }); // 25/09 à minuit à Paris
    const avant = await leads.listerLeads({ vue: "A_APPELER", page: 1 }, horloge);
    assert.equal(avant.compteurs.anciens, 2, "le nombre montré dans le bouton");

    const { archiverAnciensLeads, appliquerActionLeads, MOTIF_ANCIEN_LEAD } = await import("@/lib/prospects/menage");
    const { POST } = await import("@/app/api/leads/anciens/route");
    const reponse = await POST();
    const { ids } = (await reponse.json()) as { ids: string[] };
    assert.deepEqual(ids.sort(), [vieux1.id, vieux2.id].sort());
    const archives = await prisma.lead.findMany({ where: { id: { in: [vieux1.id, vieux2.id, appele.id, recent.id] }, archiveLe: undefined }, select: { id: true, archiveLe: true, archiveMotif: true } });
    const parId = new Map(archives.map((l) => [l.id, l]));
    assert.equal(parId.get(vieux1.id)?.archiveMotif, MOTIF_ANCIEN_LEAD);
    assert.equal(MOTIF_ANCIEN_LEAD, "Ancien lead, avant la campagne du 25/09");
    assert.ok(parId.get(vieux2.id)?.archiveLe);
    assert.equal(parId.get(appele.id)?.archiveLe, null, "un lead déjà appelé (« À rappeler ») ne bouge pas");
    assert.equal(parId.get(recent.id)?.archiveLe, null, "un lead de la campagne ne bouge pas");
    assert.equal((await leads.listerLeads({ vue: "A_APPELER", page: 1 }, horloge)).compteurs.anciens, 0);
    assert.deepEqual((await archiverAnciensLeads(horloge)).ids, [], "rejouer n'archive rien de plus");

    await appliquerActionLeads({ action: "RESTAURER", ids });
    assert.equal((await leads.listerLeads({ vue: "A_APPELER", page: 1 }, horloge)).compteurs.anciens, 2, "« Annuler » : ils reviennent");
    await archiverAnciensLeads(horloge);
  });
});

describe("Mission 25 (lot 6) — la ligne Situation dans les listes", () => {
  test("Leads : celle du suivi quand la messagerie l'a lu, sinon la règle de « Où on en est »", async () => {
    await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
    suivis.oublierLancement();
    const lu = await lead("Lucie");
    const suiviId = (await suivis.suiviPour({ leadId: lu.id }))!.id;
    await analyse.analyserSuivi(suiviId, horloge);
    const sansSuivi = await lead("Paul", { createdAt: new Date("2026-10-08T09:00:00Z") });
    const liste = await leads.listerLeads({ vue: "A_APPELER", page: 1 }, horloge);
    const situation = (id: string) => liste.lignes.find((l) => l.id === id)?.situation;
    const duSuivi = JSON.parse((await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })).ouEnEst) as { situation: string };
    assert.equal(situation(lu.id), duSuivi.situation);
    assert.equal(situation(sansSuivi.id), "Lead du 08/10 (Meta), pas encore appelé.");
  });

  test("Dossiers : la situation du suivi, le mail du client (bouton ✉️)", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Rose Fiction", clientAdresse: "1 rue des Essais", clientCp: "34130", clientVille: "Mauguio", clientTelephone: "06 39 98 00 90", clientEmail: "rose@exemple.fr", objet: "Cuisine", source: "ENTRANT" } });
    const suivi = (await suivis.suiviPour({ dossierId: dossier.id }, { geste: true }))!;
    await analyse.analyserSuivi(suivi.id, horloge);
    const { listerDossiers } = await import("@/lib/dossiers/dossiers");
    const ligne = (await listerDossiers()).find((d) => d.id === dossier.id)!;
    assert.equal(ligne.clientEmail, "rose@exemple.fr");
    assert.ok(ligne.situation && ligne.situation.length > 5, String(ligne.situation));
    assert.equal(ligne.situation, (JSON.parse((await prisma.suivi.findUniqueOrThrow({ where: { id: suivi.id } })).ouEnEst) as { situation: string }).situation);
  });
});

describe("Mission 25 (lot 6) — la fiche dossier lit la messagerie", () => {
  test("/api/messagerie/suivi : « Où on en est », le journal et les résumés (conversation, simulations, espace, zone)", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Iris Fiction", clientAdresse: "2 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "06 39 98 00 91", objet: "Salle de bain", source: "ENTRANT" } });
    const { GET } = await import("@/app/api/messagerie/suivi/route");
    const { NextRequest } = await import("next/server");
    const reponse = await GET(new NextRequest(`http://localhost:3001/api/messagerie/suivi?dossierId=${dossier.id}`));
    const corps = (await reponse.json()) as { suiviId: string; ouEnEst: { situation: string } | null; journal: unknown[]; fiche: import("./fiche").FicheSuivi };
    assert.equal(reponse.status, 200);
    assert.ok(corps.suiviId);
    assert.ok(corps.ouEnEst?.situation, "jamais vide");
    assert.equal(corps.fiche.zone, "PROCHE", "Lattes : à 25 km ou moins de Pérols");
    assert.deepEqual(corps.fiche.simulations, { nombre: 0, derniereLe: null, vue: false });
    assert.equal(corps.fiche.espace.ouvert, false);
    assert.equal(typeof corps.fiche.conversation.nonLue, "boolean");
    assert.ok(Array.isArray(corps.fiche.conversation.prets));
  });
});

describe("Mission 25 (lot 6) — l'ancien circuit de relances se tait", () => {
  test("messagerie en service : le détecteur RELANCES ne propose plus rien ; une relance ouverte et jamais faite → « Pas à faire »", async () => {
    const { messagerieEnService } = await import("./suivis");
    assert.equal(await messagerieEnService(horloge), true);
    const { detecteurRelances } = await import("@/lib/a-faire/detecteurs/relances");
    assert.deepEqual(await detecteurRelances.detecter({ maintenant: horloge } as Parameters<typeof detecteurRelances.detecter>[0]), []);
    const dossier = await prisma.dossier.create({ data: { clientNom: "Hugo Fiction", clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "06 39 98 00 92", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
    const { issueDeLAbsence } = await import("@/lib/a-faire/achevement");
    const tache = { id: "essai", type: "RELANCER_DEVIS", leadId: null, dossierId: dossier.id, clientId: null, depuis: new Date(horloge.getTime() - 3 * 86_400_000), raccourci: "{}", donnees: "{}", source: "RELANCES" } as Parameters<typeof issueDeLAbsence>[0];
    assert.deepEqual(await issueDeLAbsence(tache, horloge), { statut: "PAS_A_FAIRE", raison: "AUTRE", texte: "coché par le CRM : relance confiée à la messagerie" });
  });
});

describe("Mission 25 (lot 6) — les écrans, par leur source", () => {
  const panneau = lire("src/app/(pilotage)/dossiers/_components/PanneauDossier.tsx");
  test("la fiche dossier : en tête nom, étape, « Où on en est », quatre boutons ; neuf sections dans l'ordre ; retenues ; plus de carte de relance", () => {
    const enTete = panneau.slice(panneau.indexOf("<header"), panneau.indexOf("</header>"));
    for (const morceau of ["<SheetTitle", "<PastilleEtape", "<OuEnEstFiche", "<BoutonsContact"]) assert.ok(enTete.includes(morceau), morceau);
    const titres = [...panneau.matchAll(/<SectionRepliable id="[^"]+" icone="([^"]+)" titre="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(titres, ["🎯 Prochaine action", "💬 Conversation", "🎨 Simulations et photos", "📄 Devis et factures", "🏠 Projet", "💶 Paiements", "🔗 Espace client", "🕓 Journal et historique", "⋯ Le reste du dossier"]);
    assert.match(panneau, /const SECTIONS_PAR_DEFAUT: Record<Sections, boolean> = \{ prochaine: true, conversation: false/);
    assert.match(panneau, /journal: false, reste: false \}/);
    assert.match(panneau, /window\.localStorage\.setItem\(CLE_SECTIONS/);
    assert.ok(!panneau.includes("RelancesDuDossier"), "la carte de l'ancien circuit est remplacée par la conversation");
  });
  test("les boutons ronds : Appeler, SMS (Messages sur le numéro), copier le mail, copier le numéro, « Copié ✅ »", () => {
    const boutons = lire("src/components/messagerie/BoutonsContact.tsx");
    for (const morceau of ["href={`tel:${numero}`}", "href={`sms:${numero}`}", '"Copié ✅"', 'copierCe("mail")', 'copierCe("numero")', "noterDebutAppel("]) assert.ok(boutons.includes(morceau), morceau);
  });
  test("Leads : ouvert sur « À appeler » ; la ligne : Situation et 📞 💬 ✉️ ; le bouton des anciens leads ; les listes Dossiers aussi", () => {
    const page = lire("src/app/(pilotage)/leads/page.tsx");
    assert.match(page, /const vue: VueLeads = parametres\.liste === "rappeler" \? "A_RAPPELER" : "A_APPELER";/);
    assert.ok(!page.includes("compterLeadsEnRetard"), "plus d'ouverture sur « À rappeler » quand il y a des retards");
    const ligne = lire("src/app/(pilotage)/leads/_components/LigneLead.tsx");
    assert.ok(ligne.includes("<BoutonsContact") && ligne.includes("lead.situation"));
    const ecran = lire("src/app/(pilotage)/leads/_components/EcranLeads.tsx");
    assert.match(ecran, /Archiver les anciens leads \(\{donnees\.compteurs\.anciens\}\)/);
    for (const fichier of ["src/app/(pilotage)/dossiers/_components/CarteDossier.tsx", "src/app/(pilotage)/dossiers/_components/VueListe.tsx"]) {
      const source = lire(fichier);
      assert.ok(source.includes("<BoutonsContact") && source.includes("dossier.situation"), fichier);
    }
  });
});
