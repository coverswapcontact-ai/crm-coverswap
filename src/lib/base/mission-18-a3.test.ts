import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-a3-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env.
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "META_ACCESS_TOKEN", "META_PIXEL_ID"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (A3) — Dépenses passe dans Finances : la page Finances charge, pour l'année demandée, la liste de l'ancien
 * écran (`listerDepenses`, les chantiers de la fiche d'une dépense) et la rend dans sa section « Dépenses » ;
 * `?section=depenses` (où redirige /depenses) y descend. La saisie /depenses/nouvelle reste un écran (raccourci de
 * l'application installée, file hors ligne) et ramène à la section ; le panneau du dossier garde ses dépenses, avec le
 * même composant. Plus aucun lien vers l'écran retiré. Base d'essai, noms fictifs.
 */

const RACINE = path.resolve(__dirname, "..", "..", "..");
const lire = (relatif: string) => readFileSync(path.join(RACINE, relatif), "utf8");

let prisma: typeof import("@/lib/prisma").default;
let service: typeof import("@/lib/depenses/service");
let constantes: typeof import("@/lib/depenses/constantes");
let pageFinances: typeof import("@/app/(pilotage)/finances/page").default;

type Props = {
  initial: { annee: number };
  depenses: { liste: Awaited<ReturnType<typeof import("@/lib/depenses/service").listerDepenses>>; chantiers: { id: string }[] };
  section: string | null;
};
/** La page Finances comme Next la rend (composant serveur), avec les paramètres d'adresse donnés. */
async function ouvrirFinances(parametres: Record<string, string>): Promise<Props> {
  const element = await pageFinances({ searchParams: Promise.resolve(parametres) });
  return (element as unknown as { props: Props }).props;
}

const ids = { chantier: "", depenses2025: [] as string[], depense2026: "", retiree: "" };

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  service = await import("@/lib/depenses/service");
  constantes = await import("@/lib/depenses/constantes");
  pageFinances = (await import("@/app/(pilotage)/finances/page")).default;

  const chantier = await prisma.dossier.create({
    data: { clientNom: "Client Essai Pose", clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33670000301", objet: "Cuisine", source: "ENTRANT", etape: "CHANTIER" },
  });
  ids.chantier = chantier.id;
  const depense = (donnees: Record<string, unknown>) =>
    prisma.depense.create({ data: { montant: 10, fournisseur: "Fournisseur Essai", categorie: "FOURNITURES", payeeLe: new Date("2025-03-10T10:00:00Z"), ...donnees } });
  ids.depenses2025 = [
    (await depense({ montant: 120.5, fournisseur: "Négoce Essai", categorie: "MATIERE", dossierId: chantier.id, payeeLe: new Date("2025-06-02T10:00:00Z") })).id,
    (await depense({ montant: 29, fournisseur: "Logiciel Essai", categorie: "LOGICIELS", horsChantier: true, payeeLe: new Date("2025-04-15T10:00:00Z") })).id,
    (await depense({ montant: 18.4, fournisseur: "Quincaillerie Essai" })).id,
  ];
  ids.retiree = (await depense({ montant: 99, fournisseur: "Doublon Essai", archiveLe: new Date("2025-03-11T10:00:00Z"), archiveMotif: "Doublon" })).id;
  ids.depense2026 = (await depense({ montant: 45, fournisseur: "Carburant Essai", categorie: "DEPLACEMENT", dossierId: chantier.id, payeeLe: new Date("2026-02-01T10:00:00Z") })).id;
});
after(async () => {
  await prisma.$disconnect();
});

describe("la section Dépenses de Finances", () => {
  test("la page Finances charge les dépenses de l'année demandée comme l'ancien écran (liste, à traiter, chantiers de la fiche)", async () => {
    const props = await ouvrirFinances({ annee: "2025", section: "depenses" });
    assert.equal(props.initial.annee, 2025, "le tableau et les dépenses sont sur la même année");
    assert.deepEqual(props.depenses.liste, await service.listerDepenses(2025));
    assert.deepEqual(
      props.depenses.liste.depenses.map((d) => d.id),
      [ids.depenses2025[0], ids.depenses2025[1], ids.depenses2025[2]],
      "l'année seulement, la plus récente d'abord, sans la dépense retirée"
    );
    assert.equal(props.depenses.liste.total, 167.9);
    assert.deepEqual([props.depenses.liste.aRattacher, props.depenses.liste.sansJustificatif], [1, 3]);
    assert.deepEqual(props.depenses.chantiers, (await service.suggestionsSaisie()).chantiers);
    assert.ok(props.depenses.chantiers.some((c) => c.id === ids.chantier), "le chantier à la pose est proposé dans la fiche d'une dépense");
    assert.equal(props.section, constantes.SECTION_DEPENSES, "?section=depenses descend à la section");
  });

  test("sans section (ou une section inconnue) l'écran s'ouvre en haut ; une année illisible donne l'année en cours", async () => {
    const annee = Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()));
    const parDefaut = await ouvrirFinances({});
    assert.equal(parDefaut.section, null);
    assert.equal(parDefaut.depenses.liste.annee, annee);
    assert.equal((await ouvrirFinances({ section: "livre" })).section, null);
    const illisible = await ouvrirFinances({ annee: "deux-mille", section: "depenses" });
    assert.deepEqual([illisible.initial.annee, illisible.depenses.liste.annee, illisible.section], [annee, annee, "depenses"]);
    const autre = await ouvrirFinances({ annee: "2026" });
    assert.deepEqual(autre.depenses.liste.depenses.map((d) => d.id), [ids.depense2026]);
  });

  test("la section se recharge par la même route que l'ancien écran (GET /api/depenses?annee=)", async () => {
    const route = await import("@/app/api/depenses/route");
    const reponse = await route.GET(new NextRequest("http://localhost/api/depenses?annee=2025"));
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), JSON.parse(JSON.stringify(await service.listerDepenses(2025))));
  });

  test("le panneau du dossier garde ses dépenses, avec le même composant", async () => {
    const panneau = lire("src/app/(pilotage)/dossiers/_components/PanneauDossier.tsx");
    assert.match(panneau, /<DepensesDossier detail=\{detail\} \/>/);
    const bloc = lire("src/app/(pilotage)/dossiers/_components/DepensesDossier.tsx");
    assert.match(bloc, /`\/api\/dossiers\/\$\{detail\.id\}\/depenses`/);
    assert.match(bloc, /`\/depenses\/nouvelle\?dossier=\$\{detail\.id\}`/);
    const { depenses } = await service.depensesDuDossier(ids.chantier);
    assert.deepEqual(depenses.map((d) => d.id).sort(), [ids.depense2026, ids.depenses2025[0]].sort(), "toutes années confondues");
  });
});

