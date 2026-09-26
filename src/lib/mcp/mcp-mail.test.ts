import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 9 : les dix phrases du mandat, rejouées par un VRAI client MCP (SDK)
 * branché sur la route /api/mcp, sur une copie de base ; l'état de la base est
 * contrôlé après chacune. Aucun appel vers api.anthropic.com : le fetch est
 * surveillé pendant toute la suite.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY"]) process.env[cle] = "";
process.env.ANTHROPIC_API_KEY = "cle-factice-qui-ne-doit-jamais-servir";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";

type Client = import("@modelcontextprotocol/sdk/client/index.js").Client;
let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/mcp/route");
let NextRequest: typeof import("next/server").NextRequest;
let client: Client;
const appelsAnthropic: string[] = [];
const MCP = "http://localhost:3001/api/mcp";

const fetchLocal: typeof fetch = async (entree, init) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const requete = new NextRequest(new Request(url, init));
  if (requete.method === "POST") return route.POST(requete);
  if (requete.method === "DELETE") return route.DELETE(requete);
  return route.GET(requete);
};

const texte = (r: unknown) => ((r as { content: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("\n");
const appeler = async (nom: string, args: Record<string, unknown>) => texte(await client.callTool({ name: nom, arguments: args }));
const jetonDe = (t: string) => /Jeton de confirmation : ([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? null;
const idsDe = (t: string, prefixe: string) => [...t.matchAll(new RegExp(`\\[${prefixe}:([a-z0-9]+)\\]`, "g"))].map((m) => m[1]);

let rang = 0;
async function mail(donnees: Record<string, unknown>, texteMail: string) {
  rang++;
  const m = await prisma.message.create({
    data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: `mcp9-${rang}`, filCanal: `mcpfil-${rang}`, sens: "ENTRANT", de: `inconnu${rang}@exemple.fr`, objet: `Objet ${rang}`, extrait: texteMail.slice(0, 120), recuLe: new Date(Date.now() - rang * 90_000), classe: "CLIENT", classePar: "TRI", ...donnees },
  });
  await prisma.contenuMessage.create({ data: { messageId: m.id, texte: texteMail } });
  return m;
}

const ids: Record<string, string> = {};

before(async () => {
  const ancien = globalThis.fetch;
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (url.includes("anthropic.com")) {
      appelsAnthropic.push(url);
      throw new Error("appel interdit vers Anthropic");
    }
    return ancien(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  route = await import("@/app/api/mcp/route");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();

  // Le jeu de données : des clients, des mails, comme après une relève.
  const rousse = await prisma.client.create({ data: { nom: "Bernard Rousse", prenom: "Bernard", nomFamille: "Rousse", source: "INCONNUE", premierContactLe: new Date(), emails: { create: { adresse: "bernard.rousse@exemple.fr" } } } });
  const dRousse = await prisma.dossier.create({ data: { clientNom: "Bernard Rousse", clientAdresse: "2 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000021", clientEmail: "bernard.rousse@exemple.fr", objet: "Cuisine", source: "ENTRANT", etape: "CHANTIER", clientId: rousse.id } });
  ids.dossierRousse = dRousse.id;
  await mail({ filCanal: "fil-rousse", de: "bernard.rousse@exemple.fr", deNom: "Bernard Rousse", objet: "Pose de la cuisine", clientId: rousse.id, dossierId: dRousse.id, recuLe: new Date(Date.now() - 3 * 86_400_000) }, "Bonjour, à quelle heure passez-vous jeudi ?");
  await mail({ filCanal: "fil-rousse", sens: "SORTANT", de: "coverswap.contact@gmail.com", a: JSON.stringify(["bernard.rousse@exemple.fr"]), objet: "Re: Pose de la cuisine", clientId: rousse.id, dossierId: dRousse.id, recuLe: new Date(Date.now() - 2 * 86_400_000) }, "Bonjour, je serai là vers 9 h. Lucas");
  const rousse3 = await mail({ filCanal: "fil-rousse", de: "bernard.rousse@exemple.fr", deNom: "Bernard Rousse", objet: "Re: Pose de la cuisine", clientId: rousse.id, dossierId: dRousse.id, recuLe: new Date(Date.now() - 3_600_000) }, "Merci. Par contre le film se décolle déjà sur deux portes du haut, ce n'est pas normal. Pouvez-vous repasser ?");
  ids.mailRousse = rousse3.id;

  const thimalu = await prisma.client.create({ data: { nom: "Anaïs Thimalu", prenom: "Anaïs", nomFamille: "Thimalu", source: "INCONNUE", premierContactLe: new Date(), emails: { create: { adresse: "thimalu@exemple.fr" } } } });
  const dThimalu = await prisma.dossier.create({ data: { clientNom: "Anaïs Thimalu", clientAdresse: "3 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0600000022", objet: "Cuisine", source: "ENTRANT", etape: "SIMULATION", clientId: thimalu.id } });
  ids.dossierThimalu = dThimalu.id;
  const mThimalu = await mail({ de: "thimalu@exemple.fr", deNom: "Anaïs Thimalu", objet: "Changement de teinte", clientId: thimalu.id, dossierId: dThimalu.id }, "Bonjour Lucas, finalement je préfère le marbre blanc plutôt que le chêne pour les façades. Je serai disponible le 2 octobre à 14h pour la prise de mesures. Ci-joint deux photos de la cuisine. Anaïs");
  ids.mailThimalu = mThimalu.id;
  const { enregistrerFichier } = await import("@/lib/fichiers/stockage");
  for (const [rangPiece, nom] of [[1, "cuisine-1.jpg"], [2, "cuisine-2.jpg"]] as const) {
    const fichier = await enregistrerFichier("messages", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], nom, { type: "image/jpeg" }));
    await prisma.pieceMessage.create({ data: { messageId: mThimalu.id, rang: rangPiece, nom, typeMime: "image/jpeg", taille: 22, partie: String(rangPiece), statut: "CONSERVEE", fichierId: fichier.id } });
  }

  const maud = await prisma.client.create({ data: { nom: "Maud Lefort", prenom: "Maud", nomFamille: "Lefort", source: "INCONNUE", premierContactLe: new Date(), emails: { create: { adresse: "maud@exemple.fr" } } } });
  const mMaud = await mail({ de: "maud@exemple.fr", deNom: "Maud Lefort", objet: "Date de pose ?", clientId: maud.id }, "Bonjour, savez-vous quand aura lieu la pose ? Merci, Maud");
  ids.mailMaud = mMaud.id;

  const mMeta = await mail({ de: "noreply@facebookmail.com", deNom: "Meta for Business", objet: "Votre facture Meta Ads du 21 septembre", classe: "ADMINISTRATIF" }, "Votre reçu de paiement Meta Ads. Montant facturé : 87,50 €. Campagne cuisine septembre. Référence FB-2026-0921.");
  ids.mailMeta = mMeta.id;

  const karim = await prisma.lead.create({ data: { prenom: "Karim", nom: "Dispo", telephone: "0600000023", email: "karim@exemple.fr", ville: "Pérols", codePostal: "34470", source: "SITE_DEVIS" } });
  ids.leadKarim = karim.id;
  const mKarim = await mail({ de: "karim@exemple.fr", deNom: "Karim Dispo", objet: "Rendez-vous", leadId: karim.id }, "Bonjour, je suis dispo mardi 14h pour que vous passiez voir la cuisine. Karim");
  ids.mailKarim = mKarim.id;

  const marbrier = await prisma.client.create({ data: { nom: "Sophie Marbre", prenom: "Sophie", nomFamille: "Marbre", source: "INCONNUE", premierContactLe: new Date(), emails: { create: { adresse: "sophie.marbre@exemple.fr" } } } });
  const mMarbre = await mail({ de: "sophie.marbre@exemple.fr", deNom: "Sophie Marbre", objet: "Idée pour la cuisine", clientId: marbrier.id, recuLe: new Date(Date.now() - 20 * 86_400_000) }, "Bonjour, je voudrais du marbre sur l'îlot central, et garder le bois sur le reste. Qu'en pensez-vous ?");
  ids.mailMarbre = mMarbre.id;

  for (let i = 1; i <= 3; i++) await mail({ filCanal: `tiktok-${i}`, de: "promo@tiktok-mails.com", deNom: "TikTok for Business", objet: `Boostez vos vidéos ${i}`, classe: "HUMAIN" }, "Découvrez nos offres pour booster vos vidéos.");

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

describe("les dix phrases du mandat", () => {
  test("les outils du mail sont exposés avec leur niveau ; les consignes portent la section Mail", async () => {
    const outils = await client.listTools();
    const noms = outils.tools.map((t) => t.name);
    for (const nom of ["lire_mail", "mails_non_classes", "rechercher_mails", "classer_mail", "resumer_fil", "proposer_mise_a_jour", "valider_proposition", "ignorer_proposition", "deposer_brouillon", "snoozer_mail", "rattacher_mail", "ranger_mail", "proposer_regle"]) assert.ok(noms.includes(nom), nom);
    assert.match(outils.tools.find((t) => t.name === "lire_mail")!.description ?? "", /^\[Lecture\]/);
    assert.match(outils.tools.find((t) => t.name === "classer_mail")!.description ?? "", /^\[Écriture réversible\]/);
    assert.match(outils.tools.find((t) => t.name === "envoyer_mail")!.description ?? "", /^\[Sensible/);
    const consignes = await client.readResource({ uri: "coverswap://consignes" });
    assert.match((consignes.contents[0] as { text: string }).text, /## Mail/);
  });

  test("1. « Classe mes mails » : lecture, classement en lot, confirmation au-delà de trois", async () => {
    const liste = await appeler("mails_non_classes", {});
    const aClasser = idsDe(liste, "mail");
    assert.ok(aClasser.length >= 6, liste.slice(0, 300));
    const mails = aClasser.map((messageId) => ({ messageId, intention: messageId === ids.mailMeta ? "ACTION" : messageId === ids.mailRousse ? "REPONSE" : "REPONSE", attendu: messageId === ids.mailMeta ? "Facture à régler" : "Répondre", ...(messageId === ids.mailThimalu ? { dates: [{ date: "2026-10-02", heure: "14:00", nature: "DISPONIBILITE", passage: "Je serai disponible le 2 octobre à 14h" }] } : {}) }));
    const apercu = await appeler("classer_mail", { mails, commande: "Classe mes mails" });
    const jeton = jetonDe(apercu);
    assert.ok(jeton, apercu);
    assert.equal(await prisma.message.count({ where: { id: { in: aClasser }, intention: { not: null } } }), 0, "rien avant confirmation");
    const fait = await appeler("classer_mail", { mails, confirmation: jeton, commande: "Classe mes mails" });
    assert.match(fait, new RegExp(`${aClasser.length} mails classés`));
    assert.equal(await prisma.message.count({ where: { id: { in: aClasser }, intention: { not: null }, intentionPar: "ASSISTANT:claude" } }), aClasser.length);
    assert.equal((await prisma.appelOutil.count({ where: { outil: "classer_mail", statut: "FAIT" } })), 1, "un lot = une écriture");
    assert.equal(await appeler("mails_non_classes", {}).then((t) => /Aucun mail à classer/.test(t)), true);
  });

  test("2. « Qu'est-ce que j'ai à traiter ? » : par priorité, la réclamation en tête, avec intention et attendu", async () => {
    const t = await appeler("mails_a_traiter", {});
    const premiere = t.split("\n").find((l) => /^1\. /.test(l)) ?? "";
    assert.match(premiere, /\[Réclamation\]/);
    assert.match(premiere, /Rousse/);
    assert.match(t, /réponse\s*: Répondre|action\s*: Facture à régler/);
  });

  test("3. « Résume-moi le fil avec Rousse » : lecture par le nom, résumé posé", async () => {
    const fil = await appeler("lire_mail", { nom: "Rousse" });
    assert.match(fil, /Fil \(3\)/);
    assert.match(fil, /le film se décolle/);
    assert.match(fil, /Chronologie/);
    const r = await appeler("resumer_fil", { messageId: ids.mailRousse, resume: "Pose faite jeudi matin.\nLe film se décolle sur deux portes du haut.\nIl demande un nouveau passage.", points_en_suspens: [{ texte: "Repasser pour les deux portes" }], commande: "Résume-moi le fil avec Rousse" });
    assert.match(r, /Résumé posé sur le fil \(3 messages\)/);
    const resume = await prisma.resumeFil.findUnique({ where: { canal_filCanal: { canal: "EMAIL", filCanal: "fil-rousse" } } });
    assert.equal(resume?.par, "ASSISTANT:claude");
    assert.match(await appeler("lire_mail", { messageId: ids.mailRousse }), /Résumé \(ASSISTANT:claude/);
  });

  test("4. « Qu'est-ce que le mail de Thimalu change dans son dossier ? » : trois cartes, « valide la teinte, pas la date », photos rangées", async () => {
    const fil = await appeler("lire_mail", { nom: "Thimalu" });
    assert.match(fil, /marbre blanc/);
    const depot = await appeler("proposer_mise_a_jour", {
      messageId: ids.mailThimalu,
      propositions: [
        { cible: "DOSSIER", champ: "note", valeur: "Teinte : marbre blanc plutôt que chêne (façades)", libelle: "Teinte souhaitée : marbre blanc", passage: "je préfère le marbre blanc plutôt que le chêne pour les façades" },
        { cible: "DOSSIER", champ: "dateChantier", valeur: "2026-10-02", libelle: "Prise de mesures le 2 octobre à 14 h", passage: "Je serai disponible le 2 octobre à 14h pour la prise de mesures" },
        { cible: "DOSSIER", champ: "photos", valeur: "toutes", libelle: "Deux photos de la cuisine à ranger", passage: "Ci-joint deux photos de la cuisine" },
      ],
      commande: "Qu'est-ce que le mail de Thimalu change dans son dossier ?",
    });
    assert.match(depot, /3 cartes déposées, rien n'est modifié/);
    const cartes = idsDe(depot, "proposition");
    assert.equal(cartes.length, 3);
    const avant = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } });
    assert.equal(avant.dateChantier, null);
    // La date de chantier est sensible : aperçu, pas d'application.
    const apercu = await appeler("valider_proposition", { propositionIds: [cartes[1]], commande: "valide tout" });
    assert.ok(jetonDe(apercu), apercu);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } })).dateChantier, null, "rien sans confirmation");
    // « Valide la teinte, pas la date » : la note passe (pas sensible), la date est ignorée.
    const teinte = await appeler("valider_proposition", { propositionIds: [cartes[0]], commande: "valide la teinte, pas la date" });
    assert.match(teinte, /^Appliqué : Teinte souhaitée/);
    assert.equal(await prisma.dossierNote.count({ where: { dossierId: ids.dossierThimalu, contenu: { contains: "marbre blanc" } } }), 1);
    const ignore = await appeler("ignorer_proposition", { propositionIds: [cartes[1]], motif: "PAS_MAINTENANT", commande: "valide la teinte, pas la date" });
    assert.match(ignore, /^Ignoré/);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: cartes[1] } })).statut, "REJETEE");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } })).dateChantier, null, "ignorer ne touche à rien");
    // Les photos : rangées dans le dossier (donc dans Drive par la tâche du miroir) et dans la chronologie.
    const photos = await appeler("valider_proposition", { propositionIds: [cartes[2]], commande: "et range les photos" });
    assert.match(photos, /^Appliqué : Deux photos/);
    const apres = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierThimalu } });
    assert.equal((JSON.parse(apres.photos) as unknown[]).length, 2);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: ids.dossierThimalu, type: "NOTE_AJOUTEE", contenu: { contains: "Photo reçue par mail" } } }), 2);
    const chrono = await appeler("lire_mail", { messageId: ids.mailThimalu, chronologie: 40 });
    assert.match(chrono, /Teinte souhaitée : marbre blanc/);
    assert.match(chrono, /Aucune carte en attente/);
  });

  test("5. « Réponds à Maud que la date de pose sera fixée dès réception des kits » puis « envoie » : brouillon déposé, aperçu, confirmation ; « [à compléter] » bloque", async () => {
    const fil = await appeler("lire_mail", { nom: "Maud" });
    assert.match(fil, /quand aura lieu la pose/);
    const depot = await appeler("deposer_brouillon", { messageId: ids.mailMaud, objet: "Re: Date de pose ?", texte: "Bonjour Maud,\n\nLa date de pose sera fixée dès réception des kits : je vous la confirme aussitôt.\n\nBonne journée,\nLucas", commande: "Réponds à Maud que la date de pose sera fixée dès réception des kits" });
    const brouillonId = /\[brouillon:([a-z0-9]+)\]/.exec(depot)?.[1];
    assert.ok(brouillonId, depot);
    assert.match(depot, /Rien n'est parti/);
    const b = await prisma.brouillonMail.findUniqueOrThrow({ where: { id: brouillonId } });
    assert.deepEqual([b.source, b.statut, b.a, b.messageId], ["ASSISTANT", "BROUILLON", "maud@exemple.fr", ids.mailMaud]);
    // Un trou : refusé même confirmé.
    const trou = await appeler("envoyer_mail", { a: "maud@exemple.fr", objet: "Re: Date de pose ?", texte: "Bonjour Maud, la pose est prévue le [à compléter].", en_reponse_a: ids.mailMaud });
    const refus = await appeler("envoyer_mail", { a: "maud@exemple.fr", objet: "Re: Date de pose ?", texte: "Bonjour Maud, la pose est prévue le [à compléter].", en_reponse_a: ids.mailMaud, confirmation: jetonDe(trou) });
    assert.match(refus, /^Refusé : Le mail contient encore « \[à compléter\] »/);
    assert.equal(await prisma.envoiMail.count({ where: { enReponseA: ids.mailMaud } }), 0);
    // « envoie » : aperçu, puis confirmation → envoi programmé (il attend Gmail, absent ici).
    const apercu = await appeler("envoyer_mail", { a: "maud@exemple.fr", objet: b.objetIa, texte: b.texteIa, en_reponse_a: ids.mailMaud, brouillonId, commande: "envoie" });
    assert.match(apercu, /Je vais envoyer à maud@exemple.fr/);
    assert.equal(await prisma.envoiMail.count({ where: { enReponseA: ids.mailMaud } }), 0, "rien avant confirmation");
    const envoye = await appeler("envoyer_mail", { a: "maud@exemple.fr", objet: b.objetIa, texte: b.texteIa, en_reponse_a: ids.mailMaud, brouillonId, confirmation: jetonDe(apercu), commande: "envoie" });
    assert.match(envoye, /Mail envoyé à maud@exemple.fr/);
    const envoi = await prisma.envoiMail.findFirst({ where: { enReponseA: ids.mailMaud } });
    assert.equal(envoi?.brouillonId, brouillonId);
    assert.ok(["A_ENVOYER", "ENVOYE"].includes(envoi?.statut ?? ""), envoi?.statut);
  });

  test("6. « Le mail de la facture Meta, mets-le en dépense » : lecture, dépense hors chantier", async () => {
    const trouve = await appeler("rechercher_mails", { texte: "facture Meta" });
    assert.ok(idsDe(trouve, "mail").includes(ids.mailMeta), trouve);
    const fil = await appeler("lire_mail", { messageId: ids.mailMeta });
    assert.match(fil, /87,50 €/);
    const r = await appeler("rattacher_depense", { montant: 87.5, fournisseur: "Meta", categorie: "PUBLICITE", libelle: "Meta Ads — reçu du 21 septembre (FB-2026-0921)", hors_chantier: true, commande: "Le mail de la facture Meta, mets-le en dépense" });
    assert.match(r, /Dépense enregistrée : 87,5 € chez Meta \(PUBLICITE\), hors chantier/);
    const depense = await prisma.depense.findFirst({ where: { fournisseur: "Meta" } });
    assert.deepEqual([depense?.montant, depense?.categorie, depense?.horsChantier], [87.5, "PUBLICITE", true]);
  });

  test("7. « Il dit qu'il est dispo mardi 14h, planifie » : rappel du lead un mardi à 14 h", async () => {
    const r = await appeler("planifier", { leadId: ids.leadKarim, action: "Passer voir la cuisine", quand: "mardi 14h", commande: "Il dit qu'il est dispo mardi 14h, planifie" });
    assert.match(r, /^Planifié : Passer voir la cuisine pour Karim Dispo/);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadKarim } });
    assert.equal(lead.rappelLe?.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" }), "mardi");
    assert.equal(lead.rappelLe?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }), "14:00");
  });

  test("8. « Ce mail, remets-le-moi lundi » : lundi 9 h Paris, hors d'À traiter jusque-là", async () => {
    const r = await appeler("snoozer_mail", { messageId: ids.mailKarim, quand: "lundi", commande: "Ce mail, remets-le-moi lundi" });
    assert.match(r, /^Remis au .* à 09:00/);
    const m = await prisma.message.findUniqueOrThrow({ where: { id: ids.mailKarim } });
    assert.equal(m.snoozeJusqua?.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" }), "lundi");
    assert.equal(m.snoozePar, "ASSISTANT:claude");
    assert.doesNotMatch(await appeler("mails_a_traiter", {}), new RegExp(`\\[mail:${ids.mailKarim}\\]`));
    const { conversations } = await import("@/lib/mail/vues");
    const revenu = (await conversations(new Date(m.snoozeJusqua!.getTime() + 60_000))).find((l) => l.messageId === ids.mailKarim)!;
    assert.deepEqual([revenu.aTraiter, revenu.mention, revenu.priorite.rang], [true, "Revenu", 0]);
  });

  test("9. « Retrouve le client qui voulait du marbre sur l'îlot »", async () => {
    const r = await appeler("rechercher_mails", { texte: "marbre îlot", commande: "Retrouve le client qui voulait du marbre sur l'îlot" });
    assert.ok(idsDe(r, "mail").includes(ids.mailMarbre), r);
    assert.match(r, /client Sophie Marbre/);
    assert.match(r, /marbre sur l'îlot/);
  });

  test("10. « Range tout ce qui vient de TikTok pour toujours » : rangement par expéditeur (aperçu, confirmation), règle proposée puis validée", async () => {
    const apercu = await appeler("ranger_mail", { expediteur: "@tiktok-mails.com", commande: "Range tout ce qui vient de TikTok pour toujours" });
    assert.match(apercu, /Je vais ranger 3 fils/);
    assert.equal(await prisma.message.count({ where: { de: "promo@tiktok-mails.com", rangeLe: { not: null } } }), 0, "rien avant confirmation");
    const fait = await appeler("ranger_mail", { expediteur: "@tiktok-mails.com", confirmation: jetonDe(apercu), commande: "Range tout ce qui vient de TikTok pour toujours" });
    assert.match(fait, /3 mails rangés/);
    assert.equal(await prisma.message.count({ where: { de: "promo@tiktok-mails.com", rangeLe: { not: null }, rangePar: "ASSISTANT", lu: true } }), 3);
    // Trois rangements de la même adresse : le CRM a déjà proposé la règle sur l'adresse ; Claude propose le domaine.
    const regle = await appeler("proposer_regle", { cible: "@tiktok-mails.com", action: "RANGER", motif: "Lucas ne veut plus voir TikTok", commande: "Range tout ce qui vient de TikTok pour toujours" });
    const propositionId = /\[proposition:([a-z0-9]+)\]/.exec(regle)?.[1];
    assert.ok(propositionId, regle);
    assert.equal(await prisma.regleExpediteur.count({ where: { cible: "@tiktok-mails.com" } }), 0, "pas posée sans validation");
    const validee = await appeler("valider_proposition", { propositionIds: [propositionId], commande: "oui, pour toujours" });
    assert.match(validee, /^Appliqué : Toujours ranger les mails de @tiktok-mails.com/);
    assert.equal((await prisma.regleExpediteur.findFirst({ where: { cible: "@tiktok-mails.com", archiveLe: null } }))?.action, "RANGER");
    const apprise = await prisma.proposition.findFirst({ where: { cleUnicite: "regle-tri:promo@tiktok-mails.com:RANGER" } });
    assert.equal(apprise?.statut, "EN_ATTENTE", "la règle apprise sur l'adresse attend Lucas");
  });

  test("journal des sessions : chaque phrase avec ses outils ; aucun appel vers Anthropic", async () => {
    const { sessionsRecentes } = await import("@/lib/assistant/execution");
    const [session] = await sessionsRecentes(1);
    const outils = new Set(session.derniers.map((a) => a.outil));
    for (const nom of ["mails_non_classes", "classer_mail", "mails_a_traiter", "lire_mail", "resumer_fil", "proposer_mise_a_jour", "valider_proposition", "ignorer_proposition", "deposer_brouillon", "envoyer_mail", "rattacher_depense", "planifier", "snoozer_mail", "rechercher_mails", "ranger_mail", "proposer_regle"]) assert.ok(outils.has(nom), nom);
    assert.ok(session.derniers.some((a) => a.commande === "Classe mes mails"));
    assert.deepEqual(appelsAnthropic, []);
  });
});
