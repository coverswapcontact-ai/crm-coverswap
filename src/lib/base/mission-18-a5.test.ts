import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-a5-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env.
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "META_ACCESS_TOKEN", "META_PIXEL_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (A5) — Tâches de fond passe dans Paramètres, onglet « Système » : la file des tâches de fond, les travaux
 * périodiques, le contrôle de cohérence, l'audit des connexions et les sessions de l'assistant, lus à l'ouverture de
 * l'onglet par leurs propres routes. `/taches-de-fond` redirige vers `/parametres?section=systeme`, que la page passe à
 * ses onglets. Un seul compteur : plus de badge « tâches de fond en échec » dans la navigation, l'échec remonte comme
 * tâche système dans Tâches (sa clé `SYSTEME:taches-de-fond` ne change pas, son raccourci mène à l'onglet). Tous les
 * liens (tâches, alertes, assistant) mènent à l'onglet. Base d'essai, aucun réseau.
 */

const RACINE = path.resolve(__dirname, "..", "..", "..");
const lire = (relatif: string) => readFileSync(path.join(RACINE, relatif), "utf8");
const ONGLET = "http://localhost:3001/parametres?section=systeme";

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let sections: typeof import("@/lib/parametres/sections");
let execution: typeof import("@/lib/assistant/execution");
let session: import("@/lib/assistant/execution").Session;
const fetchOriginal = globalThis.fetch;
const appelsReseau: string[] = [];

const executer = (outil: unknown, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(outil as DefinitionOutil, entree, session, new Date());

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    appelsReseau.push(url);
    throw new Error(`réseau coupé pendant les essais : ${url}`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  sections = await import("@/lib/parametres/sections");
  execution = await import("@/lib/assistant/execution");
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("l'onglet Système de Paramètres", () => {
  test("adresse de l'onglet : /parametres?section=systeme", () => {
    assert.equal(sections.SECTION_SYSTEME, "systeme");
    assert.equal(sections.ADRESSE_SYSTEME, "/parametres?section=systeme");
  });

  test("la page passe ?section= à ses onglets (rien sans section) et ne lance pas le contrôle de cohérence", async () => {
    const page = (await import("@/app/(pilotage)/parametres/page")).default;
    const ouvrir = async (parametres: Record<string, string>) => ((await page({ searchParams: Promise.resolve(parametres) })) as unknown as { props: { section: string | null } }).props;
    assert.equal((await ouvrir({ section: "systeme" })).section, "systeme");
    assert.equal((await ouvrir({})).section, null);
    const source = lire("src/app/(pilotage)/parametres/page.tsx");
    assert.doesNotMatch(source, /controlerCoherence|auditerConnexions|etatDesTaches|sessionsRecentes/, "l'onglet Système se lit à la demande, pas avec la page");
  });

  test("l'onglet « Système » existe ; ?section=, #systeme, #taches-de-fond, #coherence, #audit et #sessions l'ouvrent", () => {
    const onglets = lire("src/app/(pilotage)/parametres/_components/OngletsParametres.tsx");
    assert.match(onglets, /\{ valeur: "systeme", libelle: "Système" \}/);
    for (const ancre of ["systeme", "\"taches-de-fond\"", "coherence", "audit", "sessions"]) assert.match(onglets, new RegExp(`${ancre}: "systeme"`), ancre);
    assert.match(onglets, /ongletDe\(ancre\) \?\? ongletDe\(section\) \?\? memorise/, "l'ancre, puis la section de l'adresse, puis la mémoire");
    assert.match(onglets, /onglet === "systeme" \? <SectionSysteme \/> : null/);
  });

  test("la section lit chaque bloc par la route de son bouton, dans l'ordre de l'ancien écran", () => {
    const section = lire("src/app/(pilotage)/parametres/_components/SectionSysteme.tsx");
    const routes = [...section.matchAll(/url="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(routes, ["/api/taches", "/api/coherence", "/api/audit/connexions", "/api/assistant/sessions"]);
    for (const [composant, route] of [["EtatTaches", "/api/taches"], ["ControleCoherence", "/api/coherence"], ["AuditConnexions", "/api/audit/connexions"], ["SessionsAssistant", "/api/assistant/sessions"]]) {
      assert.match(lire(`src/app/(pilotage)/parametres/_components/${composant}.tsx`), new RegExp(`appelApi<[^>]+>\\("${route.replace(/\//g, "\\/")}"\\)`), composant);
    }
    assert.doesNotMatch(lire("src/app/(pilotage)/parametres/_components/EtatTaches.tsx"), /EnTetePage/, "un bloc de l'onglet, plus un écran");
  });

  test("les routes des blocs répondent comme la section les attend", async () => {
    const etat = await (await (await import("@/app/api/taches/route")).GET()).json();
    assert.ok(Array.isArray(etat.taches) && typeof etat.compteurs.ECHEC_DEFINITIF === "number" && Array.isArray(etat.planifications));
    const coherence = await (await (await import("@/app/api/coherence/route")).GET()).json();
    assert.ok(Array.isArray(coherence.incoherences) && typeof coherence.dossiersControles === "number");
    const audit = await (await (await import("@/app/api/audit/connexions/route")).GET()).json();
    assert.ok(Array.isArray(audit.maillons));
    const sessions = await (await (await import("@/app/api/assistant/sessions/route")).GET()).json();
    assert.ok(Array.isArray(sessions.sessions));
  });
});

describe("l'adresse /taches-de-fond et la navigation", () => {
  test("/taches-de-fond redirige vers l'onglet, sans chaîne, en 307 comme les autres anciennes adresses", async () => {
    const config = (await import("../../../next.config")).default;
    const regles = await config.redirects!();
    const regle = regles.find((r) => r.source === "/taches-de-fond");
    assert.ok(regle);
    assert.equal(regle.destination, sections.ADRESSE_SYSTEME);
    assert.equal(regle.permanent, false);
    assert.ok(!regles.some((r) => r.source === "/parametres"), "la destination ne redirige pas");
  });

  test("l'écran est retiré ; la navigation n'a plus d'onglet Tâches de fond ni de badge des échecs", () => {
    assert.ok(!existsSync(path.join(RACINE, "src/app/(pilotage)/taches-de-fond")), "plus d'écran /taches-de-fond");
    const navigation = lire("src/components/pilotage/Navigation.tsx");
    assert.doesNotMatch(navigation, /libelle: "Tâches de fond"/);
    assert.doesNotMatch(navigation, /tachesEnEchec/, "un seul compteur");
    assert.doesNotMatch(navigation, /Workflow/);
  });

  test("plus aucun lien vers l'écran retiré dans le code (src et public, hors essais)", () => {
    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = path.join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.(tsx?|js|mjs|webmanifest)$/.test(nom) && !nom.endsWith(".test.ts")) {
          readFileSync(chemin, "utf8")
            .split("\n")
            .forEach((ligne, i) => {
              // Une adresse dans le code (chaîne ou gabarit), pas un commentaire qui raconte la redirection.
              if (/(["'`]|\})\/taches-de-fond(?![\w-])/.test(ligne) && !/^\s*(\/\/|\*|\/\*)/.test(ligne)) fautifs.push(`${path.relative(RACINE, chemin)}:${i + 1}`);
            });
        }
      }
    };
    parcourir(path.join(RACINE, "src"));
    parcourir(path.join(RACINE, "public"));
    assert.deepEqual(fautifs, []);
  });
});

describe("un seul compteur : l'échec est une tâche système qui mène à l'onglet", () => {
  test("une tâche de fond en échec : « Relancer … » dans Tâches (comptée aujourd'hui), raccourci vers l'onglet ; la route garde sa clé", async () => {
    const { passeComplete } = await import("@/lib/a-faire/detection");
    const { detecteurSysteme } = await import("@/lib/a-faire/detecteurs/systeme");
    const { compterAujourdhui } = await import("@/lib/a-faire/lecture");
    const maintenant = new Date();
    const avant = await compterAujourdhui(maintenant);
    await prisma.tache.create({ data: { type: "ESSAI_A5", cle: "essai:a5:echec", statut: "ECHEC_DEFINITIF", tentatives: 8, derniereErreur: "boum", demandeePar: "SCRIPT:essai", termineLe: new Date(maintenant.getTime() - 3_600_000) } });
    await passeComplete(maintenant, { sources: ["SYSTEME"], detecteurs: [detecteurSysteme] });
    const ligne = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: "SYSTEME:taches-de-fond" } });
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Relancer 1 tâche de fond en échec", 4]);
    assert.equal(JSON.parse(ligne.raccourci ?? "{}").href, sections.ADRESSE_SYSTEME);
    assert.ok((await compterAujourdhui(maintenant)) >= Math.min(10, avant + 1), "l'échec compte dans l'onglet Tâches");

    const compteurs = await (await (await import("@/app/api/pilotage/compteurs/route")).GET()).json();
    assert.equal(compteurs.tachesEnEchec, 1, "la clé reste dans la réponse (clients d'avant), la navigation ne l'affiche plus");
  });

  test("l'alerte « tâches de fond en échec » de l'Analytique et du point du jour mène à l'onglet", async () => {
    const { calculerAlertes } = await import("@/lib/synthese/alertes");
    const alerte = (await calculerAlertes(new Date())).find((a) => a.code === "TACHES_EN_ECHEC");
    assert.ok(alerte);
    assert.equal(alerte.lien, sections.ADRESSE_SYSTEME);
  });
});

describe("les outils de l'assistant mènent à l'onglet", () => {
  test("etat_crm (vue générale, SANTE, TACHES_DE_FOND, COHERENCE, AUDIT, SESSIONS), agir_systeme et manager_operations", async () => {
    const { outilEtatCrm } = await import("@/lib/assistant/outils/etat");
    const { outilAgirSysteme } = await import("@/lib/assistant/outils/gestes");
    const { outilManagerOperations } = await import("@/lib/assistant/analyses/operations");
    const resultats: [string, ResultatOutil][] = [["vue générale", await executer(outilEtatCrm, {})]];
    for (const partie of ["SANTE", "TACHES_DE_FOND", "COHERENCE", "AUDIT", "SESSIONS"]) resultats.push([partie, await executer(outilEtatCrm, { partie })]);
    const echec = await prisma.tache.create({ data: { type: "ESSAI_A5", cle: "essai:a5:outil", statut: "ECHEC_DEFINITIF", tentatives: 8, derniereErreur: "boum", demandeePar: "SCRIPT:essai" } });
    resultats.push(["RELANCER_TACHE", await executer(outilAgirSysteme, { action: "RELANCER_TACHE", id: echec.id })]);
    resultats.push(["CORRIGER_INCOHERENCE", await executer(outilAgirSysteme, { action: "CORRIGER_INCOHERENCE", cle: "CODE:inexistant" })]);
    resultats.push(["manager_operations", await executer(outilManagerOperations, {})]);
    for (const [nom, r] of resultats) {
      const liens = (r.liens ?? []).map((l) => l.href);
      assert.ok(liens.includes(ONGLET), `${nom} : ${JSON.stringify(liens)}`);
      for (const href of liens) assert.doesNotMatch(href, /\/taches-de-fond/, nom);
    }
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { id: echec.id } })).statut, "EN_ATTENTE", "relancée comme par le bouton de l'onglet");
    assert.deepEqual(appelsReseau, []);
  });
});
