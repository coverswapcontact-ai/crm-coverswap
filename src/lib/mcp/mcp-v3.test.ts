import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 11 : « libérer le MCP » — les outils qui manquaient, rejoués par un
 * VRAI client MCP (SDK) sur la route /api/mcp, sur une copie de base, sans
 * réseau. Le premier essai compare « tools/list » au catalogue : tout outil du
 * catalogue est exposé, rien d'autre.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";
process.env.ANTHROPIC_API_KEY = "cle-factice-qui-ne-doit-jamais-servir";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

type Client = import("@modelcontextprotocol/sdk/client/index.js").Client;
type Resultat = { content: { type: string; text?: string; data?: string; mimeType?: string }[] };
let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/mcp/route");
let NextRequest: typeof import("next/server").NextRequest;
let client: Client;
const appelsReseau: string[] = [];
const MCP = "http://localhost:3001/api/mcp";

const fetchLocal: typeof fetch = async (entree, init) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const requete = new NextRequest(new Request(url, init));
  if (requete.method === "POST") return route.POST(requete);
  if (requete.method === "DELETE") return route.DELETE(requete);
  return route.GET(requete);
};

const texte = (r: unknown) => ((r as Resultat).content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
const appelerBrut = (nom: string, args: Record<string, unknown>) => client.callTool({ name: nom, arguments: args }) as Promise<Resultat>;
const appeler = async (nom: string, args: Record<string, unknown>) => texte(await appelerBrut(nom, args));
const jetonDe = (t: string) => /Jeton de confirmation : ([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? null;
const donneesDe = <T,>(t: string): T => {
  const marque = "Données exactes (JSON) :\n";
  return JSON.parse(t.slice(t.indexOf(marque) + marque.length)) as T;
};
/** Un appel sensible : aperçu, puis le même appel avec le jeton. */
async function confirmer(nom: string, args: Record<string, unknown>): Promise<string> {
  const apercu = await appeler(nom, args);
  const jeton = jetonDe(apercu);
  assert.ok(jeton, `aperçu sans jeton pour ${nom} : ${apercu}`);
  return appeler(nom, { ...args, confirmation: jeton });
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

const ids: Record<string, string> = {};

before(async () => {
  const ancien = globalThis.fetch;
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return ancien(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  route = await import("@/app/api/mcp/route");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
  const liens = await import("@/lib/espace/liens");
  const { enregistrerPrestations } = await import("@/lib/prestations/dossier");
  const { avecActeur } = await import("@/lib/journal/contexte");
  const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

  // Fares : cliente avec espace, cuisine (façades, îlot), qui recevra deux devis.
  const fares = await prisma.lead.create({ data: { prenom: "Fawzia", nom: "Fares", telephone: "0600000041", email: "fares@exemple.fr", ville: "Lattes", codePostal: "34970", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
  const ouvert = await avecActeur(LUCAS, () => liens.ouvrirEspaceDuContact(fares.id));
  ids.dossierFares = ouvert.dossierId;
  ids.espaceFares = ouvert.espace.id;
  await avecActeur(LUCAS, () => enregistrerPrestations(ouvert.dossierId, { CUISINE: ["facades-hautes", "facades-basses", "ilot"] }, "LUCAS"));
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientAdresse: "3 rue des Essais", clientCp: "34970", clientVille: "Lattes", etape: "DEVIS_ENVOYE" } });

  // Une simulation faite sur le site, anonyme.
  ids.simulationSite = (await prisma.simulationSite.create({ data: { parcoursId: "parcours-essai", projet: "cuisine", references: JSON.stringify([{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "NE31", nom: "Statuary White" }]), page: "/simulateur", source: "meta", campagne: "Cuisine septembre" } })).id;

  // Parcours OAuth, puis client MCP.
  const oauth = await import("@/lib/oauth/serveur");
  const enregistrement = await oauth.enregistrerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  const verifier = randomBytes(32).toString("base64url");
  const demande = await oauth.demandeAutorisation({ client_id: enregistrement.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: MCP });
  const code = new URL(await oauth.accorder(demande, "lucas@exemple.fr")).searchParams.get("code")!;
  const jetons = await oauth.echangerJeton(new URLSearchParams({ grant_type: "authorization_code", client_id: enregistrement.client_id, code, code_verifier: verifier, resource: MCP }), new Headers());
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  client = new Client({ name: "Claude", version: "1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { fetch: fetchLocal, requestInit: { headers: { Authorization: `Bearer ${jetons.access_token}` } } }));
});

after(async () => {
  await client.close().catch(() => undefined);
  await prisma.$disconnect();
});

describe("Mission 11 : libérer le MCP", () => {
  test("« tools/list » expose exactement le catalogue (registre dérivé du code) ; « lister_outils » et /api/health portent la même empreinte", async () => {
    const { CATALOGUE } = await import("@/lib/assistant/catalogue");
    const { ecartAvecLeServeur, registreOutils } = await import("@/lib/assistant/couverture");
    const outils = await client.listTools();
    const ecart = ecartAvecLeServeur(outils.tools.map((t) => t.name));
    assert.deepEqual(ecart, { manquants: [], enTrop: [] }, `outils manquants ou en trop : ${JSON.stringify(ecart)}`);
    assert.equal(outils.tools.length, CATALOGUE.length);
    for (const nom of ["creer_contact", "deposer_document", "annuler_document", "presenter_devis", "retirer_accord", "simulations_site", "voir_parametres", "modifier_parametres", "voir_relances", "relancer", "annuler_relance", "changer_teinte", "voir_publicite", "lister_outils", "supprimer", "classer_mail", "rediger_mail"]) {
      assert.ok(outils.tools.some((t) => t.name === nom), `outil absent de tools/list : ${nom}`);
    }
    const registre = registreOutils();
    const liste = await appeler("lister_outils", {});
    assert.match(liste, new RegExp(`${registre.nombre} outil\\(s\\) exposés .* \\(empreinte ${registre.empreinte}\\)`));
    assert.match(liste, /reconnecter le connecteur/);
    const sante = await (await import("@/app/api/health/route")).GET(new NextRequest(new Request("http://localhost:3001/api/health")));
    const corps = (await sante.json()) as { outils: { nombre: number; empreinte: string } };
    assert.deepEqual(corps.outils, { nombre: registre.nombre, empreinte: registre.empreinte });
  });

  test("« creer_contact » refuse un doublon (même numéro, même nom + ville), crée sinon, et passe outre avec forcer", async () => {
    const premier = await appeler("creer_contact", { prenom: "Nadia", nom: "Essai", telephone: "06 11 22 33 44", ville: "Pérols", source: "REFERENCE", projet: "Cuisine, façades blanches" });
    assert.match(premier, /Contact créé : Nadia Essai \(Pérols\)/);
    const { leadId } = donneesDe<{ leadId: string }>(premier);
    ids.leadNadia = leadId;
    const memeNumero = await appeler("creer_contact", { prenom: "Nadia", nom: "Autre", telephone: "0611223344", ville: "Montpellier" });
    assert.match(memeNumero, /Rien n'a été créé/);
    assert.match(memeNumero, /même numéro/);
    const memeNom = await appeler("creer_contact", { prenom: "Nadia", nom: "Essai", ville: "Perols" });
    assert.match(memeNom, /Rien n'a été créé/);
    assert.match(memeNom, /même nom, même ville/);
    assert.equal(await prisma.lead.count({ where: { prenom: "Nadia", nom: "Essai" } }), 1, "aucune fiche créée sur un doublon");
    const force = await appeler("creer_contact", { prenom: "Nadia", nom: "Essai", ville: "Pérols", forcer: true, ouvrir_dossier: true });
    assert.match(force, /Contact créé : Nadia Essai \(Pérols\).*dossier ouvert.*malgré 1 doublon/);
    ids.leadNadiaBis = donneesDe<{ leadId: string }>(force).leadId;
  });

  test("« generer_document » : deux devis à libellés qui s'ajoutent (sans mail), une remise en ligne négative ; « annuler_document » annule l'un ; l'autre reste proposé", async () => {
    const lignes = [{ designation: "Revêtement adhésif — façades", quantite: 11.5, unite: "ml", prix_unitaire: 150 }];
    const a = await confirmer("generer_document", { dossierId: ids.dossierFares, type: "DEVIS", objet: "Cuisine", lignes, libelle_variante: "façades seules", notifier: false });
    assert.match(a, /« façades seules » émis .* proposé dans son espace, sans mail/);
    ids.devisA = donneesDe<{ documentId: string }>(a).documentId;
    const apercuB = await appeler("generer_document", { dossierId: ids.dossierFares, type: "DEVIS", objet: "Cuisine", lignes: [...lignes, { designation: "Plan de travail", quantite: 4.6, unite: "ml", prix_unitaire: 150 }], libelle_variante: "façades + plan de travail", remise: 100, notifier: false });
    assert.match(apercuB, /Il s'ajoute au devis \d{4}-\d{3} déjà proposé : le client en choisira un/);
    assert.match(apercuB, /Remise commerciale 1 forfait × -100 €/);
    assert.match(apercuB, /aucun mail ne partira/);
    const b = await appeler("generer_document", { dossierId: ids.dossierFares, type: "DEVIS", objet: "Cuisine", lignes: [...lignes, { designation: "Plan de travail", quantite: 4.6, unite: "ml", prix_unitaire: 150 }], libelle_variante: "façades + plan de travail", remise: 100, notifier: false, confirmation: jetonDe(apercuB) });
    ids.devisB = donneesDe<{ documentId: string }>(b).documentId;
    assert.equal(await prisma.envoiMail.count({ where: { cle: { startsWith: "notif:DEVIS_DISPONIBLE:" } } }), 0, "notifier: false : aucun mail programmé");
    const service = await import("@/lib/espace/service");
    let etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: ids.espaceFares } }));
    assert.deepEqual(etat.devisProposes.map((d) => d.libelle), ["façades seules", "façades + plan de travail"]);
    assert.equal(etat.devisProposes[1].total, Math.round(((11.5 + 4.6) * 150 - 100) * 100) / 100);
    const fiche = await appeler("lire_fiche", { dossierId: ids.dossierFares });
    assert.match(fiche, /Devis \(2\) : /);
    assert.match(fiche, /\d{4}-\d{3} « façades seules » 1.725 € \(généré\)/);
    assert.match(fiche, /\d{4}-\d{3} « façades \+ plan de travail » 2.315 € \(généré\)/);
    // Un prix négatif ailleurs que sur une remise est refusé avant tout aperçu.
    await assert.rejects(appelerBrut("generer_document", { dossierId: ids.dossierFares, type: "DEVIS", objet: "Cuisine", lignes: [{ designation: "Façades", quantite: 1, unite: "ml", prix_unitaire: -5 }] }).then((r) => { if (texte(r).includes("Remise")) throw new Error(texte(r)); }), /Remise/);

    const annule = await confirmer("annuler_document", { dossierId: ids.dossierFares, documentId: ids.devisA, motif: "le client préfère la formule complète" });
    assert.match(annule, /annulé : gardé en historique, plus proposé/);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: ids.devisA } })).statut, "ANNULEE");
    etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: ids.espaceFares } }));
    assert.deepEqual(etat.devisProposes.map((d) => d.id), [ids.devisB]);
  });

  test("« deposer_document » : un BAT fournisseur en base64 conservé et servi par /api/fichiers ; un devis PDF proposé au client", async () => {
    const bat = await confirmer("deposer_document", { dossierId: ids.dossierFares, type: "AUTRE", libelle: "BAT fournisseur", source: { contenu_base64: PDF.toString("base64"), nom: "bat-cover-styl.pdf" } });
    assert.match(bat, /Document « BAT fournisseur » déposé/);
    const { fichierId } = donneesDe<{ fichierId: string }>(bat);
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: ids.dossierFares, type: "DOCUMENT_DEPOSE" } });
    assert.match(evenement?.contenu ?? "", /BAT fournisseur \(bat-cover-styl.pdf\)/);
    const reponse = await (await import("@/app/api/fichiers/[id]/route")).GET(new NextRequest(new Request(`http://localhost:3001/api/fichiers/${fichierId}`)), { params: Promise.resolve({ id: fichierId }) });
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await reponse.arrayBuffer()).toString(), PDF.toString());

    const devis = await confirmer("deposer_document", { dossierId: ids.dossierFares, type: "DEVIS", numero: "2026-990", libelle: "devis papier", montant: 1980, date_emission: "2026-09-20", inscrire_au_registre: true, source: { contenu_base64: PDF.toString("base64"), nom: "devis-990.pdf" } });
    assert.match(devis, /Devis 2026-990 rattaché .* Proposé dans son espace/);
    const service = await import("@/lib/espace/service");
    const etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: ids.espaceFares } }));
    assert.deepEqual(etat.devisProposes.map((d) => [d.libelle, d.repris ?? false]), [["façades + plan de travail", false], ["devis papier", true]]);
  });

  test("« presenter_devis » : libellé et visibilité d'un devis émis ; « retirer_accord » refuse sans accord", async () => {
    const service = await import("@/lib/espace/service");
    const masque = await appeler("presenter_devis", { dossierId: ids.dossierFares, documentId: ids.devisB, visible_espace: false, libelle_variante: "façades + plan (masqué)" });
    assert.match(masque, /Devis \d{4}-\d{3} : libellé « façades \+ plan \(masqué\) », masqué dans l'espace client/);
    let etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: ids.espaceFares } }));
    assert.ok(!etat.devisProposes.some((d) => d.id === ids.devisB), "masqué : le client ne le voit plus");
    await appeler("presenter_devis", { dossierId: ids.dossierFares, documentId: ids.devisB, visible_espace: true, libelle_variante: "façades + plan de travail" });
    etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: ids.espaceFares } }));
    assert.ok(etat.devisProposes.some((d) => d.id === ids.devisB && d.libelle === "façades + plan de travail"));
    const refus = await appeler("retirer_accord", { dossierId: ids.dossierFares });
    assert.match(refus, /Aucun bon pour accord en vigueur/);
  });

  test("« changer_teinte » : une teinte par meuble, plusieurs teintes par projet, candidats en cas de doute", async () => {
    const ilot = await appeler("changer_teinte", { dossierId: ids.dossierFares, meuble: "îlot", teinte: "chêne clair", commande: "Mets l'îlot en chêne clair" });
    assert.match(ilot, /Îlot .*→ chêne clair/);
    const hauts = await appeler("changer_teinte", { dossierId: ids.dossierFares, meuble: "façades hautes", teinte: "blanc mat", commande: "Les façades hautes en blanc mat" });
    assert.match(hauts, /Teintes du projet : .*CUISINE\.ilot : chêne clair.*CUISINE\.facades-hautes : blanc mat/);
    const { lireTeintes } = await import("@/lib/prestations/prestations");
    assert.deepEqual(lireTeintes((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierFares } })).teintes), { "CUISINE.ilot": "chêne clair", "CUISINE.facades-hautes": "blanc mat" });
    const doute = await appeler("changer_teinte", { dossierId: ids.dossierFares, meuble: "façades", teinte: "noir" });
    assert.match(doute, /Plusieurs meubles peuvent être « façades »|Aucun meuble/);
    assert.deepEqual(lireTeintes((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierFares } })).teintes), { "CUISINE.ilot": "chêne clair", "CUISINE.facades-hautes": "blanc mat" }, "rien n'est choisi à la place de Lucas");
  });

  test("« simulations_site » liste les simulations du site (anonymes ou rattachées) ; « voir_publicite » dit honnêtement l'état de la réception", async () => {
    const site = await appeler("simulations_site", { jours: 30 });
    assert.match(site, /1 simulation\(s\) sur le site sur 30 jour\(s\) : 1 anonyme\(s\)/);
    assert.match(site, /cuisine — Meubles hauts : Statuary White \(NE31\) — anonyme .* page \/simulateur — source meta — campagne Cuisine septembre/);
    const pub = await appeler("voir_publicite", {});
    assert.match(pub, /Réception des leads Meta — NE REÇOIT PAS : Il manque : META_APP_SECRET absente, META_VERIFY_TOKEN absente/);
    assert.match(pub, /Campagne : commencée le 22\/09\/2026, jour \d+ sur 21, budget 378 €/);
    assert.equal(appelsReseau.length, 0, "aucun appel réseau");
  });

  test("« voir_parametres » / « modifier_parametres » : capacité, campagne, interrupteur d'un automatisme (sous confirmation), jamais de secret", async () => {
    const avant = await appeler("voir_parametres", {});
    // Mission 12 : la migration « valeurs-lucas-26-09 » pose 3 000 € et 15 chantiers ; l'outil les rend avec leur source.
    assert.match(avant, /Pilotage de l'activité :\n- TRESORERIE_RESERVE — Réserve de trésorerie à garder : 3.000(,00)? € \(depuis le 01\/09\/2026, source : Lucas, mission du 26\/09\/2026/);
    assert.match(avant, /- CAPACITE_CHANTIERS_MOIS — Capacité : chantiers par mois : 15 \(depuis le 01\/09\/2026/);
    assert.match(avant, /Numérotation \(Paramètres → Numérotation des documents\) : Devis 2026 : prochain 2026-\d{3}/);
    assert.match(avant, /NOTIF_DEVIS_DISPONIBLE — Mail au client : .* : ACTIF/);
    assert.match(avant, /Aucun secret n'est lu ni rendu/);
    assert.doesNotMatch(avant, /secret-de-session|cle-factice/);
    const reserve = await confirmer("modifier_parametres", { cle: "TRESORERIE_RESERVE", valeur: 3000, source: "dit par Lucas" });
    assert.match(reserve, /Réserve de trésorerie à garder : 3.000(,00)? € à partir du/);
    const capacite = await confirmer("modifier_parametres", { cle: "capacite_chantiers_mois", valeur: "15" });
    assert.match(capacite, /Capacité : chantiers par mois : 15/);
    const apercu = await appeler("modifier_parametres", { automatisme: "NOTIF_DEVIS_DISPONIBLE", actif: false });
    assert.match(apercu, /Je vais désactiver « Mail au client : .* » \(NOTIF_DEVIS_DISPONIBLE\) : actif → inactif/);
    await appeler("modifier_parametres", { automatisme: "NOTIF_DEVIS_DISPONIBLE", actif: false, confirmation: jetonDe(apercu) });
    const { listerAutomatismes } = await import("@/lib/automatismes/interrupteurs");
    assert.equal((await listerAutomatismes()).find((a) => a.code === "NOTIF_DEVIS_DISPONIBLE")?.actif, false);
    const { lireParametre } = await import("@/lib/parametres/service");
    assert.deepEqual([await lireParametre("TRESORERIE_RESERVE"), await lireParametre("CAPACITE_CHANTIERS_MOIS")], [3000, "15"]);
    await assert.rejects(appelerBrut("modifier_parametres", { cle: "TRESORERIE_RESERVE" }).then((r) => { if (/Donne soit cle/.test(texte(r))) throw new Error(texte(r)); }), /Donne soit cle/);
  });

  test("« voir_relances » / « relancer » / « annuler_relance » : l'état des relances, une relance envoyée sous confirmation, une proposée annulée", async () => {
    const vue = await appeler("voir_relances", {});
    assert.match(vue, /1 devis en attente de réponse \(délai de relance non renseigné/);
    assert.match(vue, /Fawzia Fares : devis \d{4}-\d{3} de .* 0 relance\(s\) faite\(s\) — relance proposable/);
    const apercu = await appeler("relancer", { dossierId: ids.dossierFares });
    assert.match(apercu, /Je vais envoyer à fares@exemple.fr la relance n° 1 du devis \d{4}-\d{3} de Fawzia Fares :\nObjet : Votre devis n° \d{4}-\d{3} — CoverSwap/);
    assert.equal(await prisma.proposition.count({ where: { type: "ENVOI_MAIL", contenu: { contains: "RELANCE_DEVIS" } } }), 0, "l'aperçu ne crée rien");
    const envoyee = await appeler("relancer", { dossierId: ids.dossierFares, confirmation: jetonDe(apercu) });
    assert.match(envoyee, /Relance n° 1 du devis .* envoyée à fares@exemple.fr/);
    const proposition = await prisma.proposition.findFirstOrThrow({ where: { type: "ENVOI_MAIL", contenu: { contains: "RELANCE_DEVIS" } } });
    assert.ok(["VALIDEE", "EXECUTEE"].includes(proposition.statut), proposition.statut);
    // L'exécution d'une proposition validée passe par la file des tâches (coupée ici) : le mail est programmé, ou son exécution attend en file.
    const programme = await prisma.envoiMail.count({ where: { a: "fares@exemple.fr" } });
    const enFile = await prisma.tache.count({ where: { type: "EXECUTION_PROPOSITION", statut: { in: ["EN_ATTENTE", "EN_COURS"] } } });
    assert.ok(programme === 1 || enFile >= 1, `le mail de relance est programmé (${programme}) ou son exécution est en file (${enFile})`);

    // Une relance proposée par le CRM, puis annulée depuis l'assistant.
    const { relancerDevis } = await import("@/lib/relances/service");
    await prisma.dossierEvenement.create({ data: { dossierId: ids.dossierFares, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Relance n° 1 envoyée", metadata: JSON.stringify({ motif: "RELANCE_DEVIS", documentIds: [ids.devisB] }) } });
    const proposee = await relancerDevis(ids.dossierFares, { forcer: true, documentId: ids.devisB });
    assert.equal(proposee.rang, 2);
    const vue2 = await appeler("voir_relances", {});
    assert.match(vue2, /relance n° 2 PROPOSÉE, à valider \[proposition:/);
    const annulee = await appeler("annuler_relance", { propositionId: proposee.propositionId, motif: "il a appelé, il réfléchit" });
    assert.match(annulee, /Relance annulée : « Relancer Fawzia Fares/);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: proposee.propositionId } })).statut, "ANNULEE");
  });

  test("« supprimer » : corbeille 30 jours, « restaurer » remet ; definitif efface (anonymise) sous confirmation ; la purge quotidienne efface ce qui a plus de 30 jours", async () => {
    const corbeille = await appeler("supprimer", { leads: [ids.leadNadiaBis], motif: "doublon créé par erreur" });
    assert.match(corbeille, /1 lead\(s\) à la corbeille \(motif : doublon créé par erreur\) : effacement le/);
    let lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadNadiaBis } });
    assert.ok(lead.archiveLe && lead.archiveMotif?.startsWith("Corbeille (effacement le"), lead.archiveMotif ?? "");
    await appeler("restaurer", { leads: [ids.leadNadiaBis] });
    lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadNadiaBis } });
    assert.equal(lead.archiveLe, null);

    const apercu = await appeler("supprimer", { leads: [ids.leadNadiaBis], motif: "doublon", definitif: true });
    assert.match(apercu, /Je vais EFFACER définitivement 1 lead\(s\) : Nadia Essai \(Pérols\)[\s\S]*Anonymisation irréversible/);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadNadiaBis } })).prenom, "Nadia", "l'aperçu ne fait rien");
    const efface = await appeler("supprimer", { leads: [ids.leadNadiaBis], motif: "doublon", definitif: true, confirmation: jetonDe(apercu) });
    assert.match(efface, /1 élément\(s\) effacé\(s\) \(anonymisés, irréversible\)/);
    lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadNadiaBis } });
    assert.notEqual(lead.prenom, "Nadia");
    assert.equal(lead.telephone, "");
    assert.ok(await prisma.lead.findUnique({ where: { id: ids.leadNadiaBis } }), "jamais un DELETE : la ligne reste");
    assert.match(lead.archiveMotif ?? "", /Corbeille — effacé le .* \(anonymisé, réf\./);

    // La purge : un lead à la corbeille depuis 31 jours est effacé, un de 2 jours reste.
    const { purgerCorbeille, motifCorbeille } = await import("@/lib/prospects/corbeille");
    const vieux = await prisma.lead.create({ data: { prenom: "Vieux", nom: "Corbeille", telephone: "0600000099", ville: "Lattes", source: "AUTRE", archiveLe: new Date(Date.now() - 31 * 24 * 3_600_000), archiveMotif: motifCorbeille("test", new Date(Date.now() - 31 * 24 * 3_600_000)) } });
    const recent = await prisma.lead.create({ data: { prenom: "Récent", nom: "Corbeille", telephone: "0600000098", ville: "Lattes", source: "AUTRE", archiveLe: new Date(Date.now() - 2 * 24 * 3_600_000), archiveMotif: motifCorbeille("test", new Date(Date.now() - 2 * 24 * 3_600_000)) } });
    const bilan = await purgerCorbeille();
    assert.match(bilan.resume, /1 élément\(s\) effacé\(s\)/);
    assert.notEqual((await prisma.lead.findUniqueOrThrow({ where: { id: vieux.id } })).prenom, "Vieux");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: recent.id } })).prenom, "Récent");
  });

  test("le journal porte chaque action de l'assistant, et rien n'est parti sur le réseau", async () => {
    const appels = await prisma.appelOutil.findMany({ where: { outil: { in: ["creer_contact", "annuler_document", "deposer_document", "changer_teinte", "modifier_parametres", "relancer", "supprimer"] } }, select: { outil: true, statut: true } });
    for (const outil of ["creer_contact", "annuler_document", "deposer_document", "changer_teinte", "modifier_parametres", "relancer", "supprimer"]) assert.ok(appels.some((a) => a.outil === outil && a.statut === "FAIT"), `appel journalisé manquant : ${outil}`);
    assert.deepEqual(appelsReseau, []);
  });
});
