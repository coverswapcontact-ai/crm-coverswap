import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-generiques-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — les outils génériques « modifier », « creer », « archiver », « restaurer » et
 * « annuler_modification » : pour chaque entité, l'outil laisse la base dans LE MÊME état que la fonction de l'écran
 * (deux jumeaux : l'un par l'outil, l'autre par le service ; ou, pour un réglage unique, le service rejoué après
 * l'outil ne change plus rien) ; aperçu et jeton sur chaque cas sensible (sans jeton rien n'est fait, un jeton
 * resservi est refusé) ; annulation sur plusieurs entités ; acteur « ASSISTANT:claude » au journal ; le plafond
 * d'écritures n'est jamais atteint (les cas sont regroupés). Noms fictifs ; aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type Outil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let gen: typeof import("@/lib/assistant/outils/generiques");
let session: import("@/lib/assistant/execution").Session;

const jetonDe = (t: string) => /confirmation = « ([A-Za-z0-9_-]+) »/.exec(t)?.[1] ?? null;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const hier = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function outil(nom: "modifier" | "creer" | "archiver" | "restaurer" | "annuler_modification"): Outil {
  const o = gen.OUTILS_GENERIQUES.find((x) => x.nom === nom);
  assert.ok(o, `outil inconnu : ${nom}`);
  return o as unknown as Outil;
}
async function appeler(nom: Parameters<typeof outil>[0], entree: Record<string, unknown>): Promise<ResultatOutil> {
  return execution.executerOutil(outil(nom), { commande: "essai mission 17 C", ...entree }, session);
}
/** Un cas sensible : l'aperçu ne fait rien et rend un jeton ; le second appel, avec le jeton, agit. */
async function confirmer(nom: Parameters<typeof outil>[0], entree: Record<string, unknown>, verifierRienFait?: () => Promise<void>) {
  const apercu = await appeler(nom, entree);
  const jeton = jetonDe(apercu.texte);
  assert.ok(jeton, `aperçu attendu pour ${nom} : ${apercu.texte}`);
  assert.match(apercu.texte, /Rien n'a été fait/);
  if (verifierRienFait) await verifierRienFait();
  const resultat = await appeler(nom, { ...entree, confirmation: jeton });
  assert.doesNotMatch(resultat.texte, /^Refusé|a échoué/, resultat.texte);
  return { apercu, resultat, jeton: jeton! };
}
const sansHorodatage = <T extends Record<string, unknown>>(o: T, ...cles: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !["id", "createdAt", "updatedAt", "ecriture", ...cles].includes(k)));

let rang = 0;
const suffixe = () => String(++rang).padStart(3, "0");
const lead = (prenom: string, donnees: Record<string, unknown> = {}) => prisma.lead.create({ data: { prenom, nom: "Générique", telephone: `+336140${suffixe()}${String(rang).padStart(3, "0")}`, ville: "Lattes", source: "META_ADS", statut: "CONTACTE", ...donnees } });
const client = (nom: string, donnees: Record<string, unknown> = {}) => prisma.client.create({ data: { nom, prenom: nom.split(" ")[0], nomFamille: nom.split(" ")[1] ?? null, source: "ENTRANT", premierContactLe: new Date(), ...donnees } });
async function dossier(nom: string, donnees: Record<string, unknown> = {}) {
  const c = await client(nom);
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `0600${suffixe()}${String(rang).padStart(3, "0")}`, objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", montantEstime: 5000, clientId: c.id, ...donnees } });
}
/** Un lead, son dossier et son espace (pour les simulations). */
async function contactAvecEspace(prenom: string) {
  const l = await lead(prenom);
  const liens = await import("@/lib/espace/liens");
  const o = await liens.ouvrirEspaceDuContact(l.id);
  return { leadId: l.id, dossierId: o.dossierId, espaceId: o.espace.id };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("@/lib/assistant/execution");
  gen = await import("@/lib/assistant/outils/generiques");
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  await prisma.$disconnect();
});

const ids: Record<string, string> = {};

describe("les outils génériques, leurs schémas", () => {
  test("cinq outils, noms repris pour archiver / restaurer / annuler_modification ; entités du registre", async () => {
    const { ENTITES_MODIFIABLES, ENTITES_CREABLES, ENTITES_ARCHIVABLES, ENTITES_RESTAURABLES, REGISTRE_ENTITES, ENTITES } = await import("@/lib/assistant/entites");
    assert.deepEqual(gen.OUTILS_GENERIQUES.map((o) => [o.nom, o.niveau]), [["creer", "REVERSIBLE"], ["modifier", "REVERSIBLE"], ["annuler_modification", "REVERSIBLE"], ["archiver", "REVERSIBLE"], ["restaurer", "REVERSIBLE"]]);
    assert.equal(Object.keys(REGISTRE_ENTITES).length, ENTITES.length);
    assert.deepEqual([...ENTITES_MODIFIABLES].sort(), ["AUTOMATISME", "CLIENT", "COMPTEUR", "CONSIGNES", "COORDONNEE", "DEPENSE", "DOCUMENT", "DOSSIER", "ENCAISSEMENT", "GUIDE_STYLE", "LEAD", "MODELE_MAIL", "MODELE_SMS", "NOTE_APPEL", "PARAMETRE", "POSITIONNEMENT", "PROMPT_SIMULATION", "PUBLICATION", "SIMULATION", "SOUS_PARTIE", "TARIF"]);
    assert.deepEqual([...ENTITES_CREABLES].sort(), ["CLIENT", "CONSENTEMENT", "COORDONNEE", "DEPENSE", "DOSSIER", "LEAD", "NOTE", "NOTE_APPEL", "PUBLICATION", "REGLE_EXPEDITEUR", "REPRISE", "TACHE", "TARIF"]);
    assert.deepEqual([...ENTITES_ARCHIVABLES].sort(), ["CLIENT", "COORDONNEE", "DEPENSE", "DOSSIER", "LEAD", "REGLE_EXPEDITEUR", "SIMULATION", "TARIF"]);
    assert.ok(["CONSIGNES", "POSITIONNEMENT", "PROMPT_SIMULATION"].every((e) => (ENTITES_RESTAURABLES as readonly string[]).includes(e)));
    // Le schéma que le serveur MCP publie (paramètres communs compris) se traduit en JSON Schema.
    const { z } = await import("zod/v4");
    for (const o of gen.OUTILS_GENERIQUES) {
      const json = z.toJSONSchema((o.schema as unknown as import("zod/v4").ZodObject<import("zod/v4").ZodRawShape>).extend(execution.schemaCommun.shape)) as { properties: Record<string, unknown> };
      assert.ok("commande" in json.properties && "confirmation" in json.properties, o.nom);
      assert.ok(o.description.length < 6000, `${o.nom} : ${o.description.length} caractères`);
    }
    const modifier = gen.OUTILS_GENERIQUES.find((o) => o.nom === "modifier")!;
    assert.match(modifier.description, /- LEAD \(.*\) : prenom, nom_famille, telephone, email, ville, code_postal/);
    assert.match(modifier.description, /- DOSSIER .* montant_estime.*client_nom, source, ouvert_le, client_id, points_masques/);
  });
});

