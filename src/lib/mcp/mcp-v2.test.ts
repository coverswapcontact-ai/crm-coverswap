import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 10 : les actions qui manquaient à l'assistant, rejouées par un VRAI
 * client MCP (SDK) sur la route /api/mcp, sur une copie de base. Aucun appel
 * réseau ne sort (fetch surveillé : Anthropic interdit, le reste coupé) ; le
 * journal, la trace et l'état de la base sont contrôlés après chaque phrase.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY"]) process.env[cle] = "";
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
let compte: typeof import("@/lib/espace/compte");
let sharp: typeof import("sharp");
let client: Client;
const appelsAnthropic: string[] = [];
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
const images = (r: unknown) => ((r as Resultat).content ?? []).filter((c) => c.type === "image");
const appelerBrut = (nom: string, args: Record<string, unknown>) => client.callTool({ name: nom, arguments: args }) as Promise<Resultat>;
const appeler = async (nom: string, args: Record<string, unknown>) => texte(await appelerBrut(nom, args));
const jetonDe = (t: string) => /Jeton de confirmation : ([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? null;
const donneesDe = <T,>(t: string): T => {
  const marque = "Données exactes (JSON) :\n";
  return JSON.parse(t.slice(t.indexOf(marque) + marque.length)) as T;
};
async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<File> {
  const octets = await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg().toBuffer();
  return new File([new Uint8Array(octets)], "photo.jpg", { type: "image/jpeg" });
}

const REFERENCES = [
  { id: "AA01", nom: "Beige Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/aa01.jpg", tags: ["chêne", "beige"] },
  { id: "AB02", nom: "Cafe Latte", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ab02.jpg", tags: ["couleur", "beige"] },
  { id: "J3", nom: "Ultra White", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/j3.jpg", tags: ["couleur"] },
  { id: "NE31", nom: "Statuary White", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ne31.jpg", tags: ["pierre", "marbre"] },
];

const ids: Record<string, string> = {};
let permanentThimalu: import("@prisma/client").EspacePermanent;
let projetThimalu: import("@prisma/client").EspaceClient;

before(async () => {
  const ancien = globalThis.fetch;
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (url.includes("anthropic.com")) {
      appelsAnthropic.push(url);
      throw new Error("appel interdit vers Anthropic");
    }
    // Un module chargé en mémoire (data:) n'est pas du réseau.
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return ancien(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  route = await import("@/app/api/mcp/route");
  NextRequest = (await import("next/server")).NextRequest;
  compte = await import("@/lib/espace/compte");
  sharp = (await import("sharp")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES);
  const liens = await import("@/lib/espace/liens");
  const { enregistrerPrestations } = await import("@/lib/prestations/dossier");
  const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
  const { deposerSimulationDossier } = await import("@/lib/simulations/dossier");
  const { avecActeur } = await import("@/lib/journal/contexte");
  const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

  // Thimalu : cliente avec espace, cuisine (façades hautes, basses, îlot), deux photos, une simulation, un devis émis.
  const thimalu = await prisma.lead.create({ data: { prenom: "Anaïs", nom: "Thimalu", telephone: "0600000031", email: "thimalu@exemple.fr", ville: "Lattes", codePostal: "34970", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
  const ouvert = await avecActeur(LUCAS, () => liens.ouvrirEspaceDuContact(thimalu.id));
  ids.dossierThimalu = ouvert.dossierId;
  permanentThimalu = ouvert.permanent;
  projetThimalu = ouvert.espace;
  await avecActeur(LUCAS, () => enregistrerPrestations(ouvert.dossierId, { CUISINE: ["facades-hautes", "facades-basses", "ilot"] }, "LUCAS"));
  await avecActeur(LUCAS, async () => {
    ids.photo1 = (await ajouterPhoto(ouvert.dossierId, await image(1600, 1200, { r: 200, g: 180, b: 150 }))).id;
    ids.photo2 = (await ajouterPhoto(ouvert.dossierId, await image(1200, 1600, { r: 120, g: 140, b: 160 }))).id;
    ids.simulation = (await deposerSimulationDossier(ouvert.dossierId, await image(1200, 800, { r: 90, g: 70, b: 50 }), { titre: "Chêne clair", source: "MANUEL" })).id;
  });
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientAdresse: "3 rue des Essais", clientCp: "34970", clientVille: "Lattes" } });

  // Rousse : dossier avec une date de pose, une adresse connue.
  const rousse = await prisma.lead.create({ data: { prenom: "Bernard", nom: "Rousse", telephone: "0600000032", email: "bernard.rousse@exemple.fr", ville: "Montpellier", codePostal: "34000", source: "META_ADS", typeProjet: "CUISINE" } });
  const ouvertRousse = await avecActeur(LUCAS, () => liens.ouvrirEspaceDuContact(rousse.id));
  ids.dossierRousse = ouvertRousse.dossierId;
  await prisma.dossier.update({ where: { id: ouvertRousse.dossierId }, data: { clientAdresse: "2 rue des Essais", clientCp: "34000", clientVille: "Montpellier", dateChantier: new Date("2026-10-05T12:00:00.000Z"), etape: "PLANIFIE" } });

  // Karim : lead Meta sans e-mail.
  ids.leadKarim = (await prisma.lead.create({ data: { prenom: "Karim", nom: "Sansmail", telephone: "0600000033", email: null, ville: "Pérols", codePostal: "34470", source: "META_ADS", typeProjet: "SDB" } })).id;

  // Dépenses du mois : pub hors chantier, matière rattachée, une fourniture non rattachée.
  const maintenant = new Date();
  await prisma.depense.createMany({
    data: [
      { payeeLe: maintenant, montant: 87.5, fournisseur: "Meta", categorie: "PUBLICITE", horsChantier: true },
      { payeeLe: maintenant, montant: 120, fournisseur: "Cover Styl'", categorie: "MATIERE", dossierId: ouvert.dossierId },
      { payeeLe: maintenant, montant: 15, fournisseur: "Leroy Merlin", categorie: "FOURNITURES" },
    ],
  });

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

  // Un devis émis pour Thimalu, par l'assistant (aperçu puis confirmation), comme dans le CRM.
  const lignes = [{ designation: "Revêtement adhésif — façades", quantite: 5, unite: "ml", prix_unitaire: 110 }];
  const apercu = await appeler("generer_document", { dossierId: ids.dossierThimalu, type: "DEVIS", objet: "Cuisine", lignes });
  const devis = await appeler("generer_document", { dossierId: ids.dossierThimalu, type: "DEVIS", objet: "Cuisine", lignes, confirmation: jetonDe(apercu) });
  ids.numeroDevis = /(\d{4}-\d{3})/.exec(devis)?.[1] ?? "";
  assert.ok(ids.numeroDevis, devis);
});

after(async () => {
  await client.close().catch(() => undefined);
  await prisma.$disconnect();
});

describe("Mission 10 : les actions qui manquaient", () => {
  test("les nouveaux outils sont exposés avec leur niveau ; les consignes portent la section « Dossiers, photos, espace »", async () => {
    const outils = await client.listTools();
    const niveau = (nom: string) => outils.tools.find((t) => t.name === nom)?.description?.match(/^\[([^\]]+)\]/)?.[1];
    assert.equal(niveau("modifier_dossier"), "Écriture réversible");
    assert.equal(niveau("annuler_modification"), "Écriture réversible");
    assert.equal(niveau("voir_photos"), "Lecture");
    assert.equal(niveau("voir_simulations"), "Lecture");
    assert.equal(niveau("messages_espace"), "Lecture");
    assert.equal(niveau("repondre_espace"), "Sensible (confirmation)");
    assert.equal(niveau("preparer_simulation"), "Écriture réversible");
    assert.equal(niveau("modifier_consignes"), "Sensible (confirmation)");
    assert.equal(niveau("restaurer_consignes"), "Écriture réversible");
    assert.equal(niveau("modifier_tarifs"), "Sensible (confirmation)");
    assert.equal(niveau("depenses"), "Lecture");
    assert.equal(niveau("lien_espace"), "Écriture réversible");
    const consignes = await client.readResource({ uri: "coverswap://consignes" });
    assert.match((consignes.contents[0] as { text: string }).text, /## Dossiers, photos, espace/);
  });

  test("« Mets l'îlot de Thimalu en chêne » : tracé avec l'ancienne valeur, devis signalé ; « annuler_modification » remet", async () => {
    const fait = await appeler("modifier_dossier", { nom: "Thimalu", teintes: { ilot: "chêne" }, commande: "Mets l'îlot de Thimalu en chêne" });
    assert.match(fait, /^Dossier de Anaïs Thimalu(?: — [^:]+?)? modifié : teintes par sous-partie : aucune → Cuisine › Îlot : chêne\./);
    assert.match(fait, new RegExp(`Le devis ${ids.numeroDevis} ne correspond plus : à régénérer`));
    assert.doesNotMatch(fait, /Jeton de confirmation/);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } });
    assert.deepEqual(JSON.parse(dossier.teintes ?? "{}"), { "CUISINE.ilot": "chêne" });
    const trace = await prisma.modificationDossier.findFirstOrThrow({ where: { dossierId: ids.dossierThimalu } });
    assert.equal(trace.par, "ASSISTANT:claude");
    assert.equal(trace.commande, "Mets l'îlot de Thimalu en chêne");
    const changements = JSON.parse(trace.champs) as { champ: string; avant: unknown; apres: unknown }[];
    assert.deepEqual(changements.map((c) => c.champ), ["teintes"]);
    assert.deepEqual(changements[0].avant, {});
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: ids.dossierThimalu, type: "DOSSIER_MODIFIE" } }), 1);
    const appel = await prisma.appelOutil.findFirstOrThrow({ where: { outil: "modifier_dossier", statut: "FAIT" } });
    assert.equal(appel.commande, "Mets l'îlot de Thimalu en chêne");
    // Annulation : par le même chemin, la trace reste (marquée annulée).
    const annule = await appeler("annuler_modification", { nom: "Thimalu", commande: "Annule, remets comme avant" });
    assert.match(annule, /Modification annulée chez Anaïs Thimalu(?: — [^:]+?)? : teintes par sous-partie : Cuisine › Îlot : chêne → aucune/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } })).teintes, null);
    assert.ok((await prisma.modificationDossier.findUniqueOrThrow({ where: { id: trace.id } })).annuleeLe);
    assert.match(await appeler("annuler_modification", { nom: "Thimalu", commande: "Annule encore" }), /déjà annulées|Aucune modification/);
  });

  test("« Décale la pose de Rousse au 12 octobre » : aperçu, confirmation exigée, puis la date change", async () => {
    const apercu = await appeler("modifier_dossier", { nom: "Rousse", date_chantier: "12 octobre", commande: "Décale la pose de Rousse au 12 octobre" });
    assert.match(apercu, /Je vais modifier le dossier de Bernard Rousse(?: — [^:]+?)? : date de pose : 5 octobre 2026 → 12 octobre 2026\./);
    assert.match(apercu, /Rien n'a été fait/);
    const jeton = jetonDe(apercu);
    assert.ok(jeton);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierRousse } })).dateChantier?.toISOString(), "2026-10-05T12:00:00.000Z");
    const fait = await appeler("modifier_dossier", { nom: "Rousse", date_chantier: "12 octobre", confirmation: jeton, commande: "Décale la pose de Rousse au 12 octobre" });
    assert.match(fait, /Dossier de Bernard Rousse(?: — [^:]+?)? modifié : date de pose : 5 octobre 2026 → 12 octobre 2026\./);
    assert.doesNotMatch(fait, /ne correspond plus/, "aucun devis émis chez Rousse");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierRousse } })).dateChantier?.toISOString(), "2026-10-12T12:00:00.000Z");
  });

  test("« Passe la salle de bain en sous-partie douche » : refusé avec les sous-parties possibles ; « plan vasque » passe", async () => {
    const refus = await appeler("modifier_dossier", { nom: "Thimalu", ajouter_sous_parties: ["SDB.douche"], commande: "Passe la salle de bain en sous-partie douche" });
    assert.match(refus, /^Refusé : « SDB\.douche » n'est pas une sous-partie connue\. Possibles : Salle de bain › Meuble vasque, Salle de bain › Plan vasque/);
    const fait = await appeler("modifier_dossier", { nom: "Thimalu", ajouter_sous_parties: ["plan vasque"], commande: "Ajoute le plan vasque de la salle de bain" });
    assert.match(fait, /familles et sous-parties : Cuisine : façades hautes, façades basses, îlot → Cuisine : façades hautes, façades basses, îlot · Salle de bain : plan vasque/);
    assert.match(fait, /ne correspond plus/);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } });
    assert.deepEqual(JSON.parse(dossier.prestations ?? "{}"), { CUISINE: ["facades-hautes", "facades-basses", "ilot"], SDB: ["plan-vasque"] });
    assert.equal(dossier.prestationsPar, "LUCAS");
  });

  test("« voir_photos » : de vraies images MCP, compressées, avec date et origine", async () => {
    const r = await appelerBrut("voir_photos", { nom: "Thimalu" });
    const t = texte(r);
    assert.match(t, /Anaïs Thimalu(?: — [^:]+?)? : 2 photo\(s\) avant chantier ; 2 jointe\(s\)/);
    assert.match(t, /déposée dans le CRM/);
    assert.match(t, new RegExp(`\\[photo:${ids.photo2}\\]`));
    const blocs = images(r);
    assert.equal(blocs.length, 2);
    for (const b of blocs) {
      assert.equal(b.mimeType, "image/jpeg");
      const octets = Buffer.from(b.data ?? "", "base64");
      assert.ok(octets.length > 500 && octets.length < 300_000, `taille ${octets.length}`);
      const meta = await sharp(octets).metadata();
      assert.ok((meta.width ?? 0) <= 1024 && (meta.height ?? 0) <= 1024, `${meta.width}x${meta.height}`);
    }
    const une = await appelerBrut("voir_photos", { dossierId: ids.dossierThimalu, nombre: 1, decalage: 1 });
    assert.equal(images(une).length, 1);
    assert.match(texte(une), /Photo 2/);
  });

  test("« voir_simulations » : l'après en image, les teintes, le statut, vue ou non par le client", async () => {
    const r = await appelerBrut("voir_simulations", { nom: "Thimalu" });
    const t = texte(r);
    assert.match(t, /1 simulation\(s\)/);
    assert.match(t, /« Chêne clair »/);
    assert.match(t, /déposée dans le CRM/);
    assert.match(t, /publiée \(visible par le client\)|brouillon/);
    assert.match(t, /pas encore vue par le client|brouillon/);
    assert.equal(images(r).length, 1);
    assert.equal(images(r)[0].mimeType, "image/jpeg");
  });

  test("« messages_espace » puis « repondre_espace » : « [à compléter] » bloque ; sinon aperçu, confirmation, message dans l'espace, notification, lu", async () => {
    await compte.envoyerMessage(permanentThimalu, projetThimalu, "Bonjour, est-ce que le chêne va avec un plan noir ?");
    const nonLus = await appeler("messages_espace", {});
    assert.match(nonLus, /1 message\(s\) non lu\(s\)/);
    assert.match(nonLus, /Anaïs Thimalu \(message, NON LU\) : « Bonjour, est-ce que le chêne va avec un plan noir \? »/);
    const bloque = await appeler("repondre_espace", { nom: "Thimalu", texte: "Bonjour, oui, le chêne clair se marie bien avec un plan noir. Comptez [à compléter] € pour l'îlot.", commande: "Réponds-lui que oui" });
    assert.match(bloque, /contient « \[à compléter\] » : elle ne partira pas/);
    const jetonBloque = jetonDe(bloque);
    assert.ok(jetonBloque);
    const refus = await appeler("repondre_espace", { nom: "Thimalu", texte: "Bonjour, oui, le chêne clair se marie bien avec un plan noir. Comptez [à compléter] € pour l'îlot.", confirmation: jetonBloque, commande: "Réponds-lui que oui" });
    assert.match(refus, /^Refusé : La réponse contient « \[à compléter\] »/);
    assert.equal(await prisma.messageEspace.count({ where: { auteur: "LUCAS" } }), 0);
    const reponse = "Bonjour, oui : le chêne clair se marie très bien avec un plan noir. Je vous prépare une simulation avec cette teinte.";
    const apercu = await appeler("repondre_espace", { nom: "Thimalu", texte: reponse, commande: "Réponds-lui que oui, le chêne va avec un plan noir" });
    assert.match(apercu, /Je vais répondre à Anaïs Thimalu(?: — [^:]+?)? dans son espace/);
    assert.match(apercu, /Rien n'a été fait/);
    const fait = await appeler("repondre_espace", { nom: "Thimalu", texte: reponse, confirmation: jetonDe(apercu), commande: "Réponds-lui que oui, le chêne va avec un plan noir" });
    assert.match(fait, /^Réponse envoyée dans l'espace de Anaïs Thimalu/);
    assert.match(fait, /Notification par mail programmée/);
    assert.match(fait, /1 message\(s\) du client marqué\(s\) lu\(s\)/);
    const message = await prisma.messageEspace.findFirstOrThrow({ where: { auteur: "LUCAS" } });
    assert.equal(message.texte, reponse);
    assert.equal(message.par, "ASSISTANT:claude");
    assert.ok(message.notifieLe);
    assert.equal(await prisma.messageEspace.count({ where: { auteur: "CLIENT", luLe: null } }), 0);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: ids.dossierThimalu, type: "ESPACE_REPONSE", direction: "SORTANT" } }), 1);
    const envoi = await prisma.envoiMail.findFirstOrThrow({ where: { cle: { startsWith: "notif:MESSAGE_LUCAS:" } } });
    assert.equal(envoi.a, "thimalu@exemple.fr");
    assert.match(envoi.texte, /CoverSwap vous a répondu dans votre espace : « Bonjour, oui : le chêne clair/);
    assert.match(envoi.texte, /#contact/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } })).main, "CLIENT");
    // Ce que le client voit dans l'onglet Contact : le fil, la réponse « nouvelle » ; puis vue.
    const vueClient = await compte.compteEspace(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanentThimalu.id } }));
    assert.deepEqual(vueClient.messages.map((m) => m.auteur), ["CLIENT", "COVERSWAP"]);
    assert.equal(vueClient.reponsesNonVues, 1);
    assert.equal(await compte.noterReponsesVues(permanentThimalu), 1);
    assert.equal((await compte.compteEspace(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: permanentThimalu.id } }))).reponsesNonVues, 0);
    assert.match(await appeler("messages_espace", { nom: "Thimalu" }), /2 message\(s\) avec Anaïs Thimalu/);
    assert.match(await appeler("messages_espace", {}), /Aucun message d'espace non lu/);
  });

  test("« Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot bois » : paquet ChatGPT complet, rien généré ni publié", async () => {
    const conflit = await appeler("preparer_simulation", { nom: "Thimalu", teintes: [{ zone: "colonnes", teinte: "café latte" }, { zone: "îlot", teinte: "bois" }], commande: "Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot bois" });
    assert.match(conflit, /Rien n'a été préparé/);
    assert.match(conflit, /« îlot » et « colonnes » sont la même zone du simulateur \(Meubles bas\)/);
    assert.equal(await prisma.preparationSimulation.count(), 0);
    const paquet = await appeler("preparer_simulation", { nom: "Thimalu", teintes: [{ zone: "meubles hauts", teinte: "café latte" }, { zone: "îlot", teinte: "bois" }], commande: "Prépare une simu de la cuisine de Thimalu, meubles hauts café latte, îlot bois" });
    assert.match(paquet, /Paquet ChatGPT prêt pour Anaïs Thimalu(?: — [^:(]+?)? \(Cuisine\) : Meubles hauts → Cafe Latte \(AB02\), Meubles bas → Beige Oak \(AA01\)/);
    assert.match(paquet, /Rien n'est généré ni publié/);
    const donnees = donneesDe<{ preparationId: string; photoId: string; planche: string; zones: { etiquette: string; ref: string }[] }>(paquet);
    assert.equal(donnees.photoId, ids.photo2, "la photo la plus récente à défaut");
    assert.deepEqual(donnees.zones.map((z) => `${z.etiquette.charAt(0)}:${z.ref}`), ["A:AB02", "B:AA01"], "les lettres de la planche suivent l'ordre des zones");
    assert.match(paquet, new RegExp(`/simulateur\\?dossier=${ids.dossierThimalu}&preparation=${donnees.preparationId}`));
    const preparation = await prisma.preparationSimulation.findUniqueOrThrow({ where: { id: donnees.preparationId } });
    assert.equal(preparation.mode, "CHATGPT");
    assert.equal(preparation.statut, "PREPAREE");
    assert.ok(preparation.promptTexte && preparation.promptTexte.length > 100, "le prompt verrouillé est rendu");
    assert.equal(await prisma.simulationEspace.count({ where: { dossierId: ids.dossierThimalu } }), 1, "aucune simulation ajoutée");
    assert.equal(await prisma.tache.count({ where: { type: "SIMULATION_API" } }), 0, "rien n'est parti à l'API");
    // Une teinte ambiguë : les candidats, pas un choix.
    const ambigu = await appeler("preparer_simulation", { nom: "Thimalu", teintes: [{ zone: "plan de travail", teinte: "white" }], commande: "Et un plan de travail blanc" });
    assert.match(ambigu, /2 teintes correspondent : demande à Lucas laquelle — Ultra White \(J3/);
  });

  test("« modifier_consignes » : diff en aperçu, confirmation, version restaurable ; « versions_consignes » et « restaurer_consignes »", async () => {
    const apercu = await appeler("modifier_consignes", { texte: "consignes", mode: "completer_section", section: "Principes de Lucas", contenu: "- Un chantier ne se planifie jamais un lundi matin.", commande: "Ajoute aux principes : jamais de chantier le lundi matin" });
    assert.match(apercu, /Je vais modifier les consignes \(completer section « Principes de Lucas »\)\. Lignes ajoutées \(1\) :\n\+ - Un chantier ne se planifie jamais un lundi matin\./);
    assert.doesNotMatch(apercu, /Lignes retirées/);
    assert.equal(await prisma.versionTexte.count(), 0);
    const fait = await appeler("modifier_consignes", { texte: "consignes", mode: "completer_section", section: "Principes de Lucas", contenu: "- Un chantier ne se planifie jamais un lundi matin.", confirmation: jetonDe(apercu), commande: "Ajoute aux principes : jamais de chantier le lundi matin" });
    assert.match(fait, /Consignes modifié\(es\), version 2 enregistrée/);
    const consignes = await client.readResource({ uri: "coverswap://consignes" });
    const texteConsignes = (consignes.contents[0] as { text: string }).text;
    assert.match(texteConsignes, /## Principes de Lucas\n(- .*\n)*- Un chantier ne se planifie jamais un lundi matin\./);
    assert.match(texteConsignes, /## Mail/);
    const versions = await appeler("versions_consignes", { texte: "consignes" });
    assert.match(versions, /v2 — .* — ASSISTANT:claude — « Ajoute aux principes : jamais de chantier le lundi matin » — \d+ caractères \(courante\)/);
    assert.match(versions, /v1 — .* — DEFAUT — « État d'avant la première modification »/);
    const restaure = await appeler("restaurer_consignes", { texte: "consignes", numero: 1, commande: "Reviens à la version d'avant" });
    assert.match(restaure, /version 1 restaurée \(enregistrée comme version 3\)/);
    assert.doesNotMatch((await client.readResource({ uri: "coverswap://consignes" })).contents[0] && ((await client.readResource({ uri: "coverswap://consignes" })).contents[0] as { text: string }).text, /lundi matin/);
    const inconnue = await appeler("modifier_consignes", { texte: "consignes", mode: "remplacer_section", section: "Section qui n'existe pas", contenu: "- rien" });
    assert.match(inconnue, /^Refusé : Section « Section qui n'existe pas » introuvable ou ambiguë\. Sections : /);
  });

  test("« lien_espace » sur un lead Meta sans e-mail : espace créé, lien et SMS rendus, aucun mail parti, main au client", async () => {
    const t = await appeler("lien_espace", { nom: "Sansmail", commande: "Donne-moi le lien de l'espace de Karim, je lui envoie par SMS" });
    assert.match(t, /Espace ouvert pour Karim Sansmail \(0600000033\)\. Rien n'a été envoyé/);
    assert.match(t, /Lien : https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_.-]+/);
    assert.match(t, /SMS :\nBonjour Karim, comme convenu, voici votre espace personnel : déposez-y 2 ou 3 photos de la pièce/);
    assert.doesNotMatch(t, /Il a aussi un e-mail/);
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { leadId: ids.leadKarim } });
    assert.ok(await prisma.espaceClient.findUnique({ where: { dossierId: dossier.id } }), "l'espace existe");
    assert.equal(await prisma.envoiMail.count({ where: { dossierId: dossier.id } }), 0, "aucun mail");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: dossier.id, type: "ESPACE_LIEN_COMMUNIQUE" } }), 1);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).main, "CLIENT");
    const rappel = await appeler("lien_espace", { dossierId: dossier.id, code: "LIEN_ESPACE_RAPPEL", commande: "Redonne-moi le lien de Karim" });
    assert.match(rappel, /Espace déjà ouvert/);
    assert.match(rappel, /voici à nouveau le lien de votre espace/);
  });

  test("« Qu'est-ce que j'ai dépensé en pub ce mois-ci ? » : par catégorie, rattaché ou non", async () => {
    const pub = await appeler("depenses", { periode: "mois_en_cours", categorie: "PUBLICITE" });
    assert.match(pub, /Dépenses le mois en cours, publicité : 87,5 € en 1 dépense\(s\)\./);
    assert.match(pub, /hors chantier : 87,5 € \(1\)/);
    const tout = await appeler("depenses", {});
    assert.match(tout, /: 222,5 € en 3 dépense\(s\)/);
    assert.match(tout, /Rattachées à un chantier : 120 € \(1\) ; hors chantier : 87,5 € \(1\) ; pas encore rattachées : 15 € \(1\)/);
    assert.match(tout, /À rattacher \(ou à marquer hors chantier\) : .*Leroy Merlin.*NON RATTACHÉE/);
    const non = await appeler("depenses", { rattachement: "non_rattachees" });
    assert.match(non, /15 € en 1 dépense\(s\)/);
  });

  test("« modifier_tarifs » : aperçu avec l'ancien prix et les sous-parties qui partagent le tarif, confirmation ; les devis émis ne bougent pas", async () => {
    const avant = await appeler("tarifs", { sous_partie: "ilot" });
    assert.match(avant, /Cuisine › Îlot \(CUISINE\.ilot\) : 110 € \/ ml — tarif « Revêtement adhésif — cuisine \/ façades » \(par mots-clés\)/);
    const apercu = await appeler("modifier_tarifs", { sous_partie: "ilot", prix_unitaire: 95, commande: "Passe l'îlot à 95 euros le mètre" });
    assert.match(apercu, /Je vais modifier le tarif « Revêtement adhésif — cuisine \/ façades » \(trouvé par mots-clés, il sera attribué à cette sous-partie\) pour Cuisine › Îlot : 110 € \/ ml → 95 € \/ ml\. Ce tarif sert aussi à : Cuisine › Façades hautes/);
    assert.match(apercu, /Les devis déjà émis ne changent pas/);
    const devisAvant = await prisma.document.findFirstOrThrow({ where: { numero: ids.numeroDevis } });
    const fait = await appeler("modifier_tarifs", { sous_partie: "ilot", prix_unitaire: 95, confirmation: jetonDe(apercu), commande: "Passe l'îlot à 95 euros le mètre" });
    assert.match(fait, /Tarif modifié pour Cuisine › Îlot : 110 € \/ ml → 95 € \/ ml/);
    const { tarifsDesPrestations } = await import("@/lib/prestations/tarifs");
    const ilot = (await tarifsDesPrestations()).find((l) => l.cle === "CUISINE.ilot")!;
    assert.equal(ilot.prixUnitaire, 95);
    assert.equal(ilot.explicite, true);
    const devisApres = await prisma.document.findFirstOrThrow({ where: { numero: ids.numeroDevis } });
    assert.equal(devisApres.totalHt, devisAvant.totalHt);
    assert.equal(devisApres.lignes, devisAvant.lignes);
  });

  test("« chercher » accepte une adresse et un numéro de devis", async () => {
    const adresse = await appeler("chercher", { texte: "2 rue des Essais" });
    assert.match(adresse, /Dossier : Bernard Rousse — .* — adresse|Bernard Rousse/);
    const candidats = donneesDe<{ nom: string; motif: string }[]>(adresse);
    assert.ok(candidats.some((c) => c.nom.startsWith("Bernard Rousse") && c.motif === "adresse"), JSON.stringify(candidats));
    assert.ok(!candidats.some((c) => c.nom.startsWith("Anaïs Thimalu")), "3 rue des Essais n'est pas 2 rue des Essais");
    const numero = await appeler("chercher", { texte: ids.numeroDevis });
    const parNumero = donneesDe<{ nom: string; motif: string; etat: string }[]>(numero);
    assert.equal(parNumero.length, 1);
    assert.match(parNumero[0].nom, /^Anaïs Thimalu/);
    assert.equal(parNumero[0].motif, "numéro de devis");
    assert.match(parNumero[0].etat, new RegExp(`devis ${ids.numeroDevis}`));
  });

  test("« ce_qui_m_attend » et « point_du_jour » comptent les messages d'espace non lus et les propositions en attente", async () => {
    await compte.envoyerMessage(permanentThimalu, projetThimalu, "Et pour la crédence, vous conseillez quoi ?");
    const attend = await appeler("ce_qui_m_attend", {});
    assert.match(attend, /1 message\(s\) d'espace non lu\(s\) \(« messages_espace »\)/);
    assert.match(attend, /\d+ proposition\(s\) à valider \(cartes de mise à jour, relances, règles\)/);
    const point = await appeler("point_du_jour", {});
    assert.match(point, /2 message\(s\) de clients dans leur espace \(Anaïs Thimalu : « Et pour la crédence/);
    assert.match(point, /1 message\(s\) d'espace non lu\(s\), \d+ proposition\(s\) à valider\./);
    assert.match(await appeler("marquer_messages_lus", { nom: "Thimalu", commande: "C'est lu, je l'appelle" }), /1 message\(s\) de Anaïs Thimalu(?: — [^:]+?)? marqué\(s\) lu\(s\)/);
  });

  test("journal : chaque écriture porte la phrase de Lucas ; aucun appel Anthropic, aucun réseau sorti", async () => {
    const ecritures = await prisma.appelOutil.findMany({ where: { niveau: { not: "LECTURE" }, statut: "FAIT", outil: { in: ["modifier_dossier", "annuler_modification", "repondre_espace", "preparer_simulation", "modifier_consignes", "restaurer_consignes", "lien_espace", "modifier_tarifs", "marquer_messages_lus"] } } });
    assert.ok(ecritures.length >= 9, String(ecritures.length));
    for (const e of ecritures) assert.ok(e.commande, `${e.outil} sans commande`);
    const session = await prisma.sessionAssistant.findFirstOrThrow();
    assert.ok(session.ecritures >= ecritures.length);
    assert.deepEqual(appelsAnthropic, []);
    assert.deepEqual(appelsReseau.filter((u) => !/ssi\.s3\.fr-par\.scw\.cloud|cms\.coverstyl\.com/.test(u)), [], "seuls les échantillons Cover Styl' ont été tentés (et coupés)");
  });
});
