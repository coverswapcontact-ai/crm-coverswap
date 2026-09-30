import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mesure-"));

/**
 * Mission 17 (partie B) — la mesure du site sans cookie, côté CRM : empreinte du visiteur du jour (même IP et même
 * navigateur le même jour = même visiteur ; le lendemain, un autre), IP et navigateur jamais stockés, robots écartés,
 * pays déduit du fuseau, famille calculée à la réception, anciens envois acceptés ; visites (pause de 30 minutes) et
 * page d'entrée ; purge à 25 mois, seule suppression permise (couche et base). `fetch` est remplacé : aucune requête.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/site/evenements/route");
let mesure: typeof import("./mesure");
let visites: typeof import("./visites");
let NextRequest: typeof import("next/server").NextRequest;

const fetchOrigine = globalThis.fetch;
const requetesReseau: string[] = [];
const IP = "203.0.113.57";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
let rang = 0;
const parcours = () => `eeeeeeee-1702-4000-8000-${String(++rang).padStart(12, "0")}`;

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  route = await import("@/app/api/site/evenements/route");
  mesure = await import("./mesure");
  visites = await import("./visites");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

async function envoyer(corps: Record<string, unknown>, entetes: { ip?: string; ua?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "text/plain", origin: "https://coverswap.fr", "x-forwarded-for": `${entetes.ip ?? IP}, 10.0.0.1` };
  if (entetes.ua !== null) headers["user-agent"] = entetes.ua ?? IPHONE;
  const reponse = await route.POST(new NextRequest("http://localhost/api/site/evenements", { method: "POST", body: JSON.stringify(corps), headers }));
  return { statut: reponse.status, corps: await reponse.json() };
}

describe("réception : visiteur du jour, appareil, pays, famille", () => {
  test("même IP et même navigateur le même jour = même visiteur ; autre navigateur = autre visiteur ; l'IP et le navigateur ne sont jamais stockés", async () => {
    const p = parcours();
    assert.deepEqual(await envoyer({ parcoursId: p, type: "PAGE_VUE", page: "/", referent: "chatgpt.com", fuseau: "Europe/Paris" }), { statut: 200, corps: { ok: true } });
    // Même réseau /24 (le dernier octet change) et même navigateur : même visiteur.
    await envoyer({ parcoursId: p, type: "PIECE_CHOISIE", page: "/simulateur" }, { ip: "203.0.113.99" });
    await envoyer({ parcoursId: parcours(), type: "PAGE_VUE", page: "/" }, { ua: WINDOWS });
    const lignes = await prisma.evenementSite.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: "asc" } });
    assert.equal(lignes.length, 3);
    const [a, b, c] = lignes;
    assert.match(a.visiteur ?? "", /^[0-9a-f]{16}$/);
    assert.equal(a.visiteur, b.visiteur, "même visiteur du jour");
    assert.notEqual(a.visiteur, c.visiteur, "autre navigateur, autre visiteur");
    assert.deepEqual([a.appareil, c.appareil], ["TELEPHONE", "ORDINATEUR"]);
    assert.deepEqual([a.pays, a.referent, a.famille], ["FR", "chatgpt.com", "ia"]);
    // Ni l'IP (même tronquée) ni le navigateur n'apparaissent nulle part dans la ligne.
    for (const ligne of lignes) {
      const texte = JSON.stringify(ligne);
      for (const interdit of ["203.0.113", "iPhone", "Mozilla", "Windows"]) assert.ok(!texte.includes(interdit), `« ${interdit} » stocké : ${texte}`);
    }
  });

  test("le lendemain (heure de Paris), le même visiteur a une autre empreinte ; un seul sel en base, hors journal", async () => {
    const mercredi = new Date("2026-09-30T20:00:00.000Z"); // 22 h à Paris
    const jeudi = new Date("2026-09-30T22:30:00.000Z"); // 0 h 30 à Paris, le 1er octobre
    const m1 = await mesure.mesurerRequete({ ip: IP, userAgent: IPHONE, maintenant: mercredi });
    const m2 = await mesure.mesurerRequete({ ip: IP, userAgent: IPHONE, maintenant: mercredi });
    const m3 = await mesure.mesurerRequete({ ip: IP, userAgent: IPHONE, maintenant: jeudi });
    assert.ok(!m1.robot && !m2.robot && !m3.robot);
    assert.equal(m1.visiteur, m2.visiteur);
    assert.notEqual(m1.visiteur, m3.visiteur, "jour suivant : autre visiteur");
    const sels = await prisma.cleInterne.findMany({ where: { nom: { contains: "sel" } } });
    assert.equal(sels.length, 1, "une seule clé, remplacée chaque jour");
    assert.equal(JSON.parse(sels[0].valeur).jour, "2026-10-01");
    // Relu en base (mémoire oubliée) : le même sel, donc la même empreinte.
    mesure.oublierSelEnMemoire();
    const m4 = await mesure.mesurerRequete({ ip: IP, userAgent: IPHONE, maintenant: jeudi });
    assert.ok(!m4.robot && m4.visiteur === m3.visiteur);
    assert.equal(await prisma.journalModification.count({ where: { modele: "CleInterne" } }), 0, "aucune copie du sel dans le journal");
  });

  test("robots écartés : rien n'est enregistré, la réponse reste { ok: true }", async () => {
    const avant = await prisma.evenementSite.count();
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36", "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 Chrome-Lighthouse", "facebookexternalhit/1.1", "curl/8.4.0", null]) {
      assert.deepEqual(await envoyer({ parcoursId: parcours(), type: "PAGE_VUE", page: "/" }, { ua }), { statut: 200, corps: { ok: true } }, String(ua));
    }
    assert.equal(await prisma.evenementSite.count(), avant);
  });

  test("anciens envois acceptés ; nouveaux champs (utm, gclid) ; sans parcours : l'empreinte en tient lieu ; parcours mal formé refusé", async () => {
    const ancien = parcours();
    assert.equal((await envoyer({ parcoursId: ancien, type: "PAGE_VUE", page: "/", source: "meta/paid", campagne: "cuisine" }, { ua: WINDOWS })).statut, 200);
    const l1 = await prisma.evenementSite.findFirstOrThrow({ where: { parcoursId: ancien } });
    assert.deepEqual([l1.source, l1.campagne, l1.famille, l1.pays, l1.referent], ["meta/paid", "cuisine", "meta", null, null]);

    const pub = parcours();
    await envoyer({ parcoursId: pub, type: "PAGE_VUE", page: "/prestations/cuisine", utmSource: "google", utmMedium: "cpc", utmCampagne: "marque", utmContenu: "annonce-1", gclid: "Cj0KCQjw-abcdef", fuseau: "Europe/Brussels", referent: "https://www.google.com/" });
    const l2 = await prisma.evenementSite.findFirstOrThrow({ where: { parcoursId: pub } });
    assert.deepEqual([l2.source, l2.campagne, l2.famille, l2.pays, l2.referent], ["google/cpc", "marque", "google-ads", "BE", "google.com"]);
    assert.deepEqual(JSON.parse(l2.meta ?? "{}"), { utm_content: "annonce-1", gclid: true }, "la valeur du gclid n'est pas gardée");

    await envoyer({ type: "PAGE_VUE", page: "/sans-parcours", fuseau: "Mars/Olympus" });
    const l3 = await prisma.evenementSite.findFirstOrThrow({ where: { page: "/sans-parcours" } });
    assert.equal(l3.parcoursId, `v-${l3.visiteur}`);
    assert.equal(l3.pays, null, "fuseau inconnu : pas de pays");
    assert.equal(l3.famille, "direct");

    assert.equal((await envoyer({ parcoursId: "pas-un-uuid", type: "PAGE_VUE" })).statut, 400);
    assert.equal((await envoyer({ parcoursId: parcours(), type: "INCONNU" })).statut, 400);
  });

  test("classes d'appareil, IP tronquée, pays du fuseau (pur)", () => {
    assert.equal(mesure.classeAppareil("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), "TABLETTE");
    assert.equal(mesure.classeAppareil("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/129 Safari/537.36"), "TABLETTE");
    assert.equal(mesure.classeAppareil("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36"), "TELEPHONE");
    assert.equal(mesure.classeAppareil(WINDOWS), "ORDINATEUR");
    assert.equal(mesure.ipTronquee("203.0.113.57"), "203.0.113.0");
    assert.equal(mesure.ipTronquee("::ffff:203.0.113.57"), "203.0.113.0");
    assert.equal(mesure.ipTronquee("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd::");
    assert.equal(mesure.ipTronquee("2001:db8::1"), "2001:db8:0::");
    assert.equal(mesure.ipTronquee("n'importe quoi"), "inconnue");
    assert.equal(mesure.paysDuFuseau("Europe/Paris"), "FR");
    assert.equal(mesure.paysDuFuseau("Indian/Reunion"), "RE");
    assert.equal(mesure.paysDuFuseau("Asia/Nulle_Part"), null);
    assert.equal(mesure.paysDuFuseau(null), null);
  });
});

describe("visites : même visiteur du jour, pause de 30 minutes, page d'entrée", () => {
  test("visites, entrées, familles, appareils, pays et entonnoir sur une période", async () => {
    const jour = "2026-06-10";
    const a = (h: number, m: number) => new Date(`${jour}T${String(h - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`); // heure de Paris (été)
    const ecrire = (d: Record<string, unknown>) => prisma.evenementSite.create({ data: { parcoursId: "ffffffff-0000-4000-8000-000000000001", type: "PAGE_VUE", ...d } as Parameters<typeof prisma.evenementSite.create>[0]["data"] });
    // Visiteur 1 : arrivé par ChatGPT à 10 h, deux pages ; revenu à 10 h 50 (pause de 40 min) sur le simulateur : une deuxième visite, qui simule.
    await ecrire({ createdAt: a(10, 0), visiteur: "aaaaaaaaaaaaaaaa", page: "/", referent: "chatgpt.com", famille: "ia", appareil: "TELEPHONE", pays: "FR" });
    await ecrire({ createdAt: a(10, 10), visiteur: "aaaaaaaaaaaaaaaa", page: "/prestations/cuisine", famille: "ia", appareil: "TELEPHONE", pays: "FR" });
    await ecrire({ createdAt: a(10, 39), visiteur: "aaaaaaaaaaaaaaaa", page: "/realisations", famille: "direct", appareil: "TELEPHONE", pays: "FR" });
    await ecrire({ createdAt: a(11, 9), visiteur: "aaaaaaaaaaaaaaaa", page: "/simulateur", famille: "direct", appareil: "TELEPHONE", pays: "FR" });
    await ecrire({ createdAt: a(11, 12), visiteur: "aaaaaaaaaaaaaaaa", type: "GENERATION_LANCEE", page: "/simulateur", appareil: "TELEPHONE", pays: "FR" });
    await ecrire({ createdAt: a(11, 14), visiteur: "aaaaaaaaaaaaaaaa", type: "RESULTAT_VU", page: "/simulateur", appareil: "TELEPHONE", pays: "FR" });
    // Visiteur 2 : une publicité Meta, sur ordinateur en Belgique, jusqu'à la demande.
    await ecrire({ createdAt: a(15, 0), visiteur: "bbbbbbbbbbbbbbbb", page: "/prestations/cuisine", source: "meta/paid", famille: "meta", appareil: "ORDINATEUR", pays: "BE" });
    await ecrire({ createdAt: a(15, 5), visiteur: "bbbbbbbbbbbbbbbb", type: "DEVIS_DEMANDE", page: "/devis", appareil: "ORDINATEUR", pays: "BE" });
    // Un événement d'avant la mesure (sans empreinte) : regroupé par parcours ; et un jour hors période.
    await ecrire({ createdAt: a(9, 0), parcoursId: "ffffffff-0000-4000-8000-00000000abcd", page: "/", source: "google.com" });
    await ecrire({ createdAt: new Date("2026-06-11T10:00:00.000Z"), visiteur: "cccccccccccccccc", page: "/" });

    const v = await visites.visitesSurPeriode(jour, jour);
    assert.equal(v.visites, 4);
    assert.equal(v.visiteurs, 2);
    assert.equal(v.sansEmpreinte, 1);
    assert.equal(v.pagesVues, 6);
    assert.deepEqual(v.parJour, [{ jour, visites: 4, pagesVues: 6, parFamille: { ia: 1, direct: 1, meta: 1, seo: 1 } }]);
    assert.deepEqual(
      v.pagesEntree.map((e) => [e.page, e.visites, e.simulations, e.leads]),
      [["/", 2, 0, 0], ["/prestations/cuisine", 1, 0, 1], ["/simulateur", 1, 1, 0]]
    );
    assert.deepEqual(v.familles.map((f) => [f.famille, f.visites]), [["meta", 1], ["seo", 1], ["ia", 1], ["direct", 1]]);
    assert.deepEqual(v.sources.find((s) => s.famille === "ia"), { famille: "ia", nom: "chatgpt.com", visites: 1, simulations: 0, terminees: 0, leads: 0 });
    assert.deepEqual(Object.fromEntries(v.appareils.map((x) => [x.appareil, x.visites])), { TELEPHONE: 2, ORDINATEUR: 1, INCONNU: 1 });
    assert.deepEqual(Object.fromEntries(v.pays.map((x) => [x.pays, x.visites])), { FR: 2, BE: 1, "??": 1 });
    assert.deepEqual(v.entonnoir, { visites: 4, simulations: 1, terminees: 1, leads: 1 });
    assert.deepEqual(v.pages.slice(0, 2), [{ page: "/", vues: 2 }, { page: "/prestations/cuisine", vues: 2 }]);

    // Une seule famille.
    const ia = await visites.visitesSurPeriode(jour, jour, { famille: "ia" });
    assert.deepEqual([ia.visites, ia.pagesVues, ia.pagesEntree.map((e) => e.page)], [1, 3, ["/"]]);
  });
});

describe("conservation : 25 mois, seule suppression permise", () => {
  test("purge des événements de plus de 25 mois ; rien de récent ne peut partir, ni par la couche ni en SQL", async () => {
    const maintenant = new Date();
    const vieux = new Date(maintenant);
    vieux.setUTCMonth(vieux.getUTCMonth() - 26);
    const presque = new Date(maintenant);
    presque.setUTCMonth(presque.getUTCMonth() - 24);
    const v = await prisma.evenementSite.create({ data: { parcoursId: "99999999-0000-4000-8000-000000000001", type: "PAGE_VUE", page: "/vieux", createdAt: vieux } });
    const p = await prisma.evenementSite.create({ data: { parcoursId: "99999999-0000-4000-8000-000000000002", type: "PAGE_VUE", page: "/presque", createdAt: presque } });
    const bilan = await mesure.purgerMesureSite(maintenant);
    assert.equal(bilan.supprimes, 1);
    assert.equal(await prisma.evenementSite.findUnique({ where: { id: v.id } }), null);
    assert.ok(await prisma.evenementSite.findUnique({ where: { id: p.id } }), "24 mois : gardé");

    // Une purge mal écrite ne passe pas la base : une mesure récente reste.
    await assert.rejects(() => prisma.evenementSite.deleteMany({ where: { id: p.id } }), /Suppression interdite|EvenementSite/);
    assert.ok(await prisma.evenementSite.findUnique({ where: { id: p.id } }));
    await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM "EvenementSite" WHERE "id" = ?`, p.id), /Suppression interdite/);
    // `delete` reste refusé par la couche, et les autres modèles gardent le refus de deleteMany.
    await assert.rejects(() => prisma.evenementSite.delete({ where: { id: p.id } }), (e: unknown) => e instanceof Error && e.name === "SuppressionInterdite");
    await assert.rejects(() => prisma.lead.deleteMany({}), (e: unknown) => e instanceof Error && e.name === "SuppressionInterdite");
    // Hors journal : aucune copie d'une mesure ne survit à la purge dans le journal immuable.
    assert.equal(await prisma.journalModification.count({ where: { modele: "EvenementSite" } }), 0);
    assert.equal(requetesReseau.length, 0, "aucune requête réseau");
  });
});