describe("modifier : même état que la fonction de l'écran", () => {
  test("LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton, jeton resservi refusé)", async () => {
    const [a, b] = [await lead("Aline"), await lead("Aline")];
    ids.leadA = a.id;
    const r = await appeler("modifier", { entite: "LEAD", id: a.id, champs: { prenom: "Aline-Marie", code_postal: "34970", notes: "Cuisine en L", priorite: "PRIORITAIRE", rappel_le: "2026-10-05T08:00:00.000Z" } });
    assert.match(r.texte, /le prénom passe de « Aline » à « Aline-Marie »/);
    assert.match(r.texte, /modification_id = /);
    const { modifierEntrant } = await import("@/lib/prospects/entrants");
    await modifierEntrant(b.id, { prenom: "Aline-Marie", codePostal: "34970", notes: "Cuisine en L", priorite: "PRIORITAIRE", rappelLe: "2026-10-05T08:00:00.000Z" });
    const champs = { prenom: true, codePostal: true, notes: true, priorite: true, prioriteManuelle: true, rappelLe: true, statut: true } as const;
    assert.deepEqual(await prisma.lead.findUniqueOrThrow({ where: { id: a.id }, select: champs }), await prisma.lead.findUniqueOrThrow({ where: { id: b.id }, select: champs }));

    // « Sans suite » : sensible. Sans jeton, rien ; avec, fait ; le même jeton une seconde fois : refusé.
    const perdu = { entite: "LEAD", id: a.id, champs: { statut: "PERDU", motif_perte: "PRIX" } };
    const { apercu, jeton } = await confirmer("modifier", perdu, async () => assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).statut, "CONTACTE"));
    assert.match(apercu.texte, /le statut passe de .* à /);
    await modifierEntrant(b.id, { statut: "PERDU", motifPerte: "PRIX" });
    const perte = { statut: true, motifPerte: true } as const;
    assert.deepEqual(await prisma.lead.findUniqueOrThrow({ where: { id: a.id }, select: perte }), await prisma.lead.findUniqueOrThrow({ where: { id: b.id }, select: perte }));
    // Rejoué avec le même jeton : plus rien de sensible à faire (le statut est déjà « sans suite ») : rien ne change.
    const rejoue = await appeler("modifier", { ...perdu, confirmation: jeton });
    assert.match(rejoue.texte, /Rien à changer/);
    // Acteur : le journal attribue l'écriture à l'assistant.
    const trace = await prisma.journalModification.findFirstOrThrow({ where: { modele: "Lead", enregistrementId: a.id }, orderBy: { horodatage: "desc" } });
    assert.equal(trace.acteur, "ASSISTANT:claude");
    const m = await prisma.modificationAssistant.findFirstOrThrow({ where: { entite: "LEAD", enregistrementId: a.id }, orderBy: { createdAt: "desc" } });
    assert.equal(m.par, "ASSISTANT:claude");
    assert.equal(m.commande, "essai mission 17 C");
  });

  test("DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en un appel ; aperçu « le montant estimé passe de 5 000 € à 6 200 € »", async () => {
    const [a, b] = [await dossier("Bruno Jumeau"), await dossier("Bruno Jumeau")];
    ids.dossierA = a.id;
    const entree = { entite: "DOSSIER", id: a.id, champs: { montant_estime: 6200, objet: "Cuisine et crédence", client_nom: "Bruno Jumeau-Martin", source: "RECOMMANDATION", points_masques: ["PHOTO"] } };
    const { apercu, resultat } = await confirmer("modifier", entree, async () => assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: a.id } })).montantEstime, 5000));
    assert.match(apercu.texte, /le montant estimé \(budget annoncé\) passe de 5\s000 € à 6\s200 €/);
    assert.match(apercu.texte, /le nom du client passe de « Bruno Jumeau » à « Bruno Jumeau-Martin »/);
    assert.match(resultat.texte, /modification_id = \S+ puis \S+/);
    const { modifierDossier, masquerPointACompleter } = await import("@/lib/dossiers/dossiers");
    await modifierDossier(b.id, { montantEstime: 6200, objet: "Cuisine et crédence", clientNom: "Bruno Jumeau-Martin", source: "RECOMMANDATION" });
    await masquerPointACompleter(b.id, "PHOTO", true);
    const lire = async (id: string) => {
      const d = await prisma.dossier.findUniqueOrThrow({ where: { id }, select: { montantEstime: true, objet: true, clientNom: true, source: true, objetManuelLe: true, completudeMasquee: true } });
      return { ...d, objetManuelLe: Boolean(d.objetManuelLe), completudeMasquee: (JSON.parse(d.completudeMasquee ?? "[]") as { code: string }[]).map((x) => x.code) };
    };
    assert.deepEqual(await lire(a.id), await lire(b.id));
  });

  test("CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION (brouillon), PUBLICATION : les jumeaux sont identiques", async () => {
    const fiches = await import("@/lib/clients/fiches");
    // Client
    const [ca, cb] = [await client("Chloé Double"), await client("Chloé Double")];
    ids.clientA = ca.id;
    await appeler("modifier", { entite: "CLIENT", id: ca.id, champs: { ville: "Sète", source_detail: "salon de l'habitat", notes: "Ancien client, paie par chèque" } });
    await fiches.modifierClient(cb.id, { ville: "Sète", sourceDetail: "salon de l'habitat", notes: "Ancien client, paie par chèque" });
    const champsClient = { ville: true, sourceDetail: true, notes: true, nom: true } as const;
    assert.deepEqual(await prisma.client.findUniqueOrThrow({ where: { id: ca.id }, select: champsClient }), await prisma.client.findUniqueOrThrow({ where: { id: cb.id }, select: champsClient }));

    // Coordonnée : deux adresses, la seconde devient principale et reçoit un libellé.
    for (const c of [ca, cb]) {
      await fiches.ajouterCoordonnee(c.id, "email", `chloe.${c.id.slice(-4)}@exemple.fr`, null);
      await fiches.ajouterCoordonnee(c.id, "email", `pro.${c.id.slice(-4)}@exemple.fr`, null);
    }
    const seconde = async (clientId: string) => prisma.clientEmail.findFirstOrThrow({ where: { clientId, adresse: { startsWith: "pro." } } });
    const [sa, sb] = [await seconde(ca.id), await seconde(cb.id)];
    ids.coordonneeA = sa.id;
    const rc = await appeler("modifier", { entite: "COORDONNEE", id: sa.id, champs: { principale: true, libelle: "pro" } });
    assert.match(rc.texte, /la coordonnée principale passe de chloe\.\S+ à pro\./);
    await fiches.modifierCoordonnee(cb.id, "email", sb.id, { libelle: "pro" });
    await fiches.definirPrincipale(cb.id, "email", sb.id);
    const etat = async (clientId: string) => (await prisma.clientEmail.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } })).map((e) => [e.adresse.split(".")[0], e.libelle, e.principale]);
    assert.deepEqual(await etat(ca.id), await etat(cb.id));

    // Note d'appel
    const notes = await import("@/lib/commercial/notes-appel");
    const [la, lb] = [await lead("Noé"), await lead("Noé")];
    const [na, nb] = [await notes.creerNoteAppel(la.id, { texte: "Veut un rendu" }), await notes.creerNoteAppel(lb.id, { texte: "Veut un rendu" })];
    await appeler("modifier", { entite: "NOTE_APPEL", id: na.id, champs: { texte: "Veut un rendu, rappeler mardi", etiquettes: ["VEUT_UN_RENDU"] } });
    await notes.modifierNoteAppel(lb.id, nb.id, { texte: "Veut un rendu, rappeler mardi", etiquettes: ["VEUT_UN_RENDU"] });
    const champsNote = { texte: true, etiquettes: true, issue: true } as const;
    assert.deepEqual(await prisma.noteAppel.findUniqueOrThrow({ where: { id: na.id }, select: champsNote }), await prisma.noteAppel.findUniqueOrThrow({ where: { id: nb.id }, select: champsNote }));

    // Simulation : titre et « repasser en brouillon »
    const sims = await import("@/lib/simulations/dossier");
    const [ea, eb] = [await contactAvecEspace("Sim"), await contactAvecEspace("Sim")];
    const [sia, sib] = await Promise.all([ea, eb].map((e) => prisma.simulationEspace.create({ data: { espaceId: e.espaceId, dossierId: e.dossierId, chemin: "simulations/essai.jpg", statut: "PUBLIEE", publieeLe: new Date() } })));
    ids.simulationA = sia.id;
    await appeler("modifier", { entite: "SIMULATION", id: sia.id, champs: { titre: "Chêne clair", statut: "BROUILLON" } });
    await sims.modifierSimulation(eb.dossierId, sib.id, { titre: "Chêne clair" });
    await sims.changerStatutSimulation(eb.dossierId, sib.id, "brouillon");
    const champsSim = { titre: true, statut: true, masqueeLe: true } as const;
    assert.deepEqual(await prisma.simulationEspace.findUniqueOrThrow({ where: { id: sia.id }, select: champsSim }), await prisma.simulationEspace.findUniqueOrThrow({ where: { id: sib.id }, select: champsSim }));

    // Publication (brouillon : non sensible)
    const pubs = await import("@/lib/site/publications");
    const [pa, pb] = [await pubs.creerPublication({ type: "REALISATION", titre: "Cuisine à Lattes" }), await pubs.creerPublication({ type: "REALISATION", titre: "Cuisine à Lattes" })];
    await appeler("modifier", { entite: "PUBLICATION", id: pa.id, champs: { titre: "Cuisine chêne à Lattes", ville: "Lattes" } });
    await pubs.modifierPublication(pb.id, { ...pb, titre: "Cuisine chêne à Lattes", ville: "Lattes", texte: null, typeProjet: null, note: null, auteur: null, dossierId: null, clientId: null, photoAvant: null, photoApres: null, accordClientLe: null });
    assert.deepEqual(sansHorodatage(await prisma.publicationSite.findUniqueOrThrow({ where: { id: pa.id } })), sansHorodatage(await prisma.publicationSite.findUniqueOrThrow({ where: { id: pb.id } })));
  });

  test("argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans jeton) ; DEPENSE rattachée sans en créer une autre", async () => {
    // Document repris
    const docs = await import("@/lib/dossiers/documents-existants");
    const [da, db] = [await dossier("Denis Repris"), await dossier("Denis Repris")];
    const [ra, rb] = [await docs.enregistrerDocumentExistant(da.id, { type: "DEVIS", numero: "2025-701", dateEmission: "2025-06-10", montant: 1200, inscrireAuRegistre: true, statut: "ENVOYE" }), await docs.enregistrerDocumentExistant(db.id, { type: "DEVIS", numero: "2025-702", dateEmission: "2025-06-10", montant: 1200, inscrireAuRegistre: true, statut: "ENVOYE" })];
    const { apercu } = await confirmer("modifier", { entite: "DOCUMENT", id: ra.documentId, champs: { montant: 1500, objet: "Cuisine complète" } }, async () => assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: ra.documentId } })).totalHt, 1200));
    assert.match(apercu.texte, /le montant passe de 1\s200 € à 1\s500 €/);
    await docs.modifierDocumentExistant(db.id, rb.documentId, { montant: 1500, objet: "Cuisine complète" });
    const champsDoc = { totalHt: true, objet: true, statut: true } as const;
    assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id: ra.documentId }, select: champsDoc }), await prisma.document.findUniqueOrThrow({ where: { id: rb.documentId }, select: champsDoc }));

    // Encaissement
    const enc = await import("@/lib/encaissements/service");
    const paiement = { montant: 300, moyen: "CHEQUE" as const, recuLe: hier(), reference: "CHQ-1", note: null };
    const [ea, eb] = [await enc.enregistrerEncaissement({ paiement, dossierId: da.id }), await enc.enregistrerEncaissement({ paiement, dossierId: db.id })];
    const idEnc = async (dossierId: string) => (await prisma.encaissement.findFirstOrThrow({ where: { dossierId } })).id;
    void ea;
    void eb;
    const [ia, ib] = [await idEnc(da.id), await idEnc(db.id)];
    ids.encaissementA = ia;
    await confirmer("modifier", { entite: "ENCAISSEMENT", id: ia, champs: { reference: "CHQ-2", note: "Banque postale" } }, async () => assert.equal((await prisma.encaissement.findUniqueOrThrow({ where: { id: ia } })).reference, "CHQ-1"));
    await enc.modifierEncaissement(ib, { reference: "CHQ-2", note: "Banque postale" });
    const champsEnc = { reference: true, note: true, montant: true, moyen: true, statut: true } as const;
    assert.deepEqual(await prisma.encaissement.findUniqueOrThrow({ where: { id: ia }, select: champsEnc }), await prisma.encaissement.findUniqueOrThrow({ where: { id: ib }, select: champsEnc }));

    // Tarif (preset)
    const presets = await import("@/lib/dossiers/presets");
    const [ta, tb] = [await presets.creerPreset({ designation: "Essai tarif A", unite: "ml", prixUnitaire: 40 }), await presets.creerPreset({ designation: "Essai tarif B", unite: "ml", prixUnitaire: 40 })];
    ids.tarifA = ta.id;
    const t = await confirmer("modifier", { entite: "TARIF", id: ta.id, champs: { prix_unitaire: 55, unite: "forfait" } }, async () => assert.equal((await prisma.presetTarif.findUniqueOrThrow({ where: { id: ta.id } })).prixUnitaire, 40));
    assert.match(t.apercu.texte, /le prix unitaire passe de 40 € à 55 €/);
    // Le même jeton, resservi (toujours sensible : un tarif) : refusé, rien ne bouge.
    const resservi = await appeler("modifier", { entite: "TARIF", id: ta.id, champs: { prix_unitaire: 55, unite: "forfait" }, confirmation: t.jeton });
    assert.match(resservi.texte, /^Refusé : Ce jeton de confirmation a déjà servi/);
    await presets.modifierPreset(tb.id, { prixUnitaire: 55, unite: "forfait" });
    const champsTarif = { prixUnitaire: true, unite: true, actif: true } as const;
    assert.deepEqual(await prisma.presetTarif.findUniqueOrThrow({ where: { id: ta.id }, select: champsTarif }), await prisma.presetTarif.findUniqueOrThrow({ where: { id: tb.id }, select: champsTarif }));

    // Dépense : « modifier » DEPENSE dossier_id rattache l'EXISTANTE (le défaut de « rattacher_depense » : elle en créait une autre).
    const dep = await import("@/lib/depenses/service");
    const [dpa, dpb] = [(await dep.creerDepense({ payeeLe: hier(), montant: 42.5, fournisseur: "Leroy", categorie: "MATIERE", horsChantier: true }, null)).depense, (await dep.creerDepense({ payeeLe: hier(), montant: 42.5, fournisseur: "Leroy", categorie: "MATIERE", horsChantier: true }, null)).depense];
    ids.depenseA = dpa.id;
    ids.dossierDepense = da.id;
    const avant = await prisma.depense.count();
    const rd = await appeler("modifier", { entite: "DEPENSE", id: dpa.id, champs: { dossier_id: da.id } });
    assert.doesNotMatch(rd.texte, /Confirm|Rien n'a été fait/);
    assert.equal(await prisma.depense.count(), avant, "aucune dépense créée");
    await dep.modifierDepense(dpb.id, { dossierId: da.id });
    const champsDep = { dossierId: true, horsChantier: true, montant: true } as const;
    assert.deepEqual(await prisma.depense.findUniqueOrThrow({ where: { id: dpa.id }, select: champsDep }), await prisma.depense.findUniqueOrThrow({ where: { id: dpb.id }, select: champsDep }));
  });

  test("réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide, consignes, positionnement, prompt, sous-partie) : sensibles, et la fonction de l'écran rejouée ensuite ne change plus rien", async () => {
    const parametres = await import("@/lib/parametres/service");
    // PARAMETRE, en lot : une seule écriture pour deux clés.
    await confirmer("modifier", { entite: "PARAMETRE", champs: { saisies: [{ cle: "CAMPAGNE_BUDGET", valeur: 450, valable_du: aujourdhui(), source: "dit par Lucas" }, { cle: "DELAI_RELANCE_DEVIS", valeur: 6, valable_du: aujourdhui(), source: "dit par Lucas" }] } });
    const dernier = async (cle: string) => sansHorodatage(await prisma.parametre.findFirstOrThrow({ where: { cle }, orderBy: { createdAt: "desc" } }));
    const parOutil = await dernier("CAMPAGNE_BUDGET");
    await parametres.enregistrerParametre({ cle: "CAMPAGNE_BUDGET", valeur: 450, valableDu: new Date(`${aujourdhui()}T00:00:00.000Z`), source: "dit par Lucas" });
    assert.deepEqual(await dernier("CAMPAGNE_BUDGET"), parOutil);
    assert.equal((await parametres.parametresPourEcran()).find((p) => p.cle === "DELAI_RELANCE_DEVIS")?.courante?.valeur, 6);

    // COMPTEUR
    const compteurs = await import("@/lib/dossiers/compteurs");
    const annee = new Date().getFullYear();
    await confirmer("modifier", { entite: "COMPTEUR", id: "DEVIS", champs: { prochain: `${annee}-120` } });
    const apresOutil = await compteurs.lireCompteurs();
    await compteurs.poserCompteur({ serie: "DEVIS", prochain: `${annee}-120` });
    assert.deepEqual(await compteurs.lireCompteurs(), apresOutil);

    // AUTOMATISME
    const auto = await import("@/lib/automatismes/interrupteurs");
    await confirmer("modifier", { entite: "AUTOMATISME", id: "NOTIF_PAIEMENT_RECU", champs: { actif: false } });
    const autos = await auto.listerAutomatismes();
    assert.equal(autos.find((a) => a.code === "NOTIF_PAIEMENT_RECU")?.actif, false);
    await auto.reglerAutomatisme("NOTIF_PAIEMENT_RECU", false, "LUCAS");
    assert.deepEqual(await auto.listerAutomatismes(), autos);

    // MODELE_SMS (texte, puis « revenir au texte de départ »)
    const sms = await import("@/lib/sms/modeles");
    const texte = "Bonjour, c'est Lucas de CoverSwap. Je n'ai pas pu vous joindre : je vous rappelle {quand}.";
    await confirmer("modifier", { entite: "MODELE_SMS", id: "PAS_DE_REPONSE", champs: { texte } });
    const ligne = (await sms.listerCatalogue()).find((m) => m.code === "PAS_DE_REPONSE")!;
    assert.equal(ligne.texte, texte);
    await sms.modifierModele(ligne.id!, { texte });
    assert.deepEqual((await sms.listerCatalogue()).find((m) => m.code === "PAS_DE_REPONSE"), ligne);
    const refuse = await appeler("modifier", { entite: "MODELE_SMS", id: "PAS_DE_REPONSE", champs: { texte: "Bonjour {inconnue}" } });
    assert.match(refuse.texte, /^Refusé : Texte SMS PAS_DE_REPONSE refusé/);

    // MODELE_MAIL (le modèle entier est relu, seul l'objet change)
    const notif = await import("@/lib/mail/notifications");
    await confirmer("modifier", { entite: "MODELE_MAIL", id: "PAIEMENT_RECU", champs: { objet: "Paiement reçu, merci beaucoup" } });
    const modele = await notif.modeleNotification("PAIEMENT_RECU");
    assert.equal(modele.objet, "Paiement reçu, merci beaucoup");
    assert.equal(modele.phrase, notif.MODELES_PAR_DEFAUT.PAIEMENT_RECU.phrase);
    await notif.enregistrerModeleNotification("PAIEMENT_RECU", modele, "LUCAS");
    assert.deepEqual(await notif.modeleNotification("PAIEMENT_RECU"), modele);

    // GUIDE_STYLE
    const redaction = await import("@/lib/mail/redaction");
    const guide = "Vouvoiement. Phrases courtes. Clôture : « Bien cordialement, Lucas ».";
    await confirmer("modifier", { entite: "GUIDE_STYLE", champs: { texte: guide } });
    assert.equal((await redaction.lireGuideStyle()).texte, guide);

    // CONSIGNES (une section ajoutée) et POSITIONNEMENT (texte entier) : le texte est celui que l'écran enregistrerait.
    const consignes = await import("@/lib/assistant/consignes");
    const avantConsignes = (await consignes.lireConsignes()).texte;
    const c = await confirmer("modifier", { entite: "CONSIGNES", champs: { mode: "ajouter_section", section: "Essai générique", contenu: "- Toujours citer la source." } });
    assert.match(c.apercu.texte, /Lignes ajoutées/);
    assert.equal((await consignes.lireConsignes()).texte.trim(), consignes.appliquerModification(avantConsignes, { mode: "ajouter_section", section: "Essai générique", contenu: "- Toujours citer la source." }).trim());
    const positionnement = "# Positionnement de CoverSwap\n\nRénovation par revêtements adhésifs, Montpellier et alentours.";
    await confirmer("modifier", { entite: "POSITIONNEMENT", champs: { mode: "remplacer_tout", contenu: positionnement } });
    assert.equal((await consignes.lirePositionnement()).texte.trim(), positionnement);

    // PROMPT_SIMULATION : la fonction de l'écran, rejouée, refuse « aucune modification ».
    const biblio = await import("@/lib/simulateur/bibliotheque");
    const prompt = `${(await biblio.lirePrompt("credence")).texte}\nKeep the grout lines visible.`;
    const p = await confirmer("modifier", { entite: "PROMPT_SIMULATION", id: "credence", champs: { texte: prompt, note: "essai" } });
    assert.match(p.apercu.texte, /Une nouvelle version est mise en service/);
    await assert.rejects(() => biblio.enregistrerVersion("credence", { texte: prompt }), /Aucune modification/);

    // SOUS_PARTIE : le prix de « ilot »
    const tarifs = await import("@/lib/prestations/tarifs");
    await confirmer("modifier", { entite: "SOUS_PARTIE", id: "ilot", champs: { prix_unitaire: 88 } });
    const ligneIlot = (await tarifs.tarifsDesPrestations()).find((l) => l.cle.endsWith(".ilot"))!;
    assert.equal(ligneIlot.prixUnitaire, 88);
    await tarifs.modifierTarifSousPartie("ilot", { prixUnitaire: 88 });
    assert.deepEqual((await tarifs.tarifsDesPrestations()).find((l) => l.cle.endsWith(".ilot")), ligneIlot);
  });

  test("candidats en cas de doute : jamais de choix à la place de Lucas", async () => {
    await lead("Doute", { nom: "Homonyme" });
    await lead("Doute", { nom: "Homonyme", ville: "Sète" });
    const r = await appeler("modifier", { entite: "LEAD", cible: { nom: "Doute Homonyme" }, champs: { notes: "x" } });
    assert.match(r.texte, /je ne choisis pas à ta place/);
    assert.equal(await prisma.lead.count({ where: { nom: "Homonyme", notes: "x" } }), 0);
  });
});