describe("l'adresse /depenses, la saisie et les liens", () => {
  test("adresses de la section : /finances?section=depenses, avec l'année si on la donne", () => {
    assert.equal(constantes.ADRESSE_DEPENSES, "/finances?section=depenses");
    assert.equal(constantes.adresseDepenses(), "/finances?section=depenses");
    assert.equal(constantes.adresseDepenses(2025), "/finances?section=depenses&annee=2025");
  });

  test("/depenses redirige vers la section, sans chaîne, en 307 comme les autres ; /depenses/nouvelle n'est pas touchée", async () => {
    const config = (await import("../../../next.config")).default;
    const regles = await config.redirects!();
    const regle = regles.find((r) => r.source === "/depenses");
    assert.ok(regle);
    assert.equal(regle.destination, constantes.ADRESSE_DEPENSES);
    assert.equal(regle.permanent, false);
    assert.ok(!regles.some((r) => r.source === "/finances"), "la destination ne redirige pas");
    assert.ok(!regles.some((r) => r.source.startsWith("/depenses/") || r.source.startsWith("/depenses:")), "la saisie reste un écran");
  });

  test("l'écran /depenses est retiré, la saisie reste (raccourci de l'application), la navigation n'a plus d'onglet Dépenses", () => {
    assert.ok(!existsSync(path.join(RACINE, "src/app/(pilotage)/depenses/page.tsx")), "plus d'écran /depenses");
    assert.ok(existsSync(path.join(RACINE, "src/app/(pilotage)/depenses/nouvelle/page.tsx")), "la saisie reste");
    const manifeste = JSON.parse(lire("public/manifest-crm.webmanifest")) as { shortcuts: { url: string }[] };
    assert.ok(manifeste.shortcuts.some((raccourci) => raccourci.url === "/depenses/nouvelle"));
    const saisie = lire("src/app/(pilotage)/depenses/_components/SaisieDepense.tsx");
    assert.equal((saisie.match(/<Link href=\{ADRESSE_DEPENSES\}/g) ?? []).length, 2, "« Voir les dépenses » et « Dépenses » ramènent à la section");
    const navigation = lire("src/components/pilotage/Navigation.tsx");
    assert.doesNotMatch(navigation, /libelle: "Dépenses"/);
    assert.match(navigation, /href: "\/finances", libelle: "Finances", icone: Wallet, aussi: \["\/depenses\/nouvelle"\]/);
    const tableau = lire("src/app/(pilotage)/finances/_components/TableauFinances.tsx");
    assert.match(tableau, /<ListeDepenses initiale=\{depenses\.liste\} chantiers=\{depenses\.chantiers\} \/>/);
    assert.match(lire("src/app/(pilotage)/finances/_components/ListeDepenses.tsx"), /<section id=\{SECTION_DEPENSES\}/);
  });

  test("plus aucun lien vers l'écran retiré dans le code (la saisie et les routes /api/depenses restent)", () => {
    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = path.join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.(tsx?|js|webmanifest)$/.test(nom) && !nom.endsWith(".test.ts")) {
          readFileSync(chemin, "utf8")
            .split("\n")
            .forEach((ligne, i) => {
              if (/["'`]\/depenses(?![\w/-])/.test(ligne)) fautifs.push(`${path.relative(RACINE, chemin)}:${i + 1}`);
            });
        }
      }
    };
    parcourir(path.join(RACINE, "src"));
    parcourir(path.join(RACINE, "public"));
    assert.deepEqual(fautifs, []);
    assert.ok(statSync(path.join(RACINE, "src/app/api/depenses")).isDirectory());
  });
});