describe("creer : même état que la fonction de l'écran", () => {
  test("LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead), NOTE_APPEL, TACHE", async () => {
    const creation = await import("@/lib/prospects/creation-assistant");
    const rl = await appeler("creer", { entite: "LEAD", champs: { prenom: "Élise", nom: "Nouvelle", telephone: "0611223344", ville: "Castelnau-le-Lez", source: "REFERENCE" } });
    assert.match(rl.texte, /Lead créé/, rl.texte);
    const leadOutil = await prisma.lead.findFirstOrThrow({ where: { telephone: { contains: "611223344" } } });
    assert.match(rl.texte, new RegExp(`\\[lead:${leadOutil.id}\\]`));
    const jumeau = await creation.creerContactAssistant({ prenom: "Élise", nom: "Nouvelle", telephone: "0611223355", ville: "Castelnau-le-Lez", source: "REFERENCE", forcer: true });
    const leadEcran = await prisma.lead.findUniqueOrThrow({ where: { id: jumeau.cree!.leadId } });
    const champsLead = ["prenom", "nom", "ville", "source", "statut", "typeProjet"] as const;
    assert.deepEqual(champsLead.map((c) => leadOutil[c]), champsLead.map((c) => leadEcran[c]));

    const fiches = await import("@/lib/clients/fiches");
    const rc = await appeler("creer", { entite: "CLIENT", champs: { categorie: "PROFESSIONNEL", raison_sociale: "Boulangerie Essai A", ville: "Lunel", source: "BOUCHE_A_OREILLE", notes: "Local à rénover" } });
    assert.match(rc.texte, /Fiche client créée/, rc.texte);
    const idClient = /\[client:([^\]]+)\]/.exec(rc.texte)![1];
    const clientEcran = await fiches.creerClientManuel({ categorie: "PROFESSIONNEL", prenom: null, nomFamille: null, raisonSociale: "Boulangerie Essai B", siret: null, adresse: null, codePostal: null, ville: "Lunel", source: "BOUCHE_A_OREILLE", sourceDetail: null, campagne: null, publicite: null, formulaire: null, recommandeParId: null, recommandeParTexte: null, notes: "Local à rénover" });
    const champsClient = { categorie: true, prenom: true, raisonSociale: true, ville: true, source: true, notes: true } as const;
    const [lo, le] = [await prisma.client.findUniqueOrThrow({ where: { id: idClient }, select: champsClient }), await prisma.client.findUniqueOrThrow({ where: { id: clientEcran.id }, select: champsClient })];
    assert.deepEqual({ ...lo, raisonSociale: "x" }, { ...le, raisonSociale: "x" });

    await appeler("creer", { entite: "COORDONNEE", cible: { clientId: idClient }, champs: { nature: "telephone", valeur: "0467001122", libelle: "boutique" } });
    await fiches.ajouterCoordonnee(clientEcran.id, "telephone", "0467001133", "boutique");
    const tel = async (clientId: string) => (await prisma.clientTelephone.findMany({ where: { clientId } })).map((t) => [t.libelle, t.principal]);
    assert.deepEqual(await tel(idClient), await tel(clientEcran.id));

    await appeler("creer", { entite: "CONSENTEMENT", cible: { clientId: idClient }, champs: { statut: "ACCORDE", moyen: "ORAL", recueilli_le: hier(), preuve: "au téléphone" } });
    await fiches.enregistrerConsentement(clientEcran.id, { statut: "ACCORDE", moyen: "ORAL", recueilliLe: hier(), preuve: "au téléphone" });
    const cons = async (clientId: string) => (await prisma.consentementMail.findMany({ where: { clientId } })).map((c) => [c.statut, c.moyen, c.recueilliLe.toISOString(), c.preuve]);
    assert.deepEqual(await cons(idClient), await cons(clientEcran.id));

    // NOTE : sur un dossier (à une étape choisie) et sur un lead sans dossier (échange typé).
    const { ajouterNote } = await import("@/lib/dossiers/dossiers");
    const { ajouterEchange } = await import("@/lib/prospects/entrants");
    const [da, db] = [await dossier("Nina Note"), await dossier("Nina Note")];
    await appeler("creer", { entite: "NOTE", cible: { dossierId: da.id }, champs: { texte: "Le client hésite sur la teinte", etape: "SIMULATION" } });
    await ajouterNote(db.id, { etape: "SIMULATION", contenu: "Le client hésite sur la teinte" });
    const note = async (dossierId: string) => (await prisma.dossierNote.findMany({ where: { dossierId } })).map((n) => [n.etape, n.contenu]);
    assert.deepEqual(await note(da.id), await note(db.id));
    const [la, lb] = [await lead("Echo", { statut: "NOUVEAU" }), await lead("Echo", { statut: "NOUVEAU" })];
    await appeler("creer", { entite: "NOTE", cible: { leadId: la.id }, champs: { texte: "Mail envoyé avec les tarifs", type: "EMAIL" } });
    await ajouterEchange(lb.id, { type: "EMAIL", contenu: "Mail envoyé avec les tarifs" });
    const echange = async (leadId: string) => [(await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).statut, (await prisma.interaction.findMany({ where: { leadId } })).map((i) => [i.type, i.contenu])];
    assert.deepEqual(await echange(la.id), await echange(lb.id));

    // NOTE_APPEL (sans issue)
    const notes = await import("@/lib/commercial/notes-appel");
    await appeler("creer", { entite: "NOTE_APPEL", cible: { leadId: la.id }, champs: { texte: "Locataire, doit demander au propriétaire", etiquettes: ["LOCATAIRE"] } });
    await notes.creerNoteAppel(lb.id, { texte: "Locataire, doit demander au propriétaire", etiquettes: ["LOCATAIRE"] });
    const na = async (leadId: string) => (await prisma.noteAppel.findMany({ where: { leadId } })).map((n) => [n.texte, n.etiquettes, n.issue]);
    assert.deepEqual(await na(la.id), await na(lb.id));

    // TACHE
    const { ajouterTache } = await import("@/lib/a-faire/reponses");
    await appeler("creer", { entite: "TACHE", cible: { dossierId: da.id }, champs: { titre: "Rappeler le fournisseur de films", raison: "stock" } });
    await ajouterTache({ titre: "Rappeler le fournisseur de films", dossierId: db.id, raison: "stock" });
    const tache = async (dossierId: string) => sansHorodatage(await prisma.tacheAFaire.findFirstOrThrow({ where: { dossierId, type: "MANUELLE" } }), "cle", "dossierId", "leadId", "clientId", "sujetId", "raccourci", "depuis", "vueLe", "detecteLe");
    assert.deepEqual(await tache(da.id), await tache(db.id));
  });

  test("DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible), DEPENSE (création), TARIF, PUBLICATION, REGLE_EXPEDITEUR, REPRISE", async () => {
    const { creerDossier } = await import("@/lib/dossiers/dossiers");
    const [ca, cb] = [await client("Paul Direct"), await client("Paul Direct")];
    const rd = await appeler("creer", { entite: "DOSSIER", cible: { clientId: ca.id }, champs: { objet: "Salle de bain", montant_estime: 3200, source: "RECOMMANDATION" } });
    assert.match(rd.texte, /\[dossier:/, rd.texte);
    const idDossier = /\[dossier:([^\]]+)\]/.exec(rd.texte)![1];
    const idEcran = await creerDossier({ clientNom: "Paul Direct", clientId: cb.id, objet: "Salle de bain", montantEstime: 3200, source: "RECOMMANDATION" } as never, []);
    const champsD = { clientNom: true, objet: true, montantEstime: true, source: true, etape: true } as const;
    assert.deepEqual(await prisma.dossier.findUniqueOrThrow({ where: { id: idDossier }, select: champsD }), await prisma.dossier.findUniqueOrThrow({ where: { id: idEcran }, select: champsD }));
    const avantSigne = await prisma.dossier.count();
    const signe = await appeler("creer", { entite: "DOSSIER", champs: { client_nom: "Sam Signe", objet: "Cuisine", etape: "SIGNE" } });
    assert.ok(jetonDe(signe.texte), signe.texte);
    assert.equal(await prisma.dossier.count(), avantSigne, "sans jeton, aucun dossier créé");

    // DEPENSE : « creer » crée ; elle se rattache au chantier désigné.
    const dep = await import("@/lib/depenses/service");
    const r = await appeler("creer", { entite: "DEPENSE", cible: { dossierId: idDossier }, champs: { montant: 18.9, fournisseur: "Total", categorie: "DEPLACEMENT", payee_le: hier(), moyen: "CARTE" } });
    const idDep = /\[depense:([^\]]+)\]/.exec(r.texte)![1];
    const ecran = (await dep.creerDepense({ payeeLe: hier(), montant: 18.9, fournisseur: "Total", categorie: "DEPLACEMENT", moyen: "CARTE", dossierId: idEcran }, null)).depense;
    const champsDep = { montant: true, fournisseur: true, categorie: true, moyen: true, horsChantier: true, payeeLe: true } as const;
    assert.deepEqual(await prisma.depense.findUniqueOrThrow({ where: { id: idDep }, select: champsDep }), await prisma.depense.findUniqueOrThrow({ where: { id: ecran.id }, select: champsDep }));
    assert.equal((await prisma.depense.findUniqueOrThrow({ where: { id: idDep } })).dossierId, idDossier);

    // TARIF (sensible)
    const presets = await import("@/lib/dossiers/presets");
    const t = await confirmer("creer", { entite: "TARIF", champs: { designation: "Habillage essai A", unite: "forfait", prix_unitaire: 120 } });
    const idTarif = /\[tarif:([^\]]+)\]/.exec(t.resultat.texte)![1];
    const tEcran = await presets.creerPreset({ designation: "Habillage essai B", unite: "forfait", prixUnitaire: 120 });
    const champsT = { unite: true, prixUnitaire: true, actif: true, prestations: true } as const;
    assert.deepEqual(await prisma.presetTarif.findUniqueOrThrow({ where: { id: idTarif }, select: champsT }), await prisma.presetTarif.findUniqueOrThrow({ where: { id: tEcran.id }, select: champsT }));

    // PUBLICATION (brouillon)
    const pubs = await import("@/lib/site/publications");
    const rp = await appeler("creer", { entite: "PUBLICATION", champs: { type: "AVIS", titre: "Avis de Martine", texte: "Travail soigné", note: 5, auteur: "Martine" } });
    const idPub = /\[publication:([^\]]+)\]/.exec(rp.texte)![1];
    const pEcran = await pubs.creerPublication({ type: "AVIS", titre: "Avis de Martine", texte: "Travail soigné", note: 5, auteur: "Martine" });
    assert.deepEqual(sansHorodatage(await prisma.publicationSite.findUniqueOrThrow({ where: { id: idPub } })), sansHorodatage(await prisma.publicationSite.findUniqueOrThrow({ where: { id: pEcran.id } })));

    // REGLE_EXPEDITEUR (sensible : la confirmation de Lucas remplace la carte de l'ancien « proposer_regle »)
    const boite = await import("@/lib/mail/boite");
    const rr = await confirmer("creer", { entite: "REGLE_EXPEDITEUR", champs: { cible: "@publicite-a.fr", action: "RANGER", motif: "newsletters" } });
    ids.regleA = /\[regle:([^\]]+)\]/.exec(rr.resultat.texte)![1];
    await boite.poserRegle("@publicite-b.fr", "RANGER", "newsletters", "ASSISTANT:claude", true);
    const regle = async (cible: string) => sansHorodatage(await prisma.regleExpediteur.findFirstOrThrow({ where: { cible } }), "cible");
    assert.deepEqual(await regle("@publicite-a.fr"), await regle("@publicite-b.fr"));

    // REPRISE (sensible, argent)
    const reprise = await import("@/lib/dossiers/reprise");
    const entree = (nom: string, numero: string) => ({ dossier: { clientNom: nom, objet: "Cuisine d'avant le CRM", source: "RECOMMANDATION" }, etape: "SIGNE", dates: { ouvertLe: "2025-05-02", jalons: { DEVIS_ENVOYE: "2025-05-10", SIGNE: "2025-05-20" } }, documents: [{ type: "DEVIS", numero, dateEmission: "2025-05-10", montant: 2400, statut: "ACCEPTE", inscrireAuRegistre: true }], paiements: [] });
    const rep = await confirmer("creer", { entite: "REPRISE", champs: { dossier: { client_nom: "Rémi Repris", objet: "Cuisine d'avant le CRM", source: "RECOMMANDATION" }, etape: "SIGNE", dates: { ouvert_le: "2025-05-02", jalons: { DEVIS_ENVOYE: "2025-05-10", SIGNE: "2025-05-20" } }, documents: [{ type: "DEVIS", numero: "2025-801", date_emission: "2025-05-10", montant: 2400, statut: "ACCEPTE", inscrire_au_registre: true }] } });
    const idRepris = /\[dossier:([^\]]+)\]/.exec(rep.resultat.texte)![1];
    const repEcran = await reprise.reprendreDossier(reprise.schemaReprise.parse(entree("Rémi Repris", "2025-802")));
    const etat = async (id: string) => {
      const d = await prisma.dossier.findUniqueOrThrow({ where: { id }, select: { etape: true, objet: true, ouvertLe: true, documents: { select: { type: true, totalHt: true, statut: true, origine: true } } } });
      return d;
    };
    assert.deepEqual(await etat(idRepris), await etat(repEcran.id));
  });
});

describe("les fonctions de service ajoutées (plan § 4.5)", () => {
  test("restaurerCoordonnee (redevient principale s'il n'y en a plus), restaurerDepense, restaurerPreset, archiverRegle / restaurerRegle (la règle contraire tombe), restaurerSimulation", async () => {
    const fiches = await import("@/lib/clients/fiches");
    const c = await client("Rose Service");
    await fiches.ajouterCoordonnee(c.id, "telephone", "0611000001", null);
    const tel = await prisma.clientTelephone.findFirstOrThrow({ where: { clientId: c.id } });
    assert.equal(tel.principal, true);
    await fiches.archiverCoordonnee(c.id, "telephone", tel.id, "faux numéro");
    await fiches.restaurerCoordonnee(c.id, "telephone", tel.id);
    const remis = await prisma.clientTelephone.findUniqueOrThrow({ where: { id: tel.id } });
    assert.deepEqual([remis.archiveLe, remis.archiveMotif, remis.principal], [null, null, true]);
    await fiches.restaurerCoordonnee(c.id, "telephone", tel.id); // déjà en place : rien

    const dep = await import("@/lib/depenses/service");
    const d = (await dep.creerDepense({ payeeLe: hier(), montant: 3, fournisseur: "Péage", categorie: "DEPLACEMENT" }, null)).depense;
    await dep.archiverDepense(d.id, "doublon");
    await dep.restaurerDepense(d.id);
    assert.equal((await prisma.depense.findUniqueOrThrow({ where: { id: d.id } })).archiveLe, null);
    await dep.modifierDepense(d.id, { montant: 4 }); // de nouveau modifiable

    const presets = await import("@/lib/dossiers/presets");
    const p = await presets.creerPreset({ designation: "Service tarif", unite: "jour", prixUnitaire: 300 });
    await presets.archiverPreset(p.id);
    assert.equal((await presets.listerPresets()).some((x) => x.id === p.id), false);
    await presets.restaurerPreset(p.id);
    assert.equal((await presets.listerPresets()).some((x) => x.id === p.id), true);

    const boite = await import("@/lib/mail/boite");
    await boite.poserRegle("promo@service.fr", "RANGER", "essai", "LUCAS");
    const ranger = await prisma.regleExpediteur.findFirstOrThrow({ where: { cible: "promo@service.fr", action: "RANGER" } });
    await boite.archiverRegle(ranger.id, "retirée");
    await assert.rejects(() => boite.archiverRegle(ranger.id), /déjà retirée/);
    await boite.poserRegle("promo@service.fr", "NE_JAMAIS_RANGER", "essai", "LUCAS");
    await boite.restaurerRegle(ranger.id);
    const actives = await prisma.regleExpediteur.findMany({ where: { cible: "promo@service.fr" } });
    assert.deepEqual(actives.map((r) => r.action), ["RANGER"]);

    const sims = await import("@/lib/simulations/dossier");
    const e = await contactAvecEspace("Service");
    const s = await prisma.simulationEspace.create({ data: { espaceId: e.espaceId, dossierId: e.dossierId, chemin: "simulations/s.jpg", statut: "PUBLIEE", publieeLe: new Date() } });
    await sims.changerStatutSimulation(e.dossierId, s.id, "retirer", "ratée");
    const vue = await sims.restaurerSimulation(e.dossierId, s.id);
    assert.equal(vue.statut, "BROUILLON");
    assert.equal((await prisma.simulationEspace.findUniqueOrThrow({ where: { id: s.id } })).archiveLe, null);
  });
});

describe("archiver, restaurer, annuler_modification", () => {
  test("archiver puis restaurer huit entités en un appel (au-delà de trois : aperçu, jeton) ; même état que les fonctions de l'écran ; versions des textes", async () => {
    const fiches = await import("@/lib/clients/fiches");
    const dep = await import("@/lib/depenses/service");
    const presets = await import("@/lib/dossiers/presets");
    const boite = await import("@/lib/mail/boite");
    const entrants = await import("@/lib/prospects/entrants");
    const sims = await import("@/lib/simulations/dossier");
    const archivage = await import("@/lib/dossiers/archivage");

    // Les jumeaux « écran ».
    const lb = await lead("Arnaud");
    const cb = await client("Chloé Écran");
    await fiches.ajouterCoordonnee(cb.id, "email", "chloe.ecran@exemple.fr", null);
    await fiches.ajouterCoordonnee(cb.id, "email", "chloe.ecran2@exemple.fr", null);
    const coordB = await prisma.clientEmail.findFirstOrThrow({ where: { clientId: cb.id, adresse: "chloe.ecran2@exemple.fr" } });
    const depB = (await dep.creerDepense({ payeeLe: hier(), montant: 9, fournisseur: "Brico", categorie: "FOURNITURES" }, null)).depense;
    const tarifB = await presets.creerPreset({ designation: "Essai archive B", unite: "ml", prixUnitaire: 10 });
    await boite.poserRegle("@archive-b.fr", "RANGER", "essai", "ASSISTANT:claude", true);
    const regleB = await prisma.regleExpediteur.findFirstOrThrow({ where: { cible: "@archive-b.fr" } });
    const eB = await contactAvecEspace("SimB");
    const simB = await prisma.simulationEspace.create({ data: { espaceId: eB.espaceId, dossierId: eB.dossierId, chemin: "simulations/b.jpg", statut: "BROUILLON" } });
    const dB = await dossier("Denis Archive");

    // Les jumeaux « outil ».
    const la = await lead("Arnaud");
    const ca = await client("Chloé Outil");
    await fiches.ajouterCoordonnee(ca.id, "email", "chloe.outil@exemple.fr", null);
    await fiches.ajouterCoordonnee(ca.id, "email", "chloe.outil2@exemple.fr", null);
    const coordA = await prisma.clientEmail.findFirstOrThrow({ where: { clientId: ca.id, adresse: "chloe.outil2@exemple.fr" } });
    const depA = (await dep.creerDepense({ payeeLe: hier(), montant: 9, fournisseur: "Brico", categorie: "FOURNITURES" }, null)).depense;
    const tarifA = await presets.creerPreset({ designation: "Essai archive A", unite: "ml", prixUnitaire: 10 });
    await boite.poserRegle("@archive-a.fr", "RANGER", "essai", "ASSISTANT:claude", true);
    const regleA = await prisma.regleExpediteur.findFirstOrThrow({ where: { cible: "@archive-a.fr" } });
    const eA = await contactAvecEspace("SimA");
    const simA = await prisma.simulationEspace.create({ data: { espaceId: eA.espaceId, dossierId: eA.dossierId, chemin: "simulations/a.jpg", statut: "BROUILLON" } });
    const dA = await dossier("Denis Archive");

    const elements = [
      { entite: "LEAD", id: la.id },
      { entite: "CLIENT", id: ca.id },
      { entite: "COORDONNEE", id: coordA.id },
      { entite: "DEPENSE", id: depA.id },
      { entite: "TARIF", id: tarifA.id },
      { entite: "REGLE_EXPEDITEUR", id: regleA.id },
      { entite: "SIMULATION", id: simA.id },
      { entite: "DOSSIER", id: dA.id },
    ];
    const motif = "Saisie en double pendant l'essai";
    const { apercu } = await confirmer("archiver", { elements, motif }, async () => assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: la.id } })).archiveLe, null));
    assert.match(apercu.texte, /Je vais archiver 8 éléments/);
    await entrants.archiverEntrant(lb.id, motif);
    await fiches.archiverClient(cb.id, motif);
    await fiches.archiverCoordonnee(cb.id, "email", coordB.id, motif);
    await dep.archiverDepense(depB.id, motif);
    await presets.archiverPreset(tarifB.id);
    await boite.archiverRegle(regleB.id, motif);
    await sims.changerStatutSimulation(eB.dossierId, simB.id, "retirer", motif);
    await archivage.archiverDossier(dB.id, motif);

    const etat = async (j: { lead: string; client: string; coord: string; dep: string; tarif: string; regle: string; sim: string; dossier: string }) => ({
      lead: await prisma.lead.findUniqueOrThrow({ where: { id: j.lead }, select: { archiveMotif: true, archiveLe: true } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe)]),
      client: await prisma.client.findUniqueOrThrow({ where: { id: j.client }, select: { archiveMotif: true, archiveLe: true } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe)]),
      coord: await prisma.clientEmail.findUniqueOrThrow({ where: { id: j.coord } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe), x.principale]),
      dep: await prisma.depense.findUniqueOrThrow({ where: { id: j.dep } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe)]),
      tarif: await prisma.presetTarif.findUniqueOrThrow({ where: { id: j.tarif } }).then((x) => x.actif),
      regle: await prisma.regleExpediteur.findUniqueOrThrow({ where: { id: j.regle } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe)]),
      sim: await prisma.simulationEspace.findUniqueOrThrow({ where: { id: j.sim } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe), x.statut]),
      dossier: await prisma.dossier.findUniqueOrThrow({ where: { id: j.dossier } }).then((x) => [x.archiveMotif, Boolean(x.archiveLe)]),
    });
    const jA = { lead: la.id, client: ca.id, coord: coordA.id, dep: depA.id, tarif: tarifA.id, regle: regleA.id, sim: simA.id, dossier: dA.id };
    const jB = { lead: lb.id, client: cb.id, coord: coordB.id, dep: depB.id, tarif: tarifB.id, regle: regleB.id, sim: simB.id, dossier: dB.id };
    const archives = await etat(jA);
    assert.deepEqual(archives, await etat(jB));
    assert.equal(archives.lead[1], true);
    assert.equal(archives.tarif, false);

    // Restaurer (les mêmes huit, et deux versions de textes).
    const consignes = await import("@/lib/assistant/consignes");
    const versions = await consignes.listerVersions(consignes.CLE_CONSIGNES, 5);
    const biblio = await import("@/lib/simulateur/bibliotheque");
    const prompt = await biblio.lirePrompt("credence");
    const ancienne = prompt.versions.find((v) => !v.courante)!;
    await confirmer("restaurer", { elements: [...elements, { entite: "CONSIGNES", numero: versions[versions.length - 1].numero }, { entite: "PROMPT_SIMULATION", id: "credence", numero: ancienne.numero }] });
    await entrants.restaurerEntrant(lb.id);
    await fiches.restaurerClient(cb.id);
    await fiches.restaurerCoordonnee(cb.id, "email", coordB.id);
    await dep.restaurerDepense(depB.id);
    await presets.restaurerPreset(tarifB.id);
    await boite.restaurerRegle(regleB.id);
    await sims.restaurerSimulation(eB.dossierId, simB.id);
    await archivage.restaurerDossier(dB.id);
    const restaures = await etat(jA);
    assert.deepEqual(restaures, await etat(jB));
    assert.deepEqual(restaures.lead, [null, false]);
    assert.equal(restaures.tarif, true);
    assert.equal((await biblio.lirePrompt("credence")).texte, await biblio.texteDeVersion("credence", ancienne.numero));
    assert.equal((await consignes.lireConsignes()).texte.trim().startsWith((await consignes.texteDeLaVersion(consignes.CLE_CONSIGNES, versions[versions.length - 1].numero)).trim().slice(0, 60)), true);
  });

  test("raccourcis leads / dossiers (comportement de l'ancien « archiver ») ; identifiant inconnu : rien n'est fait", async () => {
    const [l1, l2] = [await lead("Rac"), await lead("Rac")];
    const r = await appeler("archiver", { leads: [l1.id, l2.id], motif: "doublon" });
    assert.match(r.texte, /Archivé \(motif : doublon\)/);
    assert.deepEqual((await prisma.lead.findMany({ where: { id: { in: [l1.id, l2.id] }, archiveLe: { not: null } }, select: { archiveMotif: true } })).map((x) => x.archiveMotif), ["Doublon", "Doublon"]);
    const inconnu = await appeler("archiver", { elements: [{ entite: "DEPENSE", id: "inexistante" }, { entite: "LEAD", id: l1.id }], motif: "essai" });
    assert.match(inconnu.texte, /^Refusé : 1 identifiant inconnu/);
  });

  test("annuler_modification : lead (par identifiant), dépense (par entité), dossier (cœur puis suite), paramètre ; encaissement sensible", async () => {
    const annuler = (entree: Record<string, unknown>) => appeler("annuler_modification", entree);
    // Lead : la dernière modification (le passage « sans suite ») est défaite par son identifiant.
    const m = await prisma.modificationAssistant.findFirstOrThrow({ where: { entite: "LEAD", enregistrementId: ids.leadA }, orderBy: { createdAt: "desc" } });
    const r1 = await annuler({ modification_id: m.id });
    assert.match(r1.texte, /Modification annulée sur .*le statut passe de .* à /);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadA } });
    assert.deepEqual([l.statut, l.motifPerte, l.prenom], ["CONTACTE", null, "Aline-Marie"]);
    assert.ok((await prisma.modificationAssistant.findUniqueOrThrow({ where: { id: m.id } })).annuleeLe);

    // Dépense : le rattachement est défait (hors chantier de nouveau).
    await annuler({ entite: "DEPENSE", id: ids.depenseA });
    const d = await prisma.depense.findUniqueOrThrow({ where: { id: ids.depenseA } });
    assert.deepEqual([d.dossierId, d.horsChantier], [null, true]);

    // Dossier : la dernière (la suite, tracée après le cœur), puis le cœur (sensible : montant).
    await annuler({ dossierId: ids.dossierA });
    let dossierA = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierA } });
    assert.deepEqual([dossierA.clientNom, dossierA.source, dossierA.completudeMasquee, dossierA.montantEstime], ["Bruno Jumeau", "ENTRANT", null, 6200]);
    await confirmer("annuler_modification", { dossierId: ids.dossierA });
    dossierA = await prisma.dossier.findUniqueOrThrow({ where: { id: ids.dossierA } });
    assert.deepEqual([dossierA.montantEstime, dossierA.objet], [5000, "Recouvrement de cuisine"]);

    // Encaissement : défaire une correction d'argent est sensible.
    await confirmer("annuler_modification", { entite: "ENCAISSEMENT", id: ids.encaissementA }, async () => assert.equal((await prisma.encaissement.findUniqueOrThrow({ where: { id: ids.encaissementA } })).reference, "CHQ-2"));
    assert.equal((await prisma.encaissement.findUniqueOrThrow({ where: { id: ids.encaissementA } })).reference, "CHQ-1");

    // Paramètre (lot) : les valeurs d'avant reviennent, datées d'aujourd'hui.
    const parametres = await import("@/lib/parametres/service");
    const trace = await prisma.modificationAssistant.findFirstOrThrow({ where: { entite: "PARAMETRE" } });
    const avant = (JSON.parse(trace.champs) as { cle: string; avant: unknown }[]).find((c) => c.cle === "DELAI_RELANCE_DEVIS")!.avant;
    assert.notEqual(avant, null);
    const ap = await confirmer("annuler_modification", { entite: "PARAMETRE" });
    assert.match(ap.apercu.texte, /Délai.* passe de 6 jours à/);
    assert.equal((await parametres.parametresPourEcran()).find((p) => p.cle === "DELAI_RELANCE_DEVIS")?.courante?.valeur, avant);

    // Déjà annulée : refusé.
    const deja = await annuler({ modification_id: m.id });
    assert.match(deja.texte, /déjà été annulée/);
  });

  test("le plafond d'écritures n'a jamais été atteint (cas regroupés : un lot de paramètres, huit archivages en un appel)", async () => {
    const ecritures = await prisma.appelOutil.count({ where: { niveau: { not: "LECTURE" }, statut: "FAIT", createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    assert.ok(ecritures < execution.PLAFOND_ECRITURES_PAR_HEURE, `${ecritures} écritures`);
    assert.equal(await prisma.appelOutil.count({ where: { statut: "REFUSE", erreur: { startsWith: "Plafond" } } }), 0);
  });
});
